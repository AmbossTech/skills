# Amboss Skills

Home of agent [skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) for [Amboss](https://amboss.tech/). Each top-level folder is an independently installable skill. Pick the ones you need :)

## Skills

### 1. 🌋 Magma: buy Lightning liquidity

Purchase inbound Lightning Network liquidity via [Amboss Magma](https://magma.amboss.tech/). Opens a channel to your node and returns a Lightning invoice to pay.

See [`magma/`](./magma/README.md) for details.

---

## Installation

Install everything in this repo with a single command. The agent will automatically discover skills inside:

```bash
npx skills add AmbossTech/amboss-skill
```

---

## Skill vs. MCP

Some Amboss products also ship as MCP servers. Both call the same Amboss APIs. Pick whichever fits the surface you're using:

- **Skills** — work anywhere skills are supported (Claude Code, Claude API, Claude.ai even other LLMs like Codex). Install with `npx skills add …`
- **MCP servers** — work in MCP-capable clients like Claude Desktop or through some extensions in code editors like VSCode. Install via npm and wire up a JSON config.
