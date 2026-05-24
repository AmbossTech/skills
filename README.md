# Amboss Skills

Home of agent [skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview) for [Amboss](https://amboss.tech/). Each top-level folder is an independently installable skill.

Install every skill with a single command and follow the prompts:

```bash
npx skills add AmbossTech/skills
```

# Skills

## 1. 🌋 Magma Buy Lightning Liquidity

![Demo of Magma skill in action](./magma/magma-demo.gif)

Purchase inbound Lightning Network liquidity via [Amboss Magma](https://magma.amboss.tech/). Opens a channel to your node and returns a Lightning invoice to pay.

See [`magma/`](./magma/README.md) for details.

#### Example Agent Prompts

```bash
- "Buy $10 of Lightning liquidity for my node `026165850492521f4ac8abd9bd8088123446d126f648ca35e60f88177dc149ceb2@12.34.56.78:9735`"
- "Open a private inbound channel on Magma for 5000 cents to `026165850492521f4ac8abd9bd8088123446d126f648ca35e60f88177dc149ceb2`"
```

Agent will present the Lightning invoice for you to pay.

## 2. ⚡ ThunderHub Node Manager

Install and configure [ThunderHub](https://thunderhub.io/) — a web-based Lightning Network node manager for LND and litd nodes. Supports self-hosted and Voltage Cloud nodes, including Taproot Assets management.

See [`thunderhub/`](./thunderhub/README.md) for details.

#### Example Agent Prompts

- "Set up ThunderHub for my LND node"
- "I need a web UI for my Lightning node with Taproot Assets support"
- "Install ThunderHub for my Voltage Cloud node"

Agent will walk through the setup conversation and run ThunderHub for you.

