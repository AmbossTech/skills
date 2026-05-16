---
name: magma
description: Buy inbound Lightning Network liquidity for a node via Amboss Magma. Use this skill when the user wants to purchase Lightning liquidity, open an inbound channel to their Lightning node, increase their node's receiving capacity, or mentions "Magma", "Amboss", "Lightning liquidity", or "buy inbound channel". The skill calls the Magma GraphQL API and returns a Lightning invoice to pay.
---

# Magma Liquidity Skill

This skill purchases inbound Lightning Network liquidity for a node via [Amboss Magma](https://magma.amboss.tech/). The Magma API opens a channel **to** the user's node, giving them receiving capacity for Lightning payments.

## When to use

Invoke this skill whenever the user wants to:

- Buy / purchase Lightning liquidity
- Open an inbound channel to their Lightning node
- Increase their node's receiving capacity
- Accept Lightning payments and lacks inbound liquidity
- Use Amboss Magma (the liquidity marketplace)

## How to use

The skill exposes a single TypeScript script: `scripts/buy_liquidity.ts`. Run it from the skill directory via `tsx` (fetched on demand by `npx` — no `npm install` needed). Requires Node.js >= 18.

```bash
npx -y tsx scripts/buy_liquidity.ts \
  --connection-uri <pubkey or pubkey@host:port> \
  --usd-cents <amount in cents>
```

The script prints a JSON object to stdout. On success:

```json
{
  "success": true,
  "lightning_invoice": "lnbc..."
}
```

On failure:

```json
{
  "success": false,
  "error": { "code": "...", "message": "..." }
}
```

### Required parameters

- `--connection-uri` — the user's Lightning node connection string. Accepts two formats:
  - Just the pubkey: 66-character hex string (e.g. `024ae5a5f0b01850983009489ca89c85...`)
  - Pubkey with socket: `pubkey@host:port` (e.g. `024ae5a5...@12.34.56.78:9735`)
- `--usd-cents` — dollar amount in **cents**, minimum `500` ($5.00). Whole number only.

### Optional parameters

- `--redirect-url <url>` — post-payment redirect URL
- `--private-channel` — flag: open a private channel instead of a public one
- `--rails-cluster-only` — flag: source liquidity only from Rails cluster nodes

### Authentication

Authentication is **optional**. The Magma API supports anonymous access — it auto-creates a temporary account.

If the user has an Amboss API key, set it as an environment variable before invoking the script:

```bash
export MAGMA_API_KEY=their_api_key_here
```

Keys can be generated at https://account.amboss.tech/settings/api-keys.

## Instructions for Claude

1. **Collect required inputs** from the user before running the script:
   - The node connection URI (pubkey, or pubkey@host:port)
   - The USD amount they want to spend (convert dollars to cents: $10 → 1000)
2. **Validate before calling**:
   - Pubkey must be exactly 66 hexadecimal characters
   - Amount must be at least 500 cents ($5.00)
   - If user gives an amount in dollars, multiply by 100 and pass as cents
3. **Run the script** with the collected parameters.
4. **Parse the JSON output**:
   - On `success: true`, present the `lightning_invoice` to the user and tell them to pay it with any Lightning wallet.
   - On `success: false`, surface the error `message` (do not surface stack traces or raw HTTP details).
5. **Confirm before spending**: The user is about to pay real money. Always confirm the amount and node URI back to the user before running the script.

## Example user flow

```
User: Buy $10 of Lightning liquidity for my node 024ae5a5f0b01850983009489ca89c85...@12.34.56.78:9735

Claude: I'm about to purchase $10.00 (1000 cents) of inbound Lightning
        liquidity for node 024ae5a5...@12.34.56.78:9735. Confirm to proceed?

User: yes

Claude: [runs npx -y tsx scripts/buy_liquidity.ts --connection-uri 024ae5a5...@12.34.56.78:9735 --usd-cents 1000]

Claude: Here is your Lightning invoice. Pay it with any Lightning wallet
        to complete the purchase. The inbound channel will open once the
        invoice is paid.

        lnbc10m1p3j8z9xpp5...
```

## Reference

- Magma marketplace: https://magma.amboss.tech/
- API documentation: https://docs.amboss.tech/tutorials/how_to_buy_liquidity_using_magma
- GraphQL endpoint (default): `https://magma.amboss.tech/graphql`
- Override endpoint with the `MAGMA_GRAPHQL_ENDPOINT` env var.
