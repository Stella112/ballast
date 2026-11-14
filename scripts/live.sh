#!/usr/bin/env bash
# Ballast LIVE Mezo testnet runbook. Broadcasts real testnet transactions.
# Guarded: requires BALLAST_LIVE=1 and chain id 31611. Keys come from .env.local (git-ignored);
# this script never prints them. All output is appended to evidence/live-<date>.log.
#
#   BALLAST_LIVE=1 scripts/live.sh preflight
#   BALLAST_LIVE=1 scripts/live.sh deploy
#   BALLAST_LIVE=1 scripts/live.sh create-account
#   BALLAST_LIVE=1 scripts/live.sh open-trove <debtMUSD> <collBTC>      e.g. 2100 0.07
#   BALLAST_LIVE=1 scripts/live.sh state
#   BALLAST_LIVE=1 scripts/live.sh repay <MUSD>                          controller repay from free MUSD
#   BALLAST_LIVE=1 scripts/live.sh fund-payer <MUSD>                     account free MUSD -> payer wallet
#   BALLAST_LIVE=1 scripts/live.sh set-policy <repayBps> <reserveBps>
#   BALLAST_LIVE=1 scripts/live.sh pay-invoice <MUSD>                    payer pays a merchant-signed invoice
#   BALLAST_LIVE=1 scripts/live.sh deploy-adapter                        deploy BallastRepaymentAdapter
#   BALLAST_LIVE=1 scripts/live.sh open-wallet-trove <debt> <coll>       payer wallet opens its own (non-Ballast) trove
#   BALLAST_LIVE=1 scripts/live.sh wallet-state <address>
#   BALLAST_LIVE=1 scripts/live.sh pay-direct-invoice <MUSD> <repayMUSD> deployer pays the wallet-borrower's invoice; signed repay
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${BALLAST_LIVE:-}" = "1" ] || { echo "refusing: set BALLAST_LIVE=1 to broadcast to Mezo testnet"; exit 1; }
set -a; . ./.env.local; set +a
R="$MEZO_TESTNET_RPC_URL"
[ "$(cast chain-id --rpc-url "$R")" = "31611" ] || { echo "refusing: RPC is not chain 31611"; exit 1; }

CFG=config/deployments.mezo-testnet.json
j() { python -c "import json,sys;d=json.load(open('$CFG'));print(eval(sys.argv[1]))" "$1"; }
MUSD=$(j "d['mezo']['MUSD']"); BO=$(j "d['mezo']['BorrowerOperations']"); TM=$(j "d['mezo']['TroveManager']")
ST=$(j "d['mezo']['SortedTroves']"); HH=$(j "d['mezo']['HintHelpers']"); PF=$(j "d['mezo']['PriceFeed']")
EXP=$(j "d['explorer']")
POOLS_ROUTER=0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9; POOL_FACTORY=0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A  # Mezo Pools testnet (mezo.org/docs/developers/features/mezo-pools)
mkdir -p evidence; LOG="evidence/live-$(date -u +%Y%m%d).log"
log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }
ballast() { j "(d.get('ballast') or {}).get('$1','')"; }

send() { # send <pkvar> <to> <sig> [args...] ; logs hash, block, status
  local pkv=$1; shift
  # submit async (hash returned immediately and logged), then poll for the receipt
  local h; h=$(cast send --rpc-url "$R" --private-key "${!pkv}" --async "$@" | tail -1 | tr -d '[:space:]')
  log "SUBMITTED $2 hash=$h"
  local out="" i
  for i in $(seq 1 60); do out=$(cast receipt "$h" --json --rpc-url "$R" 2>/dev/null) && [ -n "$out" ] && break; sleep 3; done
  [ -n "$out" ] || { log "NO RECEIPT after polling for $h"; exit 1; }
  local b s
  b=$(echo "$out" | python -c 'import json,sys;print(int(json.load(sys.stdin)["blockNumber"],16))')
  s=$(echo "$out" | python -c 'import json,sys;print(int(json.load(sys.stdin)["status"],16))')
  log "TX $2 status=$s block=$b hash=$h $EXP/tx/$h"
  [ "$s" = "1" ] || { log "TX FAILED"; exit 1; }
  echo "$out" > "evidence/last-receipt.json"
}

hints() { # hints <coll wei> <debt wei> -> "upper lower"
  local nicr; nicr=$(cast call "$HH" "computeNominalCR(uint256,uint256)(uint256)" "$1" "$2" --rpc-url "$R" | cut -d' ' -f1)
  local size; size=$(cast call "$ST" "getSize()(uint256)" --rpc-url "$R" | cut -d' ' -f1)
  local trials=$(( size < 15 ? 15 : (size * 15 > 500 ? 500 : size * 15) ))
  local approx; approx=$(cast call "$HH" "getApproxHint(uint256,uint256,uint256)(address,uint256,uint256)" "$nicr" "$trials" 42 --rpc-url "$R" | head -1)
  cast call "$ST" "findInsertPosition(uint256,address,address)(address,address)" "$nicr" "$approx" "$approx" --rpc-url "$R" | tr '\n' ' '
}

cfgset() { # cfgset <key> <value> : write ballast.<key> into the deployment config
  python -c "import json,sys;f='config/deployments.mezo-testnet.json';c=json.load(open(f));c['ballast'][sys.argv[1]]=sys.argv[2];json.dump(c,open(f,'w'),indent=2)" "$1" "$2"
}

create() { # create <label> <artifact.json> [ctor-abi-sig ctor-args...] ; async create + receipt poll; sets CREATED
  local label=$1 art=$2; shift 2
  local code; code=$(python -c "import json,sys;print(json.load(open(sys.argv[1]))['bytecode']['object'])" "$art")
  local args=""; if [ $# -gt 0 ]; then args=$(cast abi-encode "$@"); args=${args#0x}; fi
  local h; h=$(cast send --rpc-url "$R" --private-key "$DEPLOYER_PRIVATE_KEY" --async --create "${code}${args}" | tail -1 | tr -d '[:space:]')
  log "SUBMITTED create $label hash=$h"
  local out="" i
  for i in $(seq 1 60); do out=$(cast receipt "$h" --json --rpc-url "$R" 2>/dev/null) && [ -n "$out" ] && break; sleep 3; done
  [ -n "$out" ] || { log "NO RECEIPT for $h"; exit 1; }
  local a b s
  a=$(echo "$out" | python -c 'import json,sys;print(json.load(sys.stdin)["contractAddress"])')
  b=$(echo "$out" | python -c 'import json,sys;print(int(json.load(sys.stdin)["blockNumber"],16))')
  s=$(echo "$out" | python -c 'import json,sys;print(int(json.load(sys.stdin)["status"],16))')
  log "TX create $label status=$s block=$b hash=$h address=$a $EXP/address/$a"
  [ "$s" = "1" ] || { log "CREATE FAILED"; exit 1; }
  a=$(cast to-check-sum-address "$a")
  cfgset "$label" "$a"
  python -c "import json,sys;f='config/deployments.mezo-testnet.json';c=json.load(open(f));c['ballast'].setdefault('deployTx',{})[sys.argv[1]]={'hash':sys.argv[2],'block':int(sys.argv[3])};json.dump(c,open(f,'w'),indent=2)" "$label" "$h" "$b"
  CREATED=$a
}

mp_tuple() { echo "($(ballast MorphoBTC),$MUSD,$(ballast BallastMezoOracle),$(ballast AdaptiveCurveIrm),860000000000000000)"; }

quote() { # quote <amountIn> <from> <to> <stable>: Mezo Pools router getAmountsOut, last element
  cast call "$POOLS_ROUTER" "getAmountsOut(uint256,(address,address,bool,address)[])(uint256[])" "$1" "[($2,$3,$4,$POOL_FACTORY)]" --rpc-url "$R" | tr -d '[]' | awk -F', ' '{print $NF}' | cut -d' ' -f1
}

# ---- Base Sepolia (Wormhole Token Bridge) ----
BR=$(j "d['baseSepolia']['rpcUrl']"); BEXP=$(j "d['baseSepolia']['explorer']"); BUSDC=$(j "d['baseSepolia']['USDC']")
BTB=$(j "d['baseSepolia']['WormholeTokenBridge']"); BCORE=$(j "d['baseSepolia']['WormholeCore']"); WSCAN=$(j "d['baseSepolia']['wormholescanApi']")
MTB=$(j "d['mezo']['WormholeTokenBridge']")

sendb() { # sendb <pkvar> <to> <sig> [args...] on Base Sepolia (chain check), logs hash/block/status, writes evidence/last-base-receipt.json
  [ "$(cast chain-id --rpc-url "$BR")" = "84532" ] || { echo "refusing: Base RPC is not 84532"; exit 1; }
  local pkv=$1; shift
  local h; h=$(cast send --rpc-url "$BR" --private-key "${!pkv}" --async "$@" | tail -1 | tr -d '[:space:]')
  log "SUBMITTED [base] $2 hash=$h"
  local out="" i
  for i in $(seq 1 60); do out=$(cast receipt "$h" --json --rpc-url "$BR" 2>/dev/null) && [ -n "$out" ] && break; sleep 3; done
  [ -n "$out" ] || { log "NO RECEIPT [base] $h"; exit 1; }
  local b st
  b=$(echo "$out" | python -c 'import json,sys;print(int(json.load(sys.stdin)["blockNumber"],16))')
  st=$(echo "$out" | python -c 'import json,sys;print(int(json.load(sys.stdin)["status"],16))')
  log "TX [base] $2 status=$st block=$b hash=$h $BEXP/tx/$h"
  [ "$st" = "1" ] || { log "TX FAILED"; exit 1; }
  echo "$out" > evidence/last-base-receipt.json
}

wh_sequence() { # sequence of the token bridge's LogMessagePublished in the last Base receipt
  python - "$BCORE" "$BTB" <<'EOF'
import json,sys
core,tb=sys.argv[1].lower(),sys.argv[2].lower()
r=json.load(open("evidence/last-base-receipt.json"))
T="0x6eb224fb001ed210e379b335e35efe88672a8ce935d981a6896b27ffdf52a3b2"
for l in r["logs"]:
    if l["address"].lower()==core and l["topics"][0].lower()==T and l["topics"][1][-40:].lower()==tb[2:]:
        print(int(l["data"][2:66],16)); break
EOF
}

wh_vaa() { # wh_vaa <sequence>: poll Wormholescan until the guardian-signed VAA exists; prints hex
  local seq=$1 em; em=$(python -c "print('0'*24+'$BTB'[2:].lower())")
  local i
  for i in $(seq 1 240); do
    local v; v=$(curl -s "$WSCAN/api/v1/vaas/10004/$em/$seq" | python -c 'import json,sys,base64
try:
  d=json.load(sys.stdin)["data"]["vaa"]; print("0x"+base64.b64decode(d).hex())
except Exception: pass')
    if [ -n "$v" ]; then echo "$v"; return 0; fi
    sleep 15
  done
  return 1
}

state() {
  local A; A=$(ballast BallastAccount)
  local blk; blk=$(cast block-number --rpc-url "$R")
  log "STATE @block $blk account=$A"
  log "  troveStatus=$(cast call "$TM" "getTroveStatus(address)(uint8)" "$A" --rpc-url "$R" -b "$blk")"
  log "  troveDebt=$(cast call "$TM" "getTroveDebt(address)(uint256)" "$A" --rpc-url "$R" -b "$blk")"
  log "  trovePrincipal=$(cast call "$TM" "getTrovePrincipal(address)(uint256)" "$A" --rpc-url "$R" -b "$blk")"
  log "  troveColl=$(cast call "$TM" "getTroveColl(address)(uint256)" "$A" --rpc-url "$R" -b "$blk")"
  log "  NICR=$(cast call "$TM" "getNominalICR(address)(uint256)" "$A" --rpc-url "$R" -b "$blk")"
  local price; price=$(cast call "$PF" "fetchPrice()(uint256)" --rpc-url "$R" -b "$blk" | cut -d' ' -f1)
  log "  price=$price ICR=$(cast call "$TM" "getCurrentICR(address,uint256)(uint256)" "$A" "$price" --rpc-url "$R" -b "$blk")"
  log "  inSortedTroves=$(cast call "$ST" "contains(address)(bool)" "$A" --rpc-url "$R" -b "$blk") prev=$(cast call "$ST" "getPrev(address)(address)" "$A" --rpc-url "$R" -b "$blk") next=$(cast call "$ST" "getNext(address)(address)" "$A" --rpc-url "$R" -b "$blk")"
  log "  account MUSD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$A" --rpc-url "$R" -b "$blk") hedgeReserve=$(cast call "$A" "hedgeReserve()(uint256)" --rpc-url "$R" -b "$blk") maxRepayable=$(cast call "$A" "maxRepayable()(uint256)" --rpc-url "$R" -b "$blk")"
  log "  controller=$(cast call "$A" "controller()(address)" --rpc-url "$R" -b "$blk")"
  log "  payer MUSD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$PAYER_ADDRESS" --rpc-url "$R" -b "$blk") merchant MUSD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$DEPLOYER_ADDRESS" --rpc-url "$R" -b "$blk")"
}

cmd=${1:-}; shift || true
case "$cmd" in
preflight)
  log "PREFLIGHT chain=31611 block=$(cast block-number --rpc-url "$R")"
  log "  deployer $DEPLOYER_ADDRESS BTC=$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$R" --ether)"
  log "  payer    $PAYER_ADDRESS BTC=$(cast balance "$PAYER_ADDRESS" --rpc-url "$R" --ether)"
  for a in "$MUSD" "$BO" "$TM" "$ST" "$HH" "$PF"; do log "  code $a bytes=$(( ($(cast code "$a" --rpc-url "$R" | wc -c) - 3) / 2 ))"; done
  ;;
deploy)
  [ -z "$(ballast BallastFactory)" ] || { echo "already deployed per $CFG; refusing to overwrite"; exit 1; }
  forge script contracts/script/Deploy.s.sol --rpc-url "$R" --broadcast --slow 2>&1 | grep -v -i "private" | tee -a "$LOG"
  python - <<'EOF'
import json
cfg=json.load(open("config/deployments.mezo-testnet.json")); out=json.load(open("config/ballast-deploy.out.json"))
run=json.load(open("broadcast/Deploy.s.sol/31611/run-latest.json"))
txs={t["contractName"]:t["hash"].lower() for t in run["transactions"]}
rc={r["transactionHash"].lower():int(r["blockNumber"],16) for r in run["receipts"]}
cfg["ballast"]={k:out[k] for k in ("BallastRouter","BallastAccountNFT","BallastFactory")}
cfg["ballast"]["deployTx"]={k:{"hash":h,"block":rc.get(h)} for k,h in txs.items()}
json.dump(cfg,open("config/deployments.mezo-testnet.json","w"),indent=2)
print("wrote ballast addresses to config")
EOF
  for c in BallastRouter BallastAccountNFT BallastFactory; do a=$(ballast $c); log "  $c $a codeBytes=$(( ($(cast code "$a" --rpc-url "$R" | wc -c) - 3) / 2 )) $EXP/address/$a"; done
  ;;
create-account)
  F=$(ballast BallastFactory)
  send DEPLOYER_PRIVATE_KEY "$F" "createAccount()"
  python - <<'EOF'
import json
r=json.load(open("evidence/last-receipt.json")); cfg=json.load(open("config/deployments.mezo-testnet.json"))
topic=__import__("subprocess").check_output(["cast","keccak","AccountCreated(uint256,address,address)"],text=True).strip()
for lg in r["logs"]:
    if lg["topics"][0].lower()==topic.lower():
        tid=int(lg["topics"][1],16); acct="0x"+lg["topics"][2][-40:]; own="0x"+lg["topics"][3][-40:]
cfg["ballast"]["tokenId"]=tid; cfg["ballast"]["BallastAccount"]=__import__("subprocess").check_output(["cast","to-check-sum-address",acct],text=True).strip()
cfg["ballast"]["createAccountTx"]=r["transactionHash"]
json.dump(cfg,open("config/deployments.mezo-testnet.json","w"),indent=2)
print("tokenId",tid,"account",cfg["ballast"]["BallastAccount"],"owner",own)
EOF
  A=$(ballast BallastAccount); N=$(ballast BallastAccountNFT); T=$(ballast tokenId)
  log "  nft.ownerOf($T)=$(cast call "$N" "ownerOf(uint256)(address)" "$T" --rpc-url "$R") account.controller=$(cast call "$A" "controller()(address)" --rpc-url "$R") factory.accountOf=$(cast call "$(ballast BallastFactory)" "accountOf(uint256)(address)" "$T" --rpc-url "$R")"
  ;;
open-trove)
  DEBT=$(cast to-wei "$1"); COLL=$(cast to-wei "$2"); A=$(ballast BallastAccount)
  FEE=$(cast call "$BO" "getBorrowingFee(uint256)(uint256)" "$DEBT" --rpc-url "$R" | cut -d' ' -f1)
  COMPOSITE=$(python -c "print($DEBT+$FEE+200*10**18)")
  read -r UP LO <<<"$(hints "$COLL" "$COMPOSITE")"
  log "OPEN-TROVE debt=$DEBT fee=$FEE composite=$COMPOSITE coll=$COLL hints=$UP,$LO"
  state
  send DEPLOYER_PRIVATE_KEY "$A" "openTrove(uint256,address,address)" "$DEBT" "$UP" "$LO" --value "$COLL"
  state
  ;;
state) state ;;
repay)
  AMT=$(cast to-wei "$1"); A=$(ballast BallastAccount)
  COLL=$(cast call "$TM" "getTroveColl(address)(uint256)" "$A" --rpc-url "$R" | cut -d' ' -f1)
  P=$(cast call "$TM" "getTrovePrincipal(address)(uint256)" "$A" --rpc-url "$R" | cut -d' ' -f1)
  read -r UP LO <<<"$(hints "$COLL" "$(python -c "print(max($P-$AMT,1))")")"
  log "REPAY amount=$AMT hints=$UP,$LO"; state
  send DEPLOYER_PRIVATE_KEY "$A" "repay(uint256,address,address)" "$AMT" "$UP" "$LO"
  state
  ;;
fund-payer)
  A=$(ballast BallastAccount)
  send DEPLOYER_PRIVATE_KEY "$A" "withdrawMUSD(address,uint256)" "$PAYER_ADDRESS" "$(cast to-wei "$1")"
  ;;
set-policy)
  A=$(ballast BallastAccount)
  send DEPLOYER_PRIVATE_KEY "$A" "setPolicy(uint16,uint16,bool,address)" "$1" "$2" false 0x0000000000000000000000000000000000000000
  log "  policy=$(cast call "$A" "policy()((uint16,uint16,bool,address))" --rpc-url "$R")"
  ;;
pay-invoice)
  AMT=$(cast to-wei "$1"); A=$(ballast BallastAccount); RT=$(ballast BallastRouter); T=$(ballast tokenId)
  IID=$(cast keccak "ballast-invoice-$(date -u +%s)")
  EXPIRY=$(( $(date -u +%s) + 3600 ))
  cat > evidence/invoice.json <<EOF
{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],
"Invoice":[{"name":"tokenId","type":"uint256"},{"name":"invoiceId","type":"bytes32"},{"name":"amount","type":"uint256"},{"name":"expiry","type":"uint256"}]},
"primaryType":"Invoice","domain":{"name":"BallastRouter","version":"1","chainId":31611,"verifyingContract":"$RT"},
"message":{"tokenId":$T,"invoiceId":"$IID","amount":"$AMT","expiry":$EXPIRY}}
EOF
  SIG=$(cast wallet sign --data --from-file evidence/invoice.json --private-key "$DEPLOYER_PRIVATE_KEY")
  log "INVOICE tokenId=$T invoiceId=$IID amount=$AMT expiry=$EXPIRY (merchant-signed EIP-712)"
  P=$(cast call "$TM" "getTrovePrincipal(address)(uint256)" "$A" --rpc-url "$R" | cut -d' ' -f1)
  COLL=$(cast call "$TM" "getTroveColl(address)(uint256)" "$A" --rpc-url "$R" | cut -d' ' -f1)
  POL=$(cast call "$A" "policy()((uint16,uint16,bool,address))" --rpc-url "$R"); RB=$(echo "$POL" | tr -d '()' | cut -d, -f1 | tr -d ' ')
  read -r UP LO <<<"$(hints "$COLL" "$(python -c "print(max($P-$AMT*$RB//10000,1))")")"
  PAYOUT=$(cast call "$A" "payoutAddress()(address)" --rpc-url "$R")
  log "  policy=$POL payout=$PAYOUT hints=$UP,$LO"
  log "  BEFORE payout MUSD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$PAYOUT" --rpc-url "$R")"
  state
  send PAYER_PRIVATE_KEY "$MUSD" "approve(address,uint256)" "$RT" "$AMT"
  send PAYER_PRIVATE_KEY "$RT" "payInvoice((uint256,bytes32,uint256,uint256),bytes,address,address)" "($T,$IID,$AMT,$EXPIRY)" "$SIG" "$UP" "$LO"
  log "  AFTER payout MUSD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$PAYOUT" --rpc-url "$R")"
  log "  invoicePaid=$(cast call "$RT" "invoicePaid(uint256,bytes32)(bool)" "$T" "$IID" --rpc-url "$R")"
  state
  ;;
base-preflight)
  log "BASE-PREFLIGHT chain=$(cast chain-id --rpc-url "$BR") payer ETH=$(cast balance "$PAYER_ADDRESS" --ether --rpc-url "$BR") USDC=$(cast call "$BUSDC" "balanceOf(address)(uint256)" "$PAYER_ADDRESS" --rpc-url "$BR")"
  log "  Mezo bridge bridgeContracts(10004)=$(cast call "$MTB" "bridgeContracts(uint16)(bytes32)" 10004 --rpc-url "$R") wrapped USDC=$(cast call "$MTB" "wrappedAsset(uint16,bytes32)(address)" 10004 "$(cast to-bytes32 "$BUSDC" 2>/dev/null || python -c "print('0x'+'0'*24+'$BUSDC'[2:])")" --rpc-url "$R")"
  ;;
base-attest) # one-time: register Base Sepolia USDC with Wormhole and create its wrapped token on Mezo
  FEE=$(cast call "$BCORE" "messageFee()(uint256)" --rpc-url "$BR" | cut -d' ' -f1)
  sendb PAYER_PRIVATE_KEY "$BTB" "attestToken(address,uint32)" "$BUSDC" "$RANDOM" --value "$FEE"
  SEQ=$(wh_sequence); log "  attest sequence=$SEQ; waiting for guardians"
  V=$(wh_vaa "$SEQ") || { log "VAA not available yet for seq $SEQ"; exit 1; }
  log "  VAA received (${#V} hex chars)"
  send PAYER_PRIVATE_KEY "$MTB" "createWrapped(bytes)" "$V"
  W=$(cast to-check-sum-address "$(cast call "$MTB" "wrappedAsset(uint16,bytes32)(address)" 10004 "0x000000000000000000000000${BUSDC:2}" --rpc-url "$R")")
  cfgset BridgedUSDC "$W"
  log "  wrapped USDC on Mezo=$W name=$(cast call "$W" "name()(string)" --rpc-url "$R") decimals=$(cast call "$W" "decimals()(uint8)" --rpc-url "$R")"
  ;;
base-bridge) # base-bridge <USDC>: payer moves USDC from Base Sepolia to its own address on Mezo (plain transfer)
  AMT=$(python -c "print(int(float('$1')*10**6))"); FEE=$(cast call "$BCORE" "messageFee()(uint256)" --rpc-url "$BR" | cut -d' ' -f1)
  sendb PAYER_PRIVATE_KEY "$BUSDC" "approve(address,uint256)" "$BTB" "$AMT"
  sendb PAYER_PRIVATE_KEY "$BTB" "transferTokens(address,uint256,uint16,bytes32,uint256,uint32)" "$BUSDC" "$AMT" 50 "0x000000000000000000000000${PAYER_ADDRESS:2}" 0 "$RANDOM" --value "$FEE"
  SEQ=$(wh_sequence); log "  transfer sequence=$SEQ; waiting for guardians"
  V=$(wh_vaa "$SEQ") || { log "VAA not available yet for seq $SEQ"; exit 1; }
  send PAYER_PRIVATE_KEY "$MTB" "completeTransfer(bytes)" "$V"
  log "  payer wrapped USDC on Mezo=$(cast call "$(ballast BridgedUSDC)" "balanceOf(address)(uint256)" "$PAYER_ADDRESS" --rpc-url "$R")"
  ;;
create-usdc-pool) # create-usdc-pool <USDC> <MUSD>: payer creates the stable wUSDC/MUSD pool and seeds it (labelled: seeded by Ballast)
  W=$(ballast BridgedUSDC); UA=$(python -c "print(int(float('$1')*10**6))"); MA=$(cast to-wei "$2")
  P=$(cast call "$POOL_FACTORY" "getPool(address,address,bool)(address)" "$W" "$MUSD" true --rpc-url "$R")
  [ "$P" != "0x0000000000000000000000000000000000000000" ] || send PAYER_PRIVATE_KEY "$POOL_FACTORY" "createPool(address,address,bool)" "$W" "$MUSD" true
  P=$(cast to-check-sum-address "$(cast call "$POOL_FACTORY" "getPool(address,address,bool)(address)" "$W" "$MUSD" true --rpc-url "$R")")
  cfgset UsdcMusdPool "$P"
  send PAYER_PRIVATE_KEY "$W" "approve(address,uint256)" "$POOLS_ROUTER" "$UA"
  send PAYER_PRIVATE_KEY "$MUSD" "approve(address,uint256)" "$POOLS_ROUTER" "$MA"
  send PAYER_PRIVATE_KEY "$POOLS_ROUTER" "addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address,uint256)" "$W" "$MUSD" true "$UA" "$MA" 0 0 "$PAYER_ADDRESS" $(( $(date -u +%s) + 1800 ))
  log "  pool=$P reserves=$(cast call "$P" "getReserves()(uint256,uint256,uint256)" --rpc-url "$R" | tr '\n' ' ')"
  ;;
deploy-receiver)
  [ -z "$(ballast BallastBridgeReceiver)" ] || { echo "receiver already deployed per $CFG; refusing to overwrite"; exit 1; }
  forge build >/dev/null
  create BallastBridgeReceiver out/BallastBridgeReceiver.sol/BallastBridgeReceiver.json "c(address,uint16,bytes32,address,address,address,address)" "$MTB" 10004 "0x000000000000000000000000${BUSDC:2}" "$POOLS_ROUTER" "$POOL_FACTORY" "$MUSD" "$(ballast BallastRouter)"
  log "  wrappedUsdc()=$(cast call "$(ballast BallastBridgeReceiver)" "wrappedUsdc()(address)" --rpc-url "$R")"
  ;;
pay-base-invoice) # pay-base-invoice <MUSD>: merchant (deployer) signs a Ballast invoice; payer pays it with USDC from Base Sepolia
  AMT=$(cast to-wei "$1"); A=$(ballast BallastAccount); RT=$(ballast BallastRouter); T=$(ballast tokenId); RCV=$(ballast BallastBridgeReceiver); W=$(ballast BridgedUSDC)
  IID=$(cast keccak "ballast-base-invoice-$(date -u +%s)"); EXPIRY=$(( $(date -u +%s) + 7200 ))
  cat > evidence/invoice.json <<EOF2
{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],
"Invoice":[{"name":"tokenId","type":"uint256"},{"name":"invoiceId","type":"bytes32"},{"name":"amount","type":"uint256"},{"name":"expiry","type":"uint256"}]},
"primaryType":"Invoice","domain":{"name":"BallastRouter","version":"1","chainId":31611,"verifyingContract":"$RT"},
"message":{"tokenId":$T,"invoiceId":"$IID","amount":"$AMT","expiry":$EXPIRY}}
EOF2
  SIG=$(cast wallet sign --data --from-file evidence/invoice.json --private-key "$DEPLOYER_PRIVATE_KEY")
  USDC_AMT=$(python -c "print(($AMT//10**12+1)*10100//10000+1)")
  Q=$(quote "$USDC_AMT" "$W" "$MUSD" true)
  log "BASE-INVOICE tokenId=$T invoiceId=$IID amount=$AMT expiry=$EXPIRY usdcSent=$USDC_AMT poolQuoteMUSD=$Q receiver=$RCV"
  PAYLOAD=$(cast call "$RCV" "encodePayload((uint8,(uint256,bytes32,uint256,uint256),bytes,address,uint256))(bytes)" "(1,($T,$IID,$AMT,$EXPIRY),$SIG,$PAYER_ADDRESS,$AMT)" --rpc-url "$R")
  FEE=$(cast call "$BCORE" "messageFee()(uint256)" --rpc-url "$BR" | cut -d' ' -f1)
  state
  sendb PAYER_PRIVATE_KEY "$BUSDC" "approve(address,uint256)" "$BTB" "$USDC_AMT"
  sendb PAYER_PRIVATE_KEY "$BTB" "transferTokensWithPayload(address,uint256,uint16,bytes32,uint32,bytes)" "$BUSDC" "$USDC_AMT" 50 "0x000000000000000000000000${RCV:2}" "$RANDOM" "$PAYLOAD" --value "$FEE"
  SEQ=$(wh_sequence); log "  Wormhole sequence=$SEQ (emitter Base Sepolia token bridge); waiting for guardians"
  V=$(wh_vaa "$SEQ") || { log "VAA not available yet for seq $SEQ — rerun settle-base $SEQ later"; exit 1; }
  echo "$SEQ" > evidence/last-base-seq.txt
  "$0" settle-base "$SEQ"
  ;;
settle-base) # settle-base <sequence>: anyone (payer here) submits the VAA to BallastBridgeReceiver on Mezo
  SEQ=$1; RCV=$(ballast BallastBridgeReceiver); A=$(ballast BallastAccount)
  V=$(wh_vaa "$SEQ") || { log "VAA not available for seq $SEQ"; exit 1; }
  COLL=$(cast call "$TM" "getTroveColl(address)(uint256)" "$A" --rpc-url "$R" | cut -d' ' -f1)
  P=$(cast call "$TM" "getTrovePrincipal(address)(uint256)" "$A" --rpc-url "$R" | cut -d' ' -f1)
  read -r UP LO <<<"$(hints "$COLL" "$P")"
  log "SETTLE-BASE seq=$SEQ hints=$UP,$LO payout MUSD before=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$(cast call "$A" "payoutAddress()(address)" --rpc-url "$R")" --rpc-url "$R")"
  send PAYER_PRIVATE_KEY "$RCV" "settle(bytes,address,address)" "$V" "$UP" "$LO" --gas-limit 3500000
  log "  payout MUSD after=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$(cast call "$A" "payoutAddress()(address)" --rpc-url "$R")" --rpc-url "$R") receiver MUSD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$RCV" --rpc-url "$R")"
  state
  ;;
deploy-hedge-stack) # Morpho Blue v1.0.0 + AdaptiveCurveIrm (upstream bytecode) + Mezo oracle + market + BallastHedgeFactory
  [ -z "$(ballast Morpho)" ] || { echo "hedge stack already deployed per $CFG; refusing to overwrite"; exit 1; }
  [ -f .upstream/morpho-blue/out/Morpho.sol/Morpho.json ] || scripts/fetch-morpho.sh
  forge build >/dev/null
  cfgset MorphoBTC 0x7b7C000000000000000000000000000000000000
  create Morpho .upstream/morpho-blue/out/Morpho.sol/Morpho.json "c(address)" "$DEPLOYER_ADDRESS"; MO=$CREATED
  create AdaptiveCurveIrm .upstream/morpho-blue-irm/out/AdaptiveCurveIrm.sol/AdaptiveCurveIrm.json "c(address)" "$MO"
  create BallastMezoOracle out/BallastMezoOracle.sol/BallastMezoOracle.json "c(address)" "$PF"
  log "  oracle.price()=$(cast call "$(ballast BallastMezoOracle)" "price()(uint256)" --rpc-url "$R") PriceFeed=$(cast call "$PF" "fetchPrice()(uint256)" --rpc-url "$R")"
  send DEPLOYER_PRIVATE_KEY "$MO" "enableIrm(address)" "$(ballast AdaptiveCurveIrm)"
  send DEPLOYER_PRIVATE_KEY "$MO" "enableLltv(uint256)" 860000000000000000
  send DEPLOYER_PRIVATE_KEY "$MO" "createMarket((address,address,address,address,uint256))" "$(mp_tuple)"
  MID=$(cast keccak "$(cast abi-encode "f((address,address,address,address,uint256))" "$(mp_tuple)")")
  cfgset MorphoMarketId "$MID"
  log "  marketId=$MID market=$(cast call "$MO" "market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)" "$MID" --rpc-url "$R" | tr '\n' ' ')"
  create BallastHedgeFactory out/BallastHedge.sol/BallastHedgeFactory.json "c(address,address,(address,address,address,address,uint256),address,address)" "$(ballast BallastFactory)" "$MO" "$(mp_tuple)" "$POOLS_ROUTER" "$POOL_FACTORY"
  ;;
supply-btc) # supply-btc <BTC>: deployer lends BTC to the Ballast Morpho market (the market's only liquidity)
  AMT=$(cast to-wei "$1"); MO=$(ballast Morpho)
  send DEPLOYER_PRIVATE_KEY "$(ballast MorphoBTC)" "approve(address,uint256)" "$MO" "$AMT"
  send DEPLOYER_PRIVATE_KEY "$MO" "supply((address,address,address,address,uint256),uint256,uint256,address,bytes)" "$(mp_tuple)" "$AMT" 0 "$DEPLOYER_ADDRESS" 0x
  "$0" hedge-state
  ;;
withdraw-musd) # withdraw-musd <to> <MUSD>: controller withdraws free MUSD from the Ballast account
  send DEPLOYER_PRIVATE_KEY "$(ballast BallastAccount)" "withdrawMUSD(address,uint256)" "$1" "$(cast to-wei "$2")"
  ;;
hedge-create)
  HF=$(ballast BallastHedgeFactory); T=$(ballast tokenId)
  send DEPLOYER_PRIVATE_KEY "$HF" "create(uint256)" "$T"
  H=$(cast to-check-sum-address "$(cast call "$HF" "hedgeOf(uint256)(address)" "$T" --rpc-url "$R")")
  cfgset BallastHedge "$H"
  log "  hedge for token $T = $H controller=$(cast call "$H" "controller()(address)" --rpc-url "$R")"
  ;;
hedge-state)
  MO=$(ballast Morpho); MID=$(ballast MorphoMarketId); H=$(ballast BallastHedge); blk=$(cast block-number --rpc-url "$R")
  log "HEDGE-STATE @block $blk market(totalSupply,supplyShares,totalBorrow,borrowShares,lastUpdate,fee)=$(cast call "$MO" "market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)" "$MID" --rpc-url "$R" -b "$blk" | tr '\n' ' ')"
  log "  oracle.price=$(cast call "$(ballast BallastMezoOracle)" "price()(uint256)" --rpc-url "$R" -b "$blk") PriceFeed=$(cast call "$PF" "fetchPrice()(uint256)" --rpc-url "$R" -b "$blk")"
  if [ -n "$H" ]; then log "  hedge $H position(collateral,borrowShares,btcOwed)=$(cast call "$H" "positionInfo()(uint256,uint256,uint256)" --rpc-url "$R" -b "$blk" | tr '\n' ' ') MUSD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$H" --rpc-url "$R" -b "$blk") BTC=$(cast call "$(ballast MorphoBTC)" "balanceOf(address)(uint256)" "$H" --rpc-url "$R" -b "$blk")"; fi
  ;;
hedge-open) # hedge-open <collateralMUSD> <borrowBTC>: controller (deployer) opens the short
  C=$(cast to-wei "$1"); B=$(cast to-wei "$2"); H=$(ballast BallastHedge); BTC=$(ballast MorphoBTC)
  Q=$(quote "$B" "$BTC" "$MUSD" false); MIN=$(python -c "print($Q*99//100)")
  log "HEDGE-OPEN collateral=$C borrowBTC=$B quoteMUSD=$Q minOut=$MIN"
  "$0" hedge-state
  send DEPLOYER_PRIVATE_KEY "$MUSD" "approve(address,uint256)" "$H" "$C"
  send DEPLOYER_PRIVATE_KEY "$H" "open(uint256,uint256,uint256)" "$C" "$B" "$MIN"
  "$0" hedge-state
  ;;
hedge-close) # buys back with proceeds (+ top-up from the controller if needed), repays Morpho, withdraws collateral
  H=$(ballast BallastHedge); BTC=$(ballast MorphoBTC); MO=$(ballast Morpho)
  send DEPLOYER_PRIVATE_KEY "$MO" "accrueInterest((address,address,address,address,uint256))" "$(mp_tuple)"
  OWED=$(cast call "$H" "positionInfo()(uint256,uint256,uint256)" --rpc-url "$R" | sed -n 3p | cut -d' ' -f1)
  HELD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$H" --rpc-url "$R" | cut -d' ' -f1)
  NEED=$(quote "$(python -c "print($OWED*102//100)")" "$BTC" "$MUSD" false)
  TOP=$(python -c "print(max(0,$NEED-$HELD))"); IN=$(python -c "print($HELD+$TOP)")
  log "HEDGE-CLOSE owedBTC=$OWED heldMUSD=$HELD spendMUSD=$IN topUp=$TOP minBtcOut=$OWED"
  [ "$TOP" = "0" ] || send DEPLOYER_PRIVATE_KEY "$MUSD" "approve(address,uint256)" "$H" "$TOP"
  send DEPLOYER_PRIVATE_KEY "$H" "close(uint256,uint256,uint256)" "$IN" "$OWED" "$TOP"
  "$0" hedge-state
  ;;
hedge-to-account)
  send DEPLOYER_PRIVATE_KEY "$(ballast BallastHedge)" "sendToAccount()"
  state
  ;;
deploy-adapter)
  [ -z "$(ballast BallastRepaymentAdapter)" ] || { echo "adapter already deployed per $CFG; refusing to overwrite"; exit 1; }
  BOS=$(cast call "$BO" "borrowerOperationsSignaturesAddress()(address)" --rpc-url "$R")
  log "DEPLOY-ADAPTER signatures=$BOS (read from BorrowerOperations) tm=$TM musd=$MUSD"
  OUT=$(forge create contracts/src/BallastRepaymentAdapter.sol:BallastRepaymentAdapter --rpc-url "$R" --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --json --constructor-args "$BOS" "$TM" "$MUSD")
  AD=$(echo "$OUT" | python -c 'import json,sys;print(json.load(sys.stdin)["deployedTo"])')
  H=$(echo "$OUT" | python -c 'import json,sys;print(json.load(sys.stdin)["transactionHash"])')
  B=$(cast receipt "$H" blockNumber --rpc-url "$R"); S=$(cast receipt "$H" status --rpc-url "$R")
  log "TX deploy BallastRepaymentAdapter status=$S block=$B hash=$H $EXP/tx/$H"
  [ "$S" = "1 (success)" ] || [ "$S" = "1" ] || { log "TX FAILED"; exit 1; }
  log "  adapter=$AD codeBytes=$(( ($(cast code "$AD" --rpc-url "$R" | wc -c) - 3) / 2 )) borrowerOperations()=$(cast call "$AD" "borrowerOperations()(address)" --rpc-url "$R")"
  python - "$AD" "$H" "$B" "$BOS" <<'EOF'
import json,sys
ad,h,b,bos=sys.argv[1:5]
cfg=json.load(open("config/deployments.mezo-testnet.json"))
cfg["mezo"]["BorrowerOperationsSignatures"]=bos
cfg["ballast"]["BallastRepaymentAdapter"]=ad
cfg["ballast"]["deployTx"]["BallastRepaymentAdapter"]={"hash":h,"block":int(b)}
json.dump(cfg,open("config/deployments.mezo-testnet.json","w"),indent=2)
print("wrote adapter to config")
EOF
  ;;
wallet-state) # wallet-state <address>: an ordinary wallet-held Mezo trove
  W=$1; blk=$(cast block-number --rpc-url "$R")
  log "WALLET-STATE @block $blk borrower=$W status=$(cast call "$TM" "getTroveStatus(address)(uint8)" "$W" --rpc-url "$R" -b "$blk") debt=$(cast call "$TM" "getTroveDebt(address)(uint256)" "$W" --rpc-url "$R" -b "$blk") coll=$(cast call "$TM" "getTroveColl(address)(uint256)" "$W" --rpc-url "$R" -b "$blk") MUSD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$W" --rpc-url "$R" -b "$blk")"
  ;;
open-wallet-trove) # open-wallet-trove <debtMUSD> <collBTC>: PAYER wallet opens its OWN trove (an existing, non-Ballast borrower)
  DEBT=$(cast to-wei "$1"); COLL=$(cast to-wei "$2")
  FEE=$(cast call "$BO" "getBorrowingFee(uint256)(uint256)" "$DEBT" --rpc-url "$R" | cut -d' ' -f1)
  read -r UP LO <<<"$(hints "$COLL" "$(python -c "print($DEBT+$FEE+200*10**18)")")"
  log "OPEN-WALLET-TROVE borrower=$PAYER_ADDRESS debt=$DEBT fee=$FEE coll=$COLL hints=$UP,$LO"
  send PAYER_PRIVATE_KEY "$BO" "openTrove(uint256,address,address)" "$DEBT" "$UP" "$LO" --value "$COLL"
  "$0" wallet-state "$PAYER_ADDRESS"
  ;;
wallet-borrow) # wallet-borrow <MUSD>: PAYER wallet borrows more from its own trove (adds repayable headroom above the floor)
  AMT=$(cast to-wei "$1")
  FEE=$(cast call "$BO" "getBorrowingFee(uint256)(uint256)" "$AMT" --rpc-url "$R" | cut -d' ' -f1)
  COLL=$(cast call "$TM" "getTroveColl(address)(uint256)" "$PAYER_ADDRESS" --rpc-url "$R" | cut -d' ' -f1)
  P=$(cast call "$TM" "getTrovePrincipal(address)(uint256)" "$PAYER_ADDRESS" --rpc-url "$R" | cut -d' ' -f1)
  read -r UP LO <<<"$(hints "$COLL" "$(python -c "print($P+$AMT+$FEE)")")"
  log "WALLET-BORROW borrower=$PAYER_ADDRESS amount=$AMT fee=$FEE hints=$UP,$LO"
  send PAYER_PRIVATE_KEY "$BO" "withdrawMUSD(uint256,address,address)" "$AMT" "$UP" "$LO"
  "$0" wallet-state "$PAYER_ADDRESS"
  ;;
pay-direct-invoice) # pay-direct-invoice <amountMUSD> <repayMUSD>: merchant = PAYER wallet trove, customer = DEPLOYER
  AMT=$(cast to-wei "$1"); RP=$(cast to-wei "$2"); AD=$(ballast BallastRepaymentAdapter); M=$PAYER_ADDRESS
  BOS=$(j "d['mezo']['BorrowerOperationsSignatures']")
  IID=$(cast keccak "ballast-direct-invoice-$(date -u +%s)"); EXPIRY=$(( $(date -u +%s) + 3600 )); DL=$(( $(date -u +%s) + 3600 ))
  NONCE=$(cast call "$AD" "mezoNonce(address)(uint256)" "$M" --rpc-url "$R" | cut -d' ' -f1)
  cat > evidence/direct-invoice.json <<EOF
{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],
"DirectInvoice":[{"name":"merchant","type":"address"},{"name":"invoiceId","type":"bytes32"},{"name":"amount","type":"uint256"},{"name":"repayAmount","type":"uint256"},{"name":"expiry","type":"uint256"}]},
"primaryType":"DirectInvoice","domain":{"name":"BallastRepaymentAdapter","version":"1","chainId":31611,"verifyingContract":"$AD"},
"message":{"merchant":"$M","invoiceId":"$IID","amount":"$AMT","repayAmount":"$RP","expiry":$EXPIRY}}
EOF
  cat > evidence/mezo-repay.json <<EOF
{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],
"RepayMUSD":[{"name":"amount","type":"uint256"},{"name":"borrower","type":"address"},{"name":"nonce","type":"uint256"},{"name":"deadline","type":"uint256"}]},
"primaryType":"RepayMUSD","domain":{"name":"BorrowerOperationsSignatures","version":"1","chainId":31611,"verifyingContract":"$BOS"},
"message":{"amount":"$RP","borrower":"$M","nonce":"$NONCE","deadline":"$DL"}}
EOF
  ISIG=$(cast wallet sign --data --from-file evidence/direct-invoice.json --private-key "$PAYER_PRIVATE_KEY")
  RSIG=$(cast wallet sign --data --from-file evidence/mezo-repay.json --private-key "$PAYER_PRIVATE_KEY")
  COLL=$(cast call "$TM" "getTroveColl(address)(uint256)" "$M" --rpc-url "$R" | cut -d' ' -f1)
  P=$(cast call "$TM" "getTrovePrincipal(address)(uint256)" "$M" --rpc-url "$R" | cut -d' ' -f1)
  read -r UP LO <<<"$(hints "$COLL" "$(python -c "print(max($P-$RP,1))")")"
  log "DIRECT-INVOICE merchant=$M invoiceId=$IID amount=$AMT repay=$RP expiry=$EXPIRY mezoNonce=$NONCE deadline=$DL hints=$UP,$LO (both signatures by merchant wallet, off-chain)"
  log "  BEFORE customer MUSD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$DEPLOYER_ADDRESS" --rpc-url "$R")"
  "$0" wallet-state "$M"
  send DEPLOYER_PRIVATE_KEY "$MUSD" "approve(address,uint256)" "$AD" "$AMT"
  send DEPLOYER_PRIVATE_KEY "$AD" "payDirectInvoice((address,bytes32,uint256,uint256,uint256),bytes,(uint256,bytes,address,address))" "($M,$IID,$AMT,$RP,$EXPIRY)" "$ISIG" "($DL,$RSIG,$UP,$LO)"
  log "  AFTER customer MUSD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$DEPLOYER_ADDRESS" --rpc-url "$R") adapter MUSD=$(cast call "$MUSD" "balanceOf(address)(uint256)" "$AD" --rpc-url "$R")"
  log "  invoicePaid=$(cast call "$AD" "invoicePaid(bytes32)(bool)" "$(cast call "$AD" "invoiceKey(address,bytes32)(bytes32)" "$M" "$IID" --rpc-url "$R")" --rpc-url "$R") mezoNonce=$(cast call "$AD" "mezoNonce(address)(uint256)" "$M" --rpc-url "$R")"
  "$0" wallet-state "$M"
  ;;
pay-direct-link) # pay-direct-link <url>: DEPLOYER pays a wallet-loan invoice link created by the app / make-direct-invoice.ts
  CODE=${1##*/pay/}; AD=$(ballast BallastRepaymentAdapter)
  read -r M AMT RP EXPIRY MEMO_SALT ISIG RSIG <<<"$(python - "$CODE" <<'EOF'
import base64,json,sys
s=sys.argv[1]; s=s.replace('-','+').replace('_','/'); s+='='*(-len(s)%4); p=json.loads(base64.b64decode(s))
assert p["v"]==2
print(p["merchant"],p["amount"],p["repayAmount"],p["expiry"],"-",p["invoiceSig"],p["repaySig"] or "0x")
EOF
)"
  IID=$(python - "$CODE" <<'EOF'
import base64,json,sys,subprocess
s=sys.argv[1]; s=s.replace('-','+').replace('_','/'); s+='='*(-len(s)%4); p=json.loads(base64.b64decode(s))
enc=subprocess.check_output(["cast","abi-encode","f(string,bytes32)",p["memo"],p["salt"]],text=True).strip()
print(subprocess.check_output(["cast","keccak",enc],text=True).strip())
EOF
)
  COLL=$(cast call "$TM" "getTroveColl(address)(uint256)" "$M" --rpc-url "$R" | cut -d' ' -f1)
  P=$(cast call "$TM" "getTrovePrincipal(address)(uint256)" "$M" --rpc-url "$R" | cut -d' ' -f1)
  read -r UP LO <<<"$(hints "$COLL" "$(python -c "print(max($P-$RP,1))")")"
  log "PAY-DIRECT-LINK merchant=$M invoiceId=$IID amount=$AMT repay=$RP expiry=$EXPIRY hints=$UP,$LO (signatures from the link, made with viem)"
  "$0" wallet-state "$M"
  send DEPLOYER_PRIVATE_KEY "$MUSD" "approve(address,uint256)" "$AD" "$AMT"
  send DEPLOYER_PRIVATE_KEY "$AD" "payDirectInvoice((address,bytes32,uint256,uint256,uint256),bytes,(uint256,bytes,address,address))" "($M,$IID,$AMT,$RP,$EXPIRY)" "$ISIG" "($EXPIRY,$RSIG,$UP,$LO)"
  log "  invoicePaid=$(cast call "$AD" "invoicePaid(bytes32)(bool)" "$(cast call "$AD" "invoiceKey(address,bytes32)(bytes32)" "$M" "$IID" --rpc-url "$R")" --rpc-url "$R") mezoNonce=$(cast call "$AD" "mezoNonce(address)(uint256)" "$M" --rpc-url "$R")"
  "$0" wallet-state "$M"
  ;;
*) sed -n 2,20p "$0"; exit 1 ;;
esac
