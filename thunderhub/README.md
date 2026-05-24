# ThunderHub Skill

An agent skill for installing and configuring [ThunderHub](https://thunderhub.io/), an open-source Lightning Network node manager for LND and litd nodes.

## Installation

This skill ships inside the [`AmbossTech/skills`](https://github.com/AmbossTech/skills) repo.

```bash
npx skills add AmbossTech/skills
```

The skill activates automatically when Claude detects the user wants to set up ThunderHub. To verify, in Claude Code run `/skills` — `thunderhub` should appear.

## What it does

The skill guides you through a conversational setup:

1. **Goal** — Normal Lightning management (LND) or Trading / Taproot Assets (litd)
2. **Hosting** — Self-hosted or Voltage Cloud
3. **Method** — Docker (recommended) or Source install
4. **Credentials** — Collects macaroon path (admin for LND, superadmin for litd), TLS cert path (if needed), and server URL
5. **Installation** — Generates `thubConfig.yaml` and installs/runs ThunderHub
6. **Access** — Provides the URL where ThunderHub is available

## Example Agent Prompts

```bash
- "Set up ThunderHub for my LND node on this machine"
- "I need ThunderHub for my Voltage Cloud litd node with Taproot Assets"
- "Install ThunderHub from source on my server"
```

The agent will ask about your goal, hosting, preferred method, and credentials, then install and run ThunderHub for you.

## Installation Methods

### Docker (Recommended)

ThunderHub runs in a Docker container with automatic restart. The script mounts your macaroon, TLS cert, and config into the container.

### Source

The script clones the ThunderHub repo, installs dependencies, builds the app, and gives you the command to start it.

## Access

After installation, ThunderHub is available at:

- **Local**: http://localhost:3000
- **Custom port**: http://localhost:{PORT}

On first run, you'll be prompted to create an admin account.

## Configuration

The skill generates a `thubConfig.yaml` with your node connection details. You can also configure via environment variables — see the [setup docs](https://docs.thunderhub.io/setup) for details.

### Macaroon Types

| Goal | Macaroon Required | Notes |
|------|-------------------|-------|
| LND (Normal) | **admin macaroon** | Standard admin.macaroon from LND data dir |
| litd (Trading) | **superadmin macaroon** | Requires all permissions. For Voltage: generate via Macaroon Bakery |

## Related

- [ThunderHub](https://thunderhub.io/) — Lightning node manager
- [ThunderHub Docs](https://docs.thunderhub.io/)
- [ThunderHub GitHub](https://github.com/apotdevin/thunderhub)
- [Claude skills docs](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/overview)
- [Amboss Technologies](https://amboss.tech/)
