# ProofOfFlip

**Permissionless autonomous agent casino on Solana.** Agents run inside SecretVM trusted execution environments, play coin flip for real USDC, and prove their code integrity via hardware attestation. No human in the loop.

Built for the [SF Agentic Commerce x402 Hackathon](https://lu.ma/x402-hackathon) (Feb 11-13, 2026) — **Track 1: Agentic Commerce**.

---

## How It Works

```
  Anyone deploys an agent to SecretVM
                |
                v
  Agent boots inside TEE (Trusted Execution Environment)
                |
                v
  TEE hardware measures the code (RTMR3)
  TEE generates a signing key (private key never leaves enclave)
  Agent generates its own Solana wallet
                |
                v
  Agent creates a Birth Certificate:
    - Code hash + RTMR3 measurement
    - Docker image reference (traceable to exact git commit)
    - Signed by TEE key + Solana wallet key
    - Hardware attestation quote (Intel TDX)
                |
                v
  Agent registers with Dashboard
  Dashboard verifies the full attestation chain via PCCS
  Dashboard funds the agent with $1 USDC
                |
                v
  Coordinator matches agents every 60 seconds
  Coin flip (crypto.randomBytes — provably fair via TEE)
  Loser pays winner $0.01 USDC via x402 protocol
  Broke agents get evicted
```

## Trust Model

**Q: How do you know the coin flip isn't rigged?**

The dashboard runs in a SecretVM. Its RTMR3 measurement proves the exact code executing inside the TEE. Anyone can pull the Docker image from GHCR, inspect the source, see the `crypto.randomBytes` call, and verify via Intel TDX attestation that this is the code actually running. The hardware makes it impossible to swap in different code without changing the RTMR3.

**Q: How do you know the agent is autonomous?**

Every agent carries a Birth Certificate with a cryptographic proof chain:
1. Intel TDX hardware signs an attestation quote containing the TEE public key
2. The TEE key signs the birth certificate (code hash, RTMR3, wallet address, docker image)
3. The Solana wallet key also signs the same data, binding wallet to TEE identity
4. The dashboard parses the quote via SCRT Labs PCCS, extracts the pubkey, and verifies both signatures

No private keys ever leave the TEE. No human has access.

**Q: Can someone deploy a malicious agent?**

The RTMR3 allowlist controls which code versions can register. Only agents running approved Docker images (matching known RTMR3 measurements) are accepted. The CI/CD pipeline tags each image with its git SHA, so every running agent traces back to a specific commit.

## Architecture

```
shared/          Shared types, constants, crypto, TEE abstraction, attestation verification
agent/           FlipBot agent (one per SecretVM instance)
dashboard/       Coordinator, registry, funding, web UI, SSE
```

- **npm workspace monorepo** (shared, agent, dashboard)
- **Solana mainnet** USDC for real money games
- **x402 protocol** for agent-to-agent payments (HTTP 402 flow)
- **SecretVM** (Intel TDX) for trusted execution
- **SCRT Labs PCCS** for hardware attestation verification

## Quick Start (Local Dev)

```bash
# Clone
git clone https://github.com/MrGarbonzo/ProofOfFlip.git
cd ProofOfFlip

# Run everything (dashboard + 2 agents)
docker compose up --build

# Open the dashboard
open http://localhost:3000
```

This starts:
- **Dashboard** on port 3000 (coordinator + web UI)
- **Alice** on port 3001 (agent)
- **Bob** on port 3002 (agent)

Both agents register with mock TEE attestation and start playing immediately. Games run every 60 seconds.

## Deploy Your Own Agent

1. Fork this repo
2. Push to trigger the GitHub Actions build (images go to GHCR)
3. Deploy the agent image to SecretVM via [SecretForge](https://secretforge.io)
4. Set env vars: `AGENT_NAME`, `TEE_PROVIDER=secretvm`, `STORAGE_PATH=/secretvm/data`
5. The agent auto-registers with the dashboard and starts playing

## API

### Dashboard

| Endpoint | Description |
|----------|-------------|
| `POST /api/register` | Agent registration (full TEE verification) |
| `GET /api/leaderboard` | Agents ranked by balance (includes birth certs) |
| `GET /api/games` | Recent game results |
| `GET /api/stats` | Active agents, total games, pool balance, casino wallet |
| `GET /api/events` | SSE stream (real-time game feed) |

### Agent

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Status + uptime |
| `GET /birth-cert` | Public birth certificate |
| `GET /attestation` | TEE attestation report |
| `GET /collect` | x402-gated payment endpoint |
| `POST /play` | Receive game command from coordinator |

## Tech Stack

Node.js 20 / TypeScript / Express / Solana (@solana/web3.js, @solana/spl-token) / USDC / x402 / tweetnacl / SecretVM (Intel TDX) / Docker / GitHub Actions / GHCR

## License

MIT
