---
name: thunderhub
description: Install, configure, and run ThunderHub — a Lightning Network node manager for LND and litd nodes. Use this skill when the user wants to set up ThunderHub, needs a web UI for their Lightning node, or wants to manage channels, payments, or Taproot Assets through a browser interface.
---

# ThunderHub Installation Skill

This skill installs and configures [ThunderHub](https://thunderhub.io/), an open-source web-based Lightning Network node manager. It supports both LND and litd (Lightning Terminal) nodes, including Voltage Cloud-hosted nodes.

## When to use

Invoke this skill whenever the user wants to:

- Install / set up ThunderHub
- Get a web UI for managing their Lightning node
- Configure ThunderHub to connect to their LND or litd node
- Access Taproot Assets management through ThunderHub
- Set up ThunderHub for a Voltage Cloud node

## Overview

The skill guides the user through a step-by-step setup conversation, collects their Lightning node connection details, generates a `thubConfig.yaml`, and runs ThunderHub via Docker (or provides source install instructions).

## Setup Flow for Claude

1. **Determine goal** — ask whether they want **Normal Lightning management (LND)** or **Trading / Taproot Assets (litd)**.
2. **Determine node hosting** — ask if the node is **self-hosted** or on **Voltage Cloud**.
3. **Ask installation method** — **Docker** (recommended, simpler) or **Source** (clone + build from source, requires Node.js v24+).
4. **Collect connection details** based on the goal and hosting type (see tables below).
5. **Confirm everything** with the user before running the installation script.
6. **Run the script** with the collected parameters.
7. **Present the access URL** and any post-installation instructions.

## Input Collection

### Step 1: Goal

| If user says... | Goal | Notes |
|---|---|---|
| Normal management, channels, payments, monitoring | `lnd` | Standard LND node setup |
| Trading, Taproot Assets, Loop, Pool, swaps | `litd` | Requires litd running with LND |

### Step 2: Hosting

| If user says... | Node type | Notes |
|---|---|---|
| Self-hosted, my own server, Umbrel, Raspiblitz, etc. | `self-hosted` | Will need TLS cert path |
| Voltage, Voltage Cloud | `voltage` | No TLS cert needed, uses CA-signed certs |

### Step 3: Choose installation method

| Option | Description | Prerequisites |
|---|---|---|
| **Docker** (recommended) | Runs ThunderHub in a container with auto-restart | Docker installed |
| **Source** | Clones repo, installs deps, builds, and you start manually | Node.js v24+, git |

Ask the user which they prefer. If Docker is not available and they chose Docker, offer source as a fallback.

### Step 4: Connection Details

**For LND / normal management (self-hosted):**

| Parameter | Description | Example |
|---|---|---|
| `--server-url` | LND gRPC host:port | `127.0.0.1:10009` |
| `--macaroon-path` | Path to **admin macaroon** on host | `/home/user/.lnd/data/chain/bitcoin/mainnet/admin.macaroon` |
| `--tls-cert-path` | Path to tls.cert on host | `/home/user/.lnd/tls.cert` |

**For LND / normal management (Voltage):**

| Parameter | Description | Example |
|---|---|---|
| `--server-url` | Voltage node API URL | `my-node.voltageapp.io:443` |
| `--macaroon-path` | Path to **admin macaroon** on host | `/home/user/voltage-admin.macaroon` |
| `--node-type` | `voltage` | (no TLS cert needed) |

**For litd / Trading (self-hosted):**

| Parameter | Description | Example |
|---|---|---|
| `--server-url` | litd gRPC host:port | `localhost:8443` |
| `--macaroon-path` | Path to **superadmin macaroon** from LND data dir | `/home/user/.lnd/data/chain/bitcoin/mainnet/admin.macaroon` |
| `--tls-cert-path` | Path to tls.cert from LND data dir | `/home/user/.lnd/tls.cert` |

**For litd / Trading (Voltage):**

| Parameter | Description | Example |
|---|---|---|
| `--server-url` | Voltage node API URL | `my-node.voltageapp.io:443` |
| `--macaroon-path` | Path to **superadmin macaroon** | `/home/user/voltage-superadmin.macaroon` |
| `--node-type` | `voltage` | (no TLS cert needed) |

### Step 5: Run the script

```bash
cd thunderhub
npx -y tsx scripts/install_thunderhub.ts \
  --goal <lnd|litd> \
  --node-type <self-hosted|voltage> \
  --method <docker|source> \
  --server-url <host:port> \
  --macaroon-path <path> \
  [--tls-cert-path <path>] \
  [--port 3000]
```

The script will:
1. Validate all inputs
2. Generate `thubConfig.yaml` with the correct format
3. Install ThunderHub via your chosen method
4. Print the access URL and any post-install notes

### Step 6: Present results

On success, tell the user:
- **URL**: `http://localhost:3000` (or custom port)
- **Docker**: Container `thunderhub` is running
- **Source**: Directory with instructions to start
- **First-run**: They'll be prompted to create an admin account

## Instructions for Claude (the AI agent)

1. **Always start by asking what they want to do** — Normal Lightning management or Trading/Taproot Assets.
2. **Then ask about hosting** — Self-hosted or Voltage Cloud.
3. **Ask which installation method** — **Docker** (recommended, simpler) or **Source** (clone and build, requires Node.js v24+).
4. **Collect the exact paths** to macaroon and TLS cert files. Ask about the OS they're on to guide default paths.
5. **Macaroon type by goal**:
   - **LND goal** → ask for an **admin macaroon**
   - **litd goal (Trading/Taproot Assets)** → ask for a **superadmin macaroon**. For Voltage, tell them to generate one from the Voltage Macaroon Bakery. For self-hosted litd, the LND admin.macaroon may work for basic litd, but a superadmin macaroon (with all permissions) is required for full functionality (Taproot Assets, Loop, Pool).
6. **For Voltage nodes**: No TLS cert is needed — they use CA-signed certificates.
7. **Confirm the plan** before running the script.
8. **After running**, confirm ThunderHub is accessible and give the user their URL.
9. **If Docker is not available** and they chose Docker, suggest installing Docker first or switching to source install.

### Common default paths by OS

**Linux:**
- LND macaroon: `~/.lnd/data/chain/bitcoin/mainnet/admin.macaroon`
- LND TLS cert: `~/.lnd/tls.cert`
- litd TLS cert: `~/.lit/tls.cert`

**macOS:**
- LND macaroon: `~/Library/Application Support/Lnd/data/chain/bitcoin/mainnet/admin.macaroon`
- LND TLS cert: `~/Library/Application Support/Lnd/tls.cert`

**Docker LND:**
- Macaroon: `/var/lib/docker/volumes/lnd-data/_data/data/chain/bitcoin/mainnet/admin.macaroon`

### Troubleshooting tips

- **Wrong macaroon**: Ensure it's the **admin** macaroon, not read-only or invoice
- **Connection refused**: Wrong port — LND uses 10009, litd uses 8443 (REST) or 8443 (RPC)
- **TLS errors**: Wrong cert path, or cert expired (LND certs expire after ~14 months)
- **Voltage no TLS**: Voltage uses CA-signed certs — never ask for TLS cert
- **litd macaroon path**: Use the LND macaroon path, not litd's
- **Docker volumes**: Host paths in `-v` mounts must be absolute

## Reference

- ThunderHub: https://thunderhub.io/
- Docs: https://docs.thunderhub.io/
- GitHub: https://github.com/apotdevin/thunderhub
- Docker Hub: `ghcr.io/apotdevin/thunderhub:latest`
