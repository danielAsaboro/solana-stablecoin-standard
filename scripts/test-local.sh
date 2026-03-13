#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v surfpool >/dev/null 2>&1; then
  echo "surfpool is not installed or not on PATH" >&2
  exit 1
fi

pkill -x surfpool >/dev/null 2>&1 || true

WALLET_PATH="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
SURFPOOL_PORT="${SURFPOOL_PORT:-8899}"
SURFPOOL_WS_PORT="${SURFPOOL_WS_PORT:-8900}"
RPC_URL="${ANCHOR_PROVIDER_URL:-http://127.0.0.1:${SURFPOOL_PORT}}"
SURFPOOL_LOG="${SURFPOOL_LOG:-/tmp/sss-surfpool.log}"
WALLET_ADDRESS="$(solana address -k "$WALLET_PATH")"

cleanup() {
  if [[ -n "${SURFPOOL_PID:-}" ]]; then
    pkill -P "$SURFPOOL_PID" >/dev/null 2>&1 || true
    kill "$SURFPOOL_PID" >/dev/null 2>&1 || true
    wait "$SURFPOOL_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "Building Anchor programs..."
anchor build

echo "Building packages..."
npm run build:packages

echo "Starting Surfpool..."
surfpool start \
  --network mainnet \
  --legacy-anchor-compatibility \
  --yes \
  --no-tui \
  --no-studio \
  --port "$SURFPOOL_PORT" \
  --ws-port "$SURFPOOL_WS_PORT" \
  --airdrop "$WALLET_ADDRESS" \
  --airdrop-amount 10000000000000 \
  --airdrop-keypair-path "$WALLET_PATH" \
  >"$SURFPOOL_LOG" 2>&1 &
SURFPOOL_PID=$!

echo "Waiting for Surfpool RPC at $RPC_URL..."
for _ in $(seq 1 60); do
  if solana block-height --url "$RPC_URL" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! solana block-height --url "$RPC_URL" >/dev/null 2>&1; then
  echo "Surfpool failed to start. Log: $SURFPOOL_LOG" >&2
  exit 1
fi

export ANCHOR_PROVIDER_URL="$RPC_URL"
export ANCHOR_WALLET="$WALLET_PATH"
export SSS_LIVE_TESTS=1
export CLI_LIVE_TESTS=1

echo "Running Anchor integration tests..."
npm run test:anchor

echo "Running SDK tests..."
npm run test:sdk

echo "Running CLI tests..."
npm run test:cli

echo "Running backend tests..."
npm run test:backend

echo "Running fuzz tests..."
npm run test:fuzz

echo "Building frontend..."
npm run test:frontend

echo "Building TUI..."
npm run test:tui
