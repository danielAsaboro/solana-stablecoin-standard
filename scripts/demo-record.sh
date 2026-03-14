#!/usr/bin/env bash
# =============================================================================
# SSS Demo Recording Script
# =============================================================================
# Runs the full SSS-2 enforcement flow against localnet (Surfpool).
#
# Prerequisites:
#   1. Surfpool running from project root: npm run surfpool:start
#   2. Programs + CLI built: npm run build:packages
#   3. spl-token CLI installed (comes with Solana tools)
#
# Usage:
#   ./scripts/demo-record.sh                  # Interactive, localnet
#   ./scripts/demo-record.sh --fast           # No pauses (for CI / dry-run testing)
#   ./scripts/demo-record.sh --devnet         # Interactive, devnet
#   ./scripts/demo-record.sh --devnet --fast  # No pauses, devnet
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ---------------------------------------------------------------------------
# Parse flags
# ---------------------------------------------------------------------------
FAST_MODE=false
USE_DEVNET=false
for arg in "$@"; do
  case "$arg" in
    --fast)   FAST_MODE=true ;;
    --devnet) USE_DEVNET=true ;;
  esac
done

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
if [[ "$USE_DEVNET" == "true" ]]; then
  RPC_URL="${RPC_URL:-https://api.devnet.solana.com}"
else
  RPC_URL="${RPC_URL:-http://127.0.0.1:8899}"
fi
AUTHORITY_KEYPAIR="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
CLI="node $ROOT_DIR/cli/dist/bin/sss-token.js"

# Token-2022 program ID
T22="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

# Keypair paths for demo wallets
ALICE_KEY="$HOME/demo-alice.json"
BOB_KEY="$HOME/demo-bob.json"
VICTIM_KEY="$HOME/demo-victim.json"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
CYAN="\033[36m"
DIM="\033[2m"
RESET="\033[0m"

step_num=0
step() {
  step_num=$((step_num + 1))
  echo ""
  echo -e "${BOLD}${CYAN}━━━ Step $step_num: $1 ━━━${RESET}"
  echo ""
}

info() { echo -e "${GREEN}▸${RESET} $1"; }
warn() { echo -e "${YELLOW}▸${RESET} $1"; }
fail() { echo -e "${RED}✗${RESET} $1"; }
cmd()  { echo -e "${DIM}\$ $1${RESET}"; }

pause() {
  if [[ "$FAST_MODE" == "false" ]]; then
    echo ""
    echo -e "${DIM}Press Enter to continue...${RESET}"
    read -r
  fi
}

run_sss() {
  cmd "npx sss-token $*"
  $CLI -u "$RPC_URL" -k "$AUTHORITY_KEYPAIR" -y "$@"
}

expect_fail() {
  local desc="$1"; shift
  cmd "$*"
  if "$@" 2>&1; then
    fail "Expected failure but command succeeded: $desc"
    exit 1
  else
    info "Transfer rejected as expected ($desc)"
  fi
}

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║     SSS Demo Recording Script            ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}"
echo ""

# Check RPC
if ! solana block-height --url "$RPC_URL" >/dev/null 2>&1; then
  if [[ "$USE_DEVNET" == "true" ]]; then
    fail "Cannot reach devnet at $RPC_URL"
  else
    fail "No RPC at $RPC_URL. Start Surfpool first:"
    echo "  npm run surfpool:start"
  fi
  exit 1
fi
NETWORK_LABEL="localnet"
[[ "$USE_DEVNET" == "true" ]] && NETWORK_LABEL="devnet"
info "RPC online at $RPC_URL ($NETWORK_LABEL)"

# Check CLI built
if [[ ! -f "$ROOT_DIR/cli/dist/bin/sss-token.js" ]]; then
  fail "CLI not built. Run: npm run build:packages"
  exit 1
fi
info "CLI built"

# Check spl-token
if ! command -v spl-token >/dev/null 2>&1; then
  fail "spl-token not found. Install via: cargo install spl-token-cli"
  exit 1
fi
info "spl-token CLI available"

# Check authority keypair
if [[ ! -f "$AUTHORITY_KEYPAIR" ]]; then
  fail "Authority keypair not found: $AUTHORITY_KEYPAIR"
  exit 1
fi
AUTHORITY=$(solana address -k "$AUTHORITY_KEYPAIR")
info "Authority: $AUTHORITY"

# Clean up stale config from previous runs
rm -f "$ROOT_DIR/.sss-token.json"

# =============================================================================
# WALLET SETUP
# =============================================================================
step "Generate Demo Wallets"

# Generate fresh wallets (overwrite if exist)
solana-keygen new -o "$ALICE_KEY" --no-bip39-passphrase --force --silent
solana-keygen new -o "$BOB_KEY" --no-bip39-passphrase --force --silent
solana-keygen new -o "$VICTIM_KEY" --no-bip39-passphrase --force --silent

ALICE=$(solana address -k "$ALICE_KEY")
BOB=$(solana address -k "$BOB_KEY")
VICTIM=$(solana address -k "$VICTIM_KEY")

info "Alice:    $ALICE"
info "Bob:      $BOB"
info "Victim:   $VICTIM"
info "Treasury: $AUTHORITY (authority)"

# Fund wallets
step "Fund Wallets"

if [[ "$USE_DEVNET" == "true" ]]; then
  # Devnet: transfer SOL from authority to demo wallets (airdrops are rate-limited)
  FUND_AMOUNT=0.05
  for name_addr in "Alice:$ALICE" "Bob:$BOB" "Victim:$VICTIM"; do
    name="${name_addr%%:*}"
    addr="${name_addr##*:}"
    cmd "solana transfer $addr $FUND_AMOUNT"
    solana transfer "$addr" "$FUND_AMOUNT" \
      --url "$RPC_URL" --keypair "$AUTHORITY_KEYPAIR" \
      --allow-unfunded-recipient --commitment confirmed 2>&1 || warn "Transfer to $name failed"
    info "$name funded with $FUND_AMOUNT SOL"
  done
  bal=$(solana balance "$AUTHORITY" --url "$RPC_URL" 2>/dev/null || echo "unknown")
  info "Authority balance: $bal"
else
  # Localnet: airdrop freely
  for name_addr in "Authority:$AUTHORITY" "Alice:$ALICE" "Bob:$BOB" "Victim:$VICTIM"; do
    name="${name_addr%%:*}"
    addr="${name_addr##*:}"
    cmd "solana airdrop 5 $addr"
    if ! solana airdrop 5 "$addr" --url "$RPC_URL" --commitment confirmed >/dev/null 2>&1; then
      if ! solana airdrop 2 "$addr" --url "$RPC_URL" --commitment confirmed >/dev/null 2>&1; then
        warn "Airdrop failed for $name ($addr) — may already have SOL"
      fi
    fi
    bal=$(solana balance "$addr" --url "$RPC_URL" 2>/dev/null || echo "unknown")
    info "$name balance: $bal"
  done
fi

pause

# =============================================================================
# STEP 1: Initialize Stablecoin
# =============================================================================
step "Initialize SSS-2 Stablecoin"

run_sss init --preset sss-2 --name "Demo USD" --symbol "DUSD" --decimals 6

# Extract mint address from config
MINT=$(python3 -c "import json; print(json.load(open('$ROOT_DIR/.sss-token.json'))['mintAddress'])" 2>/dev/null \
  || node -e "console.log(JSON.parse(require('fs').readFileSync('$ROOT_DIR/.sss-token.json','utf8')).mintAddress)")

info "Mint: $MINT"

pause

# =============================================================================
# STEP 2: Setup Roles & Minter Quota
# =============================================================================
step "Setup Authority Roles"

info "Adding minter role + quota..."
run_sss roles add minter "$AUTHORITY"
run_sss minters add "$AUTHORITY" --quota 1000000000000

info "Adding burner role..."
run_sss roles add burner "$AUTHORITY"

info "Adding blacklister role..."
run_sss roles add blacklister "$AUTHORITY"

info "Adding seizer role..."
run_sss roles add seizer "$AUTHORITY"

info "All roles assigned to authority."

pause

# =============================================================================
# STEP 3: Create Token Accounts
# =============================================================================
step "Create Token Accounts (ATAs)"

for name_key in "Alice:$ALICE" "Bob:$BOB" "Victim:$VICTIM" "Authority:$AUTHORITY"; do
  name="${name_key%%:*}"
  addr="${name_key##*:}"
  cmd "spl-token create-account $MINT --owner $addr"
  spl-token create-account "$MINT" --owner "$addr" \
    --url "$RPC_URL" --fee-payer "$AUTHORITY_KEYPAIR" \
    --program-id "$T22" 2>&1 || warn "$name ATA may already exist"
  info "$name ATA created"
done

pause

# =============================================================================
# STEP 4: Mint Tokens
# =============================================================================
step "Mint Tokens to Alice and Bob"

echo -e "${BOLD}┌─────────────────────────────────┐${RESET}"
echo -e "${BOLD}│  Minting 10 DUSD to Alice       │${RESET}"
echo -e "${BOLD}│  Minting  5 DUSD to Bob         │${RESET}"
echo -e "${BOLD}└─────────────────────────────────┘${RESET}"

run_sss mint "$ALICE" 10000000
run_sss mint "$BOB" 5000000

pause

# =============================================================================
# STEP 5: Supply Check
# =============================================================================
step "Check Total Supply"

run_sss supply

pause

# =============================================================================
# STEP 6: Happy-Path Transfers (before blacklist)
# =============================================================================
step "Normal Transfers (Happy Path)"

echo -e "${BOLD}▸ Bob sends 1 DUSD to Alice — should succeed:${RESET}"
echo ""
cmd "spl-token transfer $MINT 1 $ALICE --owner ~/demo-bob.json"
spl-token transfer "$MINT" 1 "$ALICE" \
  --owner "$BOB_KEY" \
  --url "$RPC_URL" \
  --fee-payer "$BOB_KEY" \
  --program-id "$T22" \
  --allow-unfunded-recipient 2>&1
info "Transfer succeeded! Bob → Alice: 1 DUSD"

echo ""
echo -e "${BOLD}▸ Alice sends 1 DUSD back to Bob — should succeed:${RESET}"
echo ""
cmd "spl-token transfer $MINT 1 $BOB --owner ~/demo-alice.json"
spl-token transfer "$MINT" 1 "$BOB" \
  --owner "$ALICE_KEY" \
  --url "$RPC_URL" \
  --fee-payer "$ALICE_KEY" \
  --program-id "$T22" \
  --allow-unfunded-recipient 2>&1
info "Transfer succeeded! Alice → Bob: 1 DUSD"

echo ""
echo -e "${GREEN}Transfers work normally — no restrictions yet.${RESET}"

pause

# =============================================================================
# STEP 7: Blacklist Bob
# =============================================================================
step "Blacklist Bob"

echo -e "${BOLD}${RED}▸ Law enforcement identifies Bob's address in fraud investigation${RESET}"
echo ""

run_sss blacklist add "$BOB" --reason "FBI Case #2024-1847 - Fraud proceeds"

pause

# =============================================================================
# STEP 8: Transfer Rejections (Sad Path)
# =============================================================================
step "Blocked Transfers (Sad Path)"

echo -e "${BOLD}▸ Bob tries to send 1 DUSD to Alice:${RESET}"
echo ""
expect_fail "sender blacklisted" \
  spl-token transfer "$MINT" 1 "$ALICE" \
    --owner "$BOB_KEY" \
    --url "$RPC_URL" \
    --fee-payer "$BOB_KEY" \
    --program-id "$T22" \
    --allow-unfunded-recipient

echo ""
echo -e "${BOLD}▸ Alice tries to send 1 DUSD to Bob:${RESET}"
echo ""
expect_fail "recipient blacklisted" \
  spl-token transfer "$MINT" 1 "$BOB" \
    --owner "$ALICE_KEY" \
    --url "$RPC_URL" \
    --fee-payer "$ALICE_KEY" \
    --program-id "$T22" \
    --allow-unfunded-recipient

echo ""
echo -e "${GREEN}Both directions blocked by the transfer hook.${RESET}"

pause

# =============================================================================
# STEP 9: Seize Tokens
# =============================================================================
step "Seize Bob's Tokens"

echo -e "${BOLD}▸ Permanent delegate pulls all tokens from Bob → Treasury${RESET}"
echo ""

run_sss seize "$BOB" --to "$AUTHORITY" --amount 5000000

pause

# =============================================================================
# STEP 10: Burn & Reissue (Victim Restitution)
# =============================================================================
step "Burn Seized Tokens & Reissue to Victim"

echo -e "${BOLD}▸ Burn 5 DUSD (seized tokens)${RESET}"
run_sss burn 5000000

echo ""
echo -e "${BOLD}▸ Mint 5 DUSD to victim${RESET}"
run_sss mint "$VICTIM" 5000000

info "Victim restitution complete."

pause

# =============================================================================
# STEP 11: Supply Conservation
# =============================================================================
step "Verify Supply Conservation"

run_sss supply

echo ""
echo -e "${GREEN}Supply should still be 15,000,000 (15.00 DUSD)${RESET}"

pause

# =============================================================================
# STEP 12: Audit Trail
# =============================================================================
step "Query Audit Trail"

run_sss audit-log --action all --limit 10

pause

# =============================================================================
# DONE
# =============================================================================
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║     Demo Complete!                       ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════╝${RESET}"
echo ""
echo -e "Key addresses for manual recording:"
echo -e "  Mint:      ${CYAN}$MINT${RESET}"
echo -e "  Alice:     ${CYAN}$ALICE${RESET}"
echo -e "  Bob:       ${CYAN}$BOB${RESET}"
echo -e "  Victim:    ${CYAN}$VICTIM${RESET}"
echo -e "  Authority: ${CYAN}$AUTHORITY${RESET}"
echo ""
echo -e "Config saved to: ${DIM}$ROOT_DIR/.sss-token.json${RESET}"
echo ""
