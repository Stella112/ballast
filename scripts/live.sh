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
mkdir -p evidence; LOG="evidence/live-$(date -u +%Y%m%d).log"
log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }
ballast() { j "(d.get('ballast') or {}).get('$1','')"; }

send() { # send <pkvar> <to> <sig> [args...] ; logs hash, block, status
  local pkv=$1; shift
  local out; out=$(cast send --rpc-url "$R" --private-key "${!pkv}" --json "$@")
  local h b s; h=$(echo "$out" | python -c 'import json,sys;print(json.load(sys.stdin)["transactionHash"])')
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
txs={t["contractName"]:t["hash"] for t in run["transactions"]}
rc={r["transactionHash"]:int(r["blockNumber"],16) for r in run["receipts"]}
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
*) sed -n 2,16p "$0"; exit 1 ;;
esac
