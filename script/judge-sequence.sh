#!/usr/bin/env bash
# Runs the judges' sequence on Base Sepolia from the test wallet in .env:
# deposit (payday + SIP into the vault), borrow, stress scenario (price gap, emergency rule,
# paused transfers), repay, withdraw. Prints one line per step with its transaction hash.
# Testnet only. Never prints the private key.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a; . ./.env; set +a
R="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
[ "$(cast chain-id --rpc-url "$R")" = "84532" ] || { echo "Refusing: not Base Sepolia"; exit 1; }

j() { python -c "import json,sys;print(json.load(open('deployments/base-sepolia.json'))[sys.argv[1]])" "$1"; }
ME=$(cast wallet address --private-key "$PRIVATE_KEY")
USDC=$(j usdc); PAYROLL=$(j payroll); FACTORY=$(j vaultFactory); STOCK=$(j mAAPL); FEED=$(j mAAPLFeed)
OUT="deployments/judge-sequence.txt"; : > "$OUT"

step() { # label, to, signature, args...
  local label="$1"; shift
  local h
  h=$(cast send "$@" --rpc-url "$R" --private-key "$PRIVATE_KEY" --gas-limit 1200000 --json 2>/dev/null \
      | python -c "import json,sys;d=json.load(sys.stdin);print(d['transactionHash'], d['status'])")
  echo "$label | $h" | tee -a "$OUT"
  case "$h" in *0x1) ;; *) echo "STEP FAILED: $label"; exit 1;; esac
}
view() { cast call "$@" --rpc-url "$R" | awk '{print $1}'; }
note() { echo "   -> $1" | tee -a "$OUT"; }

step "0. Employee sets emergency rule (health <= 1.5 -> 50% of salary)" "$PAYROLL" "setEmergencyRule(address,uint16,uint256)" "$STOCK" 5000 1500000000000000000
step "1a. Employer approves USDC" "$USDC" "approve(address,uint256)" "$PAYROLL" 9000000
step "1b. Employer runs payroll (5 USDC salary)" "$PAYROLL" "depositAndCreateRun(uint256,address[],uint256[])" 5000000 "[$ME]" "[5000000]"
RUN=$(view "$PAYROLL" "runCount()(uint256)")
step "2. DEPOSIT: employee claims, 40% SIP buys mAAPL into the vault" "$PAYROLL" "claimWithSip(uint256,address,address,uint16,uint256)" "$RUN" "$ME" "$STOCK" 4000 0
VAULT=$(view "$FACTORY" "vaultOf(address)(address)" "$ME")
IDLE=$(view "$VAULT" "idleOf(address)(uint256)" "$STOCK")
note "vault $VAULT holds $IDLE mAAPL (8 decimals)"
step "3. BORROW: vault posts the stock and borrows 0.60 USDC from Morpho" "$VAULT" "borrow(address,uint256,uint256,address)" "$STOCK" "$IDLE" 600000 "$ME"
note "loan health $(view "$VAULT" "healthFactor(address)(uint256)" "$STOCK") (1e18 = liquidation line)"
step "4a. STRESS: overnight gap, mock price drops 30% (357 -> 249.90)" "$FEED" "setPrice(int256)" 24990000000
note "loan health after the gap $(view "$VAULT" "healthFactor(address)(uint256)" "$STOCK"), emergency rule active: $(view "$PAYROLL" "emergencyActive(address)(bool)" "$ME")"
step "4b. Employer runs the next payroll (4 USDC)" "$PAYROLL" "depositAndCreateRun(uint256,address[],uint256[])" 4000000 "[$ME]" "[4000000]"
RUN2=$(view "$PAYROLL" "runCount()(uint256)")
C1=$(view "$VAULT" "collateralOf(address)(uint256)" "$STOCK")
step "4c. EMERGENCY RULE: payday while the loan is risky, 50% of salary buys stock for collateral" "$PAYROLL" "claim(uint256,address,uint256)" "$RUN2" "$ME" 0
C2=$(view "$VAULT" "collateralOf(address)(uint256)" "$STOCK")
note "collateral went from $C1 to $C2, loan health now $(view "$VAULT" "healthFactor(address)(uint256)" "$STOCK")"
[ "$C2" -gt "$C1" ] || { echo "STEP FAILED: emergency rule did not add collateral"; exit 1; }
step "4d. STRESS: transfers of the mock stock are paused" "$STOCK" "setTransfersPaused(bool)" true
step "4e. Approve USDC for repaying" "$USDC" "approve(address,uint256)" "$VAULT" 2000000
step "4f. REPAY during the pause still works (0.20 USDC)" "$VAULT" "repay(address,uint256)" "$STOCK" 200000
if cast call "$VAULT" "removeCollateral(address,uint256)" "$STOCK" 1 --from "$ME" --rpc-url "$R" >/dev/null 2>&1; then
  echo "STEP FAILED: collateral could move during the pause"; exit 1
else
  note "checked: taking collateral out during the pause is refused"
fi
step "4g. Transfers resume" "$STOCK" "setTransfersPaused(bool)" false
step "4h. Price recovers to 357" "$FEED" "setPrice(int256)" 35700000000
step "5. REPAY: the whole loan" "$VAULT" "repay(address,uint256)" "$STOCK" 115792089237316195423570985008687907853269984665640564039457584007913129639935
step "5b. Remove the USDC allowance" "$USDC" "approve(address,uint256)" "$VAULT" 0
ALL=$(view "$VAULT" "collateralOf(address)(uint256)" "$STOCK")
step "6. WITHDRAW: all stock back to the wallet" "$VAULT" "withdraw(address,uint256,address)" "$STOCK" "$ALL" "$ME"
note "final: debt $(view "$VAULT" "debtOf(address)(uint256)" "$STOCK"), collateral $(view "$VAULT" "collateralOf(address)(uint256)" "$STOCK"), wallet mAAPL $(view "$STOCK" "balanceOf(address)(uint256)" "$ME")"
echo "Saved to $OUT"
