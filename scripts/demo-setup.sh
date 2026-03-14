#!/usr/bin/env bash
# =============================================================================
# Demo Setup — run this BEFORE recording. It creates wallets, funds them,
# initializes the stablecoin, assigns roles, creates ATAs, and then writes
# out demo-commands.txt with exact copy-paste commands for the recording.
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

USE_DEVNET=false
[[ "${1:-}" == "--devnet" ]] && USE_DEVNET=true

if [[ "$USE_DEVNET" == "true" ]]; then
  RPC_URL="https://api.devnet.solana.com"
else
  RPC_URL="http://127.0.0.1:8899"
fi

CLI="node $ROOT_DIR/cli/dist/bin/sss-token.js"
KEYPAIR="$HOME/.config/solana/id.json"
T22="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

echo "=== Demo Setup ==="
echo "Network: $(if $USE_DEVNET; then echo devnet; else echo localnet; fi)"
echo ""

# 1. Generate wallets
echo "Creating wallets..."
solana-keygen new -o "$HOME/demo-alice.json" --no-bip39-passphrase --force --silent
solana-keygen new -o "$HOME/demo-bob.json" --no-bip39-passphrase --force --silent
solana-keygen new -o "$HOME/demo-victim.json" --no-bip39-passphrase --force --silent

ALICE=$(solana address -k "$HOME/demo-alice.json")
BOB=$(solana address -k "$HOME/demo-bob.json")
VICTIM=$(solana address -k "$HOME/demo-victim.json")
AUTHORITY=$(solana address -k "$KEYPAIR")

echo "  Alice:     $ALICE"
echo "  Bob:       $BOB"
echo "  Victim:    $VICTIM"
echo "  Authority: $AUTHORITY"

# 2. Fund wallets
echo ""
echo "Funding wallets..."
if [[ "$USE_DEVNET" == "true" ]]; then
  for addr in "$ALICE" "$BOB" "$VICTIM"; do
    solana transfer "$addr" 0.05 --url "$RPC_URL" --keypair "$KEYPAIR" \
      --allow-unfunded-recipient --commitment confirmed 2>&1 | tail -1
  done
else
  for addr in "$AUTHORITY" "$ALICE" "$BOB" "$VICTIM"; do
    solana airdrop 5 "$addr" --url "$RPC_URL" --commitment confirmed >/dev/null 2>&1 || true
  done
fi
echo "  Done."

# 3. Initialize stablecoin
echo ""
echo "Initializing SSS-2 stablecoin..."
rm -f "$ROOT_DIR/.sss-token.json"
$CLI -u "$RPC_URL" -k "$KEYPAIR" -y init --preset sss-2 --name "Demo USD" --symbol "DUSD" --decimals 6 2>&1 | grep -E "Mint|Config PDA|initialized"

MINT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ROOT_DIR/.sss-token.json','utf8')).mintAddress)")
echo "  Mint: $MINT"

# 4. Assign roles
echo ""
echo "Assigning roles..."
for role in minter burner blacklister seizer; do
  $CLI -u "$RPC_URL" -k "$KEYPAIR" -y roles add "$role" "$AUTHORITY" 2>&1 | grep -E "assigned|✔" || true
done
$CLI -u "$RPC_URL" -k "$KEYPAIR" -y minters add "$AUTHORITY" --quota 1000000000000 2>&1 | grep -E "added|✔" || true
echo "  Done."

# 5. Create ATAs
echo ""
echo "Creating token accounts..."
for addr in "$ALICE" "$BOB" "$VICTIM" "$AUTHORITY"; do
  spl-token create-account "$MINT" --owner "$addr" \
    --url "$RPC_URL" --fee-payer "$KEYPAIR" --program-id "$T22" 2>&1 | grep -E "Creating|Signature" || true
done
echo "  Done."

# 6. Write demo-commands.txt
OUT="$ROOT_DIR/demo-commands.txt"
cat > "$OUT" << CMDS
# =============================================================================
# SSS DEMO — COPY-PASTE COMMANDS
# =============================================================================
# Network: $(if $USE_DEVNET; then echo devnet; else echo localnet; fi)
# Mint:      $MINT
# Alice:     $ALICE
# Bob:       $BOB
# Victim:    $VICTIM
# Authority: $AUTHORITY
# =============================================================================

# --- STEP 1: Initialize (already done — just show the command on screen) ---
# npx sss-token init --preset sss-2 --name "Demo USD" --symbol "DUSD" --decimals 6

# --- STEP 2: Mint tokens ---
npx sss-token mint $ALICE 10000000 -u $RPC_URL

npx sss-token mint $BOB 5000000 -u $RPC_URL

# --- STEP 3: Check supply ---
npx sss-token supply -u $RPC_URL

# --- STEP 4: Happy path — transfers work normally ---
spl-token transfer $MINT 1 $ALICE --owner ~/demo-bob.json --url $RPC_URL --fee-payer ~/demo-bob.json --program-id $T22

spl-token transfer $MINT 1 $BOB --owner ~/demo-alice.json --url $RPC_URL --fee-payer ~/demo-alice.json --program-id $T22

# --- STEP 5: Blacklist Bob ---
npx sss-token blacklist add $BOB --reason "FBI Case #2024-1847 - Fraud proceeds" -u $RPC_URL

# --- STEP 6: Sad path — transfers now blocked ---
spl-token transfer $MINT 1 $ALICE --owner ~/demo-bob.json --url $RPC_URL --fee-payer ~/demo-bob.json --program-id $T22

spl-token transfer $MINT 1 $BOB --owner ~/demo-alice.json --url $RPC_URL --fee-payer ~/demo-alice.json --program-id $T22

# --- STEP 7: Seize ---
npx sss-token seize $BOB --to $AUTHORITY --amount 5000000 -u $RPC_URL

# --- STEP 8: Burn seized tokens ---
npx sss-token burn 5000000 -u $RPC_URL

# --- STEP 9: Remint to victim ---
npx sss-token mint $VICTIM 5000000 -u $RPC_URL

# --- STEP 10: Verify supply conservation ---
npx sss-token supply -u $RPC_URL

# --- STEP 11: Audit trail ---
npx sss-token audit-log --action all --limit 10 -u $RPC_URL
CMDS

echo ""
echo "============================================"
echo "  Setup complete!"
echo "  Commands written to: demo-commands.txt"
echo "============================================"
echo ""
echo "Open demo-commands.txt and copy-paste each"
echo "command during your screen recording."
