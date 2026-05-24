# Magma Skill

An agent skill for buying inbound Lightning Network liquidity via [Amboss Magma](https://magma.amboss.tech/).

## Installation

This skill ships inside the [`AmbossTech/skills`](https://github.com/AmbossTech/skills) repo.

```bash
npx skills add AmbossTech/skills
```

The skill activates automatically when Claude detects the user wants to buy Lightning liquidity. To verify, in Claude Code run `/skills` — `magma` should appear.

![Example](./magma-demo.gif)

## Example Agent Prompts

```bash
- "Buy $10 of Lightning liquidity for my node `026165850492521f4ac8abd9bd8088123446d126f648ca35e60f88177dc149ceb2@12.34.56.78:9735`"
- "Open a private inbound channel on Magma for 5000 cents to `026165850492521f4ac8abd9bd8088123446d126f648ca35e60f88177dc149ceb2`"
```

Claude will:
1. Confirm the amount and node URI back to you.
2. Run the skill's script.
3. Present the Lightning invoice for you to pay.

<hr>

## Configuration (Optional)

Authentication is optional — Magma supports anonymous access (the API auto-creates a temporary session account).

To use an existing Amboss account, set the API key in your environment before launching Claude:

```bash
export MAGMA_API_KEY=your_api_key_here
```

API keys can be generated at https://account.amboss.tech/settings/api-keys.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MAGMA_API_KEY` | No | — | Amboss Magma API key. Falls back to anonymous access if unset. |
| `MAGMA_GRAPHQL_ENDPOINT` | No | `https://magma.amboss.tech/graphql` | Override the Magma GraphQL endpoint. |

## Related

- [Amboss Magma](https://magma.amboss.tech/) — your liquidity marketplace :)
- [Magma API docs](https://docs.amboss.tech/tutorials/how_to_buy_liquidity_using_magma)
- [Magma MCP server](https://github.com/AmbossTech/magma-mcp)
- [Claude skills docs](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)
- [Amboss Technologies](https://amboss.tech/)