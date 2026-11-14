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
