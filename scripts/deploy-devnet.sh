#!/usr/bin/env bash
# =============================================================================
# Solana Stablecoin Standard — Devnet Deployment Script
# =============================================================================
#
# Automates the full deployment of all three SSS programs to Solana devnet,
# then runs example transactions demonstrating both SSS-1 and SSS-2 presets.
#
# Usage:
#   ./scripts/deploy-devnet.sh
#
# Prerequisites:
#   - Solana CLI installed (solana --version)
#   - Anchor CLI installed (anchor --version)
#   - Node.js + Yarn installed
#   - Programs built: `anchor build`
#   - SDK built: `yarn build`
#   - Devnet SOL: the wallet at ~/.config/solana/id.json needs ~7 SOL
#
# What this script does:
#   1. Switches Solana CLI config to devnet
#   2. Checks wallet balance (needs ~7 SOL for 3 program deploys)
#   3. Deploys all 3 programs (SSS, Transfer Hook, Oracle)
#   4. Runs the SSS-1 demo (init, roles, mint, burn, freeze, thaw, pause, unpause)
#   5. Runs the SSS-2 demo (init, hook, roles, mint, blacklist, seize, unblacklist)
#   6. Outputs all program IDs, transaction signatures, and Solana Explorer links
#   7. Saves results to docs/DEVNET_DEPLOYMENT.md
#   8. Restores Solana CLI config to original settings
#
# =============================================================================

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log_info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Save original Solana config
ORIGINAL_URL=$(solana config get | grep "RPC URL" | awk '{print $NF}')
ORIGINAL_KEYPAIR=$(solana config get | grep "Keypair Path" | awk '{print $NF}')

cleanup() {
    log_info "Restoring original Solana CLI config..."
    solana config set --url "$ORIGINAL_URL" --keypair "$ORIGINAL_KEYPAIR" > /dev/null 2>&1
    log_ok "Config restored: $ORIGINAL_URL"
}
trap cleanup EXIT

echo ""
echo "============================================================"
echo "  Solana Stablecoin Standard — Devnet Deployment"
echo "============================================================"
echo ""

# Step 0: Preflight checks
log_info "Running preflight checks..."

if ! command -v solana &> /dev/null; then
    log_error "solana CLI not found. Install: https://docs.solanalabs.com/cli/install"
    exit 1
fi

if ! command -v anchor &> /dev/null; then
    log_error "anchor CLI not found. Install: https://www.anchor-lang.com/docs/installation"
    exit 1
fi

if ! command -v npx &> /dev/null; then
    log_error "npx not found. Install Node.js: https://nodejs.org/"
    exit 1
fi

# Check programs are built
for prog in sss transfer_hook sss_oracle; do
    if [[ ! -f "target/deploy/${prog}.so" ]]; then
        log_error "Program binary not found: target/deploy/${prog}.so"
        log_error "Run 'anchor build' first."
        exit 1
    fi
done
log_ok "All program binaries found"

# Check SDK is built
if [[ ! -d "sdk/core/dist" ]]; then
    log_warn "SDK not built. Running 'yarn build'..."
    yarn build
fi
log_ok "SDK is built"

# Step 1: Switch to devnet
log_info "Switching to Solana devnet..."
solana config set --url https://api.devnet.solana.com > /dev/null 2>&1

WALLET_ADDRESS=$(solana address)
BALANCE=$(solana balance | awk '{print $1}')
log_info "Wallet:  $WALLET_ADDRESS"
log_info "Balance: $BALANCE SOL"

BALANCE_LAMPORTS=$(echo "$BALANCE * 1000000000" | bc | cut -d. -f1)
REQUIRED_LAMPORTS=5000000000 # 5 SOL minimum

if (( BALANCE_LAMPORTS < REQUIRED_LAMPORTS )); then
    log_warn "Insufficient balance. Attempting airdrop..."
    for i in 1 2 3; do
        solana airdrop 2 2>/dev/null && break || {
            log_warn "Airdrop attempt $i failed. Retrying in 5s..."
            sleep 5
        }
    done
    BALANCE=$(solana balance | awk '{print $1}')
    log_info "New balance: $BALANCE SOL"
fi

# Step 2: Update Anchor.toml to devnet
log_info "Configuring Anchor for devnet deployment..."

# Read program keypair addresses
SSS_PROGRAM_ID=$(solana address -k target/deploy/sss-keypair.json)
HOOK_PROGRAM_ID=$(solana address -k target/deploy/transfer_hook-keypair.json)
ORACLE_PROGRAM_ID=$(solana address -k target/deploy/sss_oracle-keypair.json)

log_info "Program IDs:"
log_info "  SSS:           $SSS_PROGRAM_ID"
log_info "  Transfer Hook: $HOOK_PROGRAM_ID"
log_info "  Oracle:        $ORACLE_PROGRAM_ID"

# Update Anchor.toml for devnet
sed -i.bak 's/cluster = "localnet"/cluster = "devnet"/' Anchor.toml

# Update devnet program IDs to match actual keypairs
python3 -c "
import re
with open('Anchor.toml', 'r') as f:
    content = f.read()
# Update devnet section
content = re.sub(
    r'\[programs\.devnet\].*?(?=\[)',
    '[programs.devnet]\nsss = \"$SSS_PROGRAM_ID\"\ntransfer_hook = \"$HOOK_PROGRAM_ID\"\nsss_oracle = \"$ORACLE_PROGRAM_ID\"\n\n',
    content, flags=re.DOTALL
)
with open('Anchor.toml', 'w') as f:
    f.write(content)
" 2>/dev/null || true

# Step 3: Deploy programs
echo ""
log_info "Deploying programs to devnet..."
echo ""

for prog in sss transfer_hook sss_oracle; do
    log_info "Deploying $prog..."
    if anchor deploy --program-name "$prog" --provider.cluster devnet 2>&1; then
        log_ok "$prog deployed successfully"
    else
        log_error "Failed to deploy $prog"
        # Restore Anchor.toml
        mv Anchor.toml.bak Anchor.toml 2>/dev/null || true
        exit 1
    fi
    echo ""
done

# Restore Anchor.toml
mv Anchor.toml.bak Anchor.toml 2>/dev/null || true

# Step 4: Run demo transactions
log_info "Running SSS-1 demo transactions..."
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=$HOME/.config/solana/id.json \
npx ts-node scripts/deploy-devnet.ts 2>&1 | tee /tmp/sss1-demo-output.txt

echo ""
log_info "Running SSS-2 demo transactions..."
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=$HOME/.config/solana/id.json \
npx ts-node scripts/deploy-sss2-devnet.ts 2>&1 | tee /tmp/sss2-demo-output.txt

echo ""
echo "============================================================"
echo "  Deployment Complete!"
echo "============================================================"
echo ""
echo "Program IDs (Devnet):"
echo "  SSS:           $SSS_PROGRAM_ID"
echo "  Transfer Hook: $HOOK_PROGRAM_ID"
echo "  Oracle:        $ORACLE_PROGRAM_ID"
echo ""
echo "Wallet: $WALLET_ADDRESS"
echo ""
echo "Explorer:"
echo "  SSS:  https://explorer.solana.com/address/${SSS_PROGRAM_ID}?cluster=devnet"
echo "  Hook: https://explorer.solana.com/address/${HOOK_PROGRAM_ID}?cluster=devnet"
echo "  Oracle: https://explorer.solana.com/address/${ORACLE_PROGRAM_ID}?cluster=devnet"
echo ""
log_ok "All done! Check docs/DEVNET_DEPLOYMENT.md for full deployment proof."
