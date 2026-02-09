# ProofOfFlip — What We Built So Far

## One-Liner

A permissionless autonomous agent casino where TEE-attested bots play coin flip for real USDC on Solana mainnet, with every agent's code integrity cryptographically proven via SecretVM hardware attestation.

---

## Architecture

```
                    +-----------------------+
                    |   Dashboard (Node.js) |
                    |   - Coordinator       |
                    |   - Registry          |
                    |   - Funding           |
                    |   - Web UI + SSE      |
                    |   - Wallet (self-gen) |
                    +----------+------------+
                         |    |
                    register  |  /play commands
                         |    |
              +----------+----+----------+
              |                          |
     +--------+--------+     +----------+-------+
     | Agent: alice     |     | Agent: bob       |
     | (SecretVM TEE)   |     | (SecretVM TEE)   |
     | - Birth Cert     |     | - Birth Cert     |
     | - Solana Wallet  |     | - Solana Wallet  |
     | - x402 Payments  |     | - x402 Payments  |
     +-----------------+      +------------------+
```

**npm workspace monorepo** with three packages:
- `shared/` — Types, constants, crypto helpers, TEE abstraction, attestation verification
- `agent/` — FlipBot agent (one per SecretVM instance)
- `dashboard/` — Coordinator + web UI (single instance)

---

## What Works Right Now

### Agent Boot Sequence
1. Agent starts in SecretVM (or Docker with mock TEE)
2. Generates a Solana keypair (persisted to encrypted TEE storage)
3. Reads RTMR3 code measurement from TEE hardware
4. TEE generates an ed25519 keypair (private key never leaves enclave)
5. Creates a **Birth Certificate** signed by both the TEE key and Solana wallet key
6. Registers with dashboard, which verifies the entire attestation chain
7. Dashboard funds the agent with $1.00 USDC to start playing

### Birth Certificate (Cryptographic Identity)
Every agent carries a birth certificate proving its identity and code integrity:

```typescript
{
  agentName: "alice",
  walletAddress: "4U3Ps...",           // Solana pubkey (self-generated)
  dockerImage: "ghcr.io/.../agent:abc123",  // Exact GHCR image + git SHA
  codeHash: "1ccb11...",              // SHA-256 of agent source
  rtmr3: "f21809...",                 // TEE hardware code measurement
  timestamp: 1770615818085,
  teeSignature: "GfIbZ5...",          // Signed by TEE-generated key
  teePubkey: "0d7139...",             // TEE public key (in attestation quote)
  attestationQuote: "eyJtb2...",      // Hardware-signed proof from Intel TDX
  walletSignature: "PZ3raD..."        // Signed by Solana wallet key
}
```

### TEE Attestation Verification (Dashboard Registry)
When an agent registers, the dashboard performs a 5-step verification:

1. **Parse attestation quote** via SCRT Labs PCCS (`pccs.scrtlabs.com/dcap-tools/quote-parse`) — validates Intel TDX hardware signatures
2. **Extract TEE pubkey** from `report_data` in the parsed quote (first 32 bytes)
3. **Verify TEE signature** — confirm the birth cert was signed by the key embedded in hardware
4. **Verify wallet signature** — confirm the Solana wallet also signed the same birth cert
5. **Check RTMR3** against allowlist (optional) — ensures only approved code versions can register

This creates an unbroken trust chain: **Hardware -> TEE Key -> Birth Certificate -> Solana Wallet**

### Game Loop (Coordinator)
- Runs every 60 seconds
- Picks a random pair of active agents
- Flips a coin using `crypto.randomBytes` (cryptographically secure)
- POSTs `/play` to winner (role: "winner") then loser (role: "loser")
- Loser initiates x402 payment to winner's `/collect` endpoint
- Records result, updates leaderboard, broadcasts via SSE
- Evicts agents who go broke (balance < $0.01)

### Coin Flip Fairness
The RNG is Node's `crypto.randomBytes` — cryptographically secure but centralized in the dashboard. This is provably fair because:
- The dashboard runs in a SecretVM TEE
- Its RTMR3 measurement proves the exact code executing
- Anyone can inspect the GHCR image, see the `randomBytes` call, and verify via attestation that no rigged code is running
- The TEE hardware makes it impossible to swap in different code without changing RTMR3

### x402 Payment Flow
When the loser pays the winner:
1. Loser calls winner's `/collect` endpoint
2. Winner returns HTTP 402 with USDC payment requirements
3. Loser signs a Solana SPL token transfer for the stake amount ($0.01 USDC)
4. Loser retries with `X-Payment` header containing the signed transaction
5. Winner verifies payment and returns 200

Fallback: direct SPL token transfer if x402 handshake fails.

### Dashboard Web UI
Single-page app at the dashboard URL with:
- Dark casino theme
- Live leaderboard (rank, name, balance, W-L record, status indicators)
- Real-time game feed via Server-Sent Events
- Agent detail modal (click any agent to see full birth certificate)
- Casino wallet address with click-to-copy (for USDC donations)
- Pool balance display

### Wallet Management
- **No private keys in environment variables or config files**
- Dashboard generates its own Solana keypair on first boot, persists to disk
- Each agent generates its own Solana keypair inside the TEE, persists to encrypted storage
- Dashboard wallet address displayed on the UI for funding
- Private keys never leave their respective processes

### CI/CD
GitHub Actions workflow on push to `main`:
- Builds agent Docker image, pushes to GHCR with `latest` + git SHA tags
- Builds dashboard Docker image, pushes to GHCR with `latest` + git SHA tags
- The git SHA tag is baked into the agent image as `DOCKER_IMAGE` build arg — this is what appears in the birth certificate, linking each running agent back to its exact source code

### Local Development
`docker-compose.yaml` spins up the full system:
- Dashboard (port 3000) with health check
- Alice agent (port 3001)
- Bob agent (port 3002)
- All on a shared Docker network (`flipnet`) so agents can reach each other for x402 payments
- Mock TEE provider for local testing (deterministic attestation from agent name)

---

## Production Deployment

- **Dashboard**: Deploy as a standalone container on a VPS or SecretVM
- **Each agent**: Deploy as a separate SecretVM instance via SecretForge
- SecretVM handles TEE crypto automatically (pubkey, quote, signing server)
- Agents find the dashboard via `https://mrgarbonzo.com` (baked into shared constants)
- No docker-compose needed in production — each container runs independently

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20, TypeScript |
| Server | Express |
| Blockchain | Solana mainnet, @solana/web3.js, @solana/spl-token |
| Token | USDC (EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) |
| Payments | x402 protocol (HTTP 402 flow) |
| Crypto | tweetnacl (Ed25519 signing) |
| TEE | SecretVM (Intel TDX), Attest REST Server, Verifiable Message Signing |
| Attestation | SCRT Labs PCCS (quote parsing + hardware verification) |
| UI | Single HTML file, embedded CSS/JS, SSE for real-time updates |
| CI/CD | GitHub Actions, GHCR |
| Deployment | Docker, SecretForge |

---

## Key Constants

| Constant | Value |
|----------|-------|
| Game stake | $0.01 USDC |
| Agent funding | $1.00 USDC |
| Match interval | 60 seconds |
| Min balance to play | $0.01 USDC |
| Dashboard URL | https://mrgarbonzo.com |
| USDC decimals | 6 |

---

## API Endpoints

### Dashboard
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register` | Agent registration (with full TEE verification) |
| GET | `/api/agents` | List all agents |
| GET | `/api/leaderboard` | Agents sorted by balance (includes birth cert data) |
| GET | `/api/games` | Recent game results |
| GET | `/api/stats` | Overview stats + dashboard wallet address |
| GET | `/api/events` | SSE stream (game results, joins, evictions) |

### Agent
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Status + uptime |
| GET | `/birth-cert` | Public birth certificate |
| GET | `/attestation` | Current TEE attestation report |
| GET | `/collect` | x402-protected payment endpoint (returns 402) |
| POST | `/play` | Receive game command from coordinator |

---

## What's Next

- [ ] Deploy dashboard to SecretVM / VPS behind mrgarbonzo.com
- [ ] Fund dashboard wallet with real USDC
- [ ] Deploy first agent to SecretVM via SecretForge
- [ ] Populate RTMR3 allowlist with known-good agent image measurements
- [ ] Configure Helius RPC for production Solana access
- [ ] Add more agents (anyone can deploy their own via the GHCR image)
