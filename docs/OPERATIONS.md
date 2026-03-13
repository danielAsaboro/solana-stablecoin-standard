# Operations Runbook

This runbook documents the supported operator flows for the `sss-token` CLI.

## Prerequisites

- Solana CLI installed and configured
- Anchor CLI installed
- Node.js 18+ with `npm`
- Local packages built with `npm run build`
- A funded keypair for the target cluster

## CLI Conventions

Global options available on all commands:

```bash
sss-token --help
```

- `--keypair <path>`: signer keypair path
- `--rpc <url>`: RPC endpoint
- `--config <path>`: alternate `.sss-token.json` path
- `--profile <name>`: named config profile within the selected config file
- `--output table|json|csv`: machine-readable output for scripts and audits
- `--dry-run`: preview supported write actions without submitting a transaction

The CLI writes `.sss-token.json` after `init`, so later commands can reuse the same stablecoin config without passing the mint/config manually every time.

Inspect or seed the local config directly:

```bash
sss-token config path
sss-token config show
sss-token config profiles
sss-token --output json config show
sss-token --config ./issuer.json config set \
  --mint <MINT_PUBKEY> \
  --config-address <CONFIG_PDA> \
  --preset SSS-2 \
  --rpc-url https://api.devnet.solana.com
sss-token --config ./issuer.json config set \
  --profile devnet \
  --mint <MINT_PUBKEY> \
  --config-address <CONFIG_PDA> \
  --preset SSS-2 \
  --rpc-url https://api.devnet.solana.com
sss-token --config ./issuer.json config use devnet
```

## Local Verification First

Canonical local verification:

```bash
npm run build
npm test
```

The local flow starts Surfpool, runs the Anchor suites, SDK tests, CLI tests, backend tests, fuzz tests, frontend build, and TUI build.

## Initialize A Stablecoin

### SSS-1

```bash
sss-token init \
  --preset sss-1 \
  --name "My Stablecoin" \
  --symbol "MUSD" \
  --uri "https://example.com/metadata.json" \
  --decimals 6
```

### SSS-2

```bash
sss-token init \
  --preset sss-2 \
  --name "Compliant USD" \
  --symbol "cUSD" \
  --uri "https://example.com/metadata.json" \
  --decimals 6
```

### Custom JSON Or TOML Config

```bash
sss-token init --custom ./stablecoin.toml
sss-token init --custom ./stablecoin.json
```

Example dry run:

```bash
sss-token --dry-run init --custom ./stablecoin.toml
```

## Role Management

Assign and revoke roles:

```bash
sss-token roles add minter <PUBKEY>
sss-token roles add burner <PUBKEY>
sss-token roles add pauser <PUBKEY>
sss-token roles add blacklister <PUBKEY>
sss-token roles add seizer <PUBKEY>

sss-token roles remove minter <PUBKEY>
```

Inspect one wallet’s roles:

```bash
sss-token roles list <PUBKEY>
sss-token --output json roles list <PUBKEY>
sss-token --output csv roles list <PUBKEY>
```

Preview a role update without submitting:

```bash
sss-token --dry-run roles add minter <PUBKEY>
```

## Minter Quotas

Add or update a minter quota:

```bash
sss-token minters add <PUBKEY> --quota 1000000000
sss-token minters add <PUBKEY> --quota 5000000000
```

Remove a minter role:

```bash
sss-token minters remove <PUBKEY>
```

Inspect quotas:

```bash
sss-token minters list
sss-token minters list <PUBKEY>
sss-token --output json minters list
sss-token --output csv minters list
```

Preview quota changes:

```bash
sss-token --dry-run minters add <PUBKEY> --quota 5000000000
```

## Mint And Burn

Mint tokens:

```bash
sss-token mint <RECIPIENT_PUBKEY> <AMOUNT>
```

Burn tokens:

```bash
sss-token burn <AMOUNT>
```

## Freeze, Thaw, Pause

```bash
sss-token freeze <TOKEN_ACCOUNT_OR_OWNER>
sss-token thaw <TOKEN_ACCOUNT_OR_OWNER>

sss-token pause
sss-token unpause
```

## Status, Supply, Holders

High-level status:

```bash
sss-token status
sss-token --output json status
sss-token --output csv status
```

Supply-only view:

```bash
sss-token supply
sss-token --output json supply
sss-token --output csv supply
```

Holder inspection:

```bash
sss-token holders
sss-token holders --min-balance 1000
sss-token holders --sort address
```

## SSS-2 Compliance Operations

Blacklist an address:

```bash
sss-token blacklist add <PUBKEY> --reason "Sanctions compliance"
```

Remove an address:

```bash
sss-token blacklist remove <PUBKEY>
```

Inspect blacklist state:

```bash
sss-token blacklist list
sss-token blacklist list <PUBKEY>
sss-token --output json blacklist list
sss-token --output csv blacklist list
```

Preview blacklist actions:

```bash
sss-token --dry-run blacklist add <PUBKEY> --reason "Manual review"
sss-token --dry-run blacklist remove <PUBKEY>
```

Seize tokens:

```bash
sss-token seize <OWNER_OR_TOKEN_ACCOUNT> --to <TREASURY_PUBKEY> --amount <AMOUNT>
```

## Audit Trail

Query recent on-chain events:

```bash
sss-token audit-log
sss-token audit-log --action mint
sss-token audit-log --limit 50
sss-token audit-log --format jsonl
sss-token --output jsonl audit-log --action compliance
```

`jsonl` emits one complete event object per line with stable operator fields such as `timestamp`, `eventType`, `action`, `status`, `severity`, `authority`, `targetAddress`, and `signature`.

For a backend-backed compliance export, request newline-delimited JSON from the API:

```bash
curl 'http://localhost:3001/api/v1/audit?format=jsonl'
```

## Frontend Operator Telemetry

The frontend console now supports an overview-first operator mode that can stay RPC-only or become backend-aware.

Set `NEXT_PUBLIC_SSS_BACKEND_URL` before starting the frontend to surface:

- indexed event activity instead of direct RPC-only recent history,
- webhook registration and delivery health,
- HMAC signing status, header name, and verification expectations.

Without that variable, the frontend still works and falls back to direct on-chain/RPC activity.

When the backend URL is configured, the dashboard timeline merges:

- tracked mint and burn operations,
- indexed on-chain events,
- compliance audit operations,
- webhook delivery attempts.

Use the timeline filters to narrow by source, severity, status, action, authority, target address, or transaction signature when reviewing incidents.

Operator export and evidence paths:

- `curl 'http://localhost:3001/api/v1/operator-timeline?format=jsonl'`
- `curl 'http://localhost:3001/api/v1/operator-timeline?format=csv'`
- `curl 'http://localhost:3001/api/v1/operator-timeline/<incident-id>'`
- `curl 'http://localhost:3001/api/v1/operator-evidence'`
- `curl -X POST 'http://localhost:3001/api/v1/operator-snapshots' -H 'content-type: application/json' -d '{"label":"before-change"}'`
- `curl 'http://localhost:3001/api/v1/operator-snapshots'`
- `curl 'http://localhost:3001/api/v1/operator-snapshots/diff?from=<snapshot-id>&to=<snapshot-id>'`

Evidence bundle truthfulness:

- snapshot summary fields such as `paused`, `live_supply`, `role_count`, `minter_count`, and `blacklist_count` may be `null` when the backend does not have a direct exact source for them;
- the bundle does not infer exact current state from partial incident history.

Webhook replay and HMAC verification:

- `curl -X POST 'http://localhost:3001/api/v1/webhooks/deliveries/<delivery-id>/redeliver'`
- `curl -X POST 'http://localhost:3001/api/v1/operator-timeline/<incident-id>/redeliver'`
- `sss-token webhook verify --secret "$WEBHOOK_SECRET" --signature "$X_SSS_SIGNATURE" --payload-file ./captured-body.json`

## Failure Handling

Common failure cases:

| Error | Meaning | Expected action |
|-------|---------|-----------------|
| `Unauthorized` | signer lacks required authority or role | grant the correct role or use the correct signer |
| `QuotaExceeded` | mint request exceeds the configured minter quota | raise quota or reduce mint size |
| `Paused` | stablecoin is paused | unpause before retrying |
| `ComplianceNotEnabled` | SSS-2-only action attempted on SSS-1 | reinitialize with SSS-2 if compliance is required |
| `NotBlacklisted` | address removal requested for a non-listed address | inspect current blacklist state first |
| `AccountFrozen` | account cannot send or receive because it is frozen | thaw the account before retrying |

## Recommended Operator Patterns

- Use `--dry-run` before any role, quota, or blacklist change.
- Use `--output json` or `--output jsonl` in scripts and CI checks.
- Use `status` before and after any administrative action to capture an audit snapshot.
- Use `blacklist list` and `audit-log` together for compliance reviews.
- When webhooks are enabled, verify whether signing is active and validate the `X-SSS-Signature` header against the raw request body.
- If the backend indexer is running, webhook payloads and delivery records include `transaction_signature`, `event_id`, and `correlation_id`, so `/api/v1/operator-timeline` can fold delivery success or failure directly into the originating incident.
- Use operator snapshots before and after high-risk actions to capture a read-only evidence trail.
- Configure `sss-admin-tui --backend-url <url>` or `SSS_BACKEND_URL=<url>` to expose the correlated incident stream in the terminal UI.
- Use the TUI incidents tab for keyboard-first review of the same correlated operator timeline surfaced in the frontend.
- Keep separate keypairs for master authority, minting, pausing, blacklisting, and seizure operations.
