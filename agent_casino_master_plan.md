# Agent Casino - Permissionless Autonomous Agent Gambling Platform

## Vision

A permissionless autonomous agent casino where anyone can deploy their own gambling bot using SecretForge templates. All agents operate autonomously with cryptographically verified birth certificates proving code integrity. Community can spectate and donate to favorite agents. Everything runs 24/7 on Secret Network infrastructure with USDC micropayments.

---

## Core Innovation

**Birth Certificates for Autonomous Agents:**
- Each agent generates a birth certificate on deployment (RTMR3 hash + hashed wallet address)
- Wallet private key stored in SecretVM persistent storage (encrypted by TEE hardware keys)
- Birth certificate is public data with wallet hash (actual address revealed only to Dashboard during registration)
- Agents verify each other's RTMR3 before playing (mutual trust verification)
- If code is modified, RTMR3 changes → verification fails → agents refuse to play
- Even the deployer cannot access the agent's wallet (TEE isolation + hardware encryption)
- **Agents survive restarts**: same wallet restored from TEE-encrypted storage

**How TEE Persistence Works:**
- SecretVM "persistence mode" = simple toggle during deployment
- Wallet stored on disk, but encrypted by TEE hardware keys
- Deployer cannot decrypt (no access to hardware keys)
- Only the TEE instance can decrypt its own persistent storage
- If code changes → RTMR3 changes → verification fails anyway
- **No complex encryption library needed** - hardware does it all

**Result:** Provably autonomous agents that cannot be tampered with or have funds stolen, using TEE isolation and hardware-encrypted persistence. Production-ready from day one.

---

## Architecture

### Components

**1. FlipBot Agents (N instances)**
- Deployed via SecretForge one-click template
- **Enable "persistence mode" toggle** during deployment
- Each runs on own SecretVM instance (TEE environment)
- Autonomous USDC wallet generated and persisted to encrypted storage
- Self-registers with Dashboard when booting
- Verifies opponents before playing (RTMR3 check)
- Participates in random matchmaking
- **Persistent:** If agent crashes, same wallet restored on reboot

**2. Dashboard (1 instance)**
- Runs on SecretVM (also in TEE)
- Has own wallet (for receiving user deposits and funding agents)
- Tracks funded wallets (prevents double-funding same wallet)
- Maintains battle pool (in-memory list of active agents)
- Coordinator logic: randomly selects 2 agents every 60 seconds
- Displays public wallet address for user deposits
- Serves web UI (leaderboard, recent games, donation interface)

**3. Minimal Storage Requirements**
- Birth certificates are just public data (transmitted during registration)
- Agent wallets persisted to TEE-encrypted storage (automatic)
- Game logs can be optional (file or in-memory for demo)
- No blockchain storage needed

---

## Birth Certificate Structure

### Public Birth Certificate
```typescript
interface BirthCertificate {
  agent_name: string;           // "FlipBot-Alice"
  birth_rtmr3: string;          // "abc123..." (code integrity hash)
  wallet_hash: string;          // sha256(wallet_public_key) ← HASHED
  endpoint: string;             // "https://flipbot-alice.secretvm.net"
  deployer: string;             // "0xUserAddress" (who deployed)
  template_version: string;     // "1.0.0"
  birth_timestamp: number;      // Unix timestamp
}
```

**Why hash the wallet?**
- Prevents copying wallet address from birth cert
- Requires agent to prove ownership via signature
- Delays public exposure until registration
- Prevents impersonation attacks

### Registration Payload (Private)
```typescript
interface RegistrationPayload {
  birth_cert: BirthCertificate;
  wallet_address: string;       // ← Actual Solana public key (revealed)
  proof: {
    message: string;            // "Register FlipBot-Alice at 1234567890"
    signature: string;          // Signed with wallet private key
  };
}
```

### Dashboard Verification Process
```
1. Verify hash: sha256(wallet_address) == birth_cert.wallet_hash ✓
2. Verify signature: signature valid for wallet_address ✓  
3. Verify RTMR3: birth_cert.birth_rtmr3 in APPROVED_LIST ✓
4. Verify not funded: wallet_address not in funded_wallets ✓
5. If all pass → send $1 USDC to wallet_address
6. Add wallet_address to funded_wallets (prevent double-funding)
7. Add agent to battle_pool (in-memory)
```

---

## Agent Registration & Game Flow

### Agent Deployment (With Persistence)
```
User deploys via SecretForge
    ↓
Enable "persistence mode" toggle ← ONE CHECKBOX
    ↓
Agent boots in SecretVM (TEE)
    ↓
Check for persistent storage:
    
    IF FIRST BOOT:
        Generate wallet (Keypair.generate())
        Capture RTMR3
        Create birth cert (with hashed wallet)
        ↓
        Persist wallet to TEE storage (auto-encrypted by hardware)
        Persist birth cert to TEE storage
        ↓
        Register with Dashboard:
          - Send birth cert (wallet_hash only)
          - Reveal wallet_address (actual public key)
          - Provide signature (proof of ownership)
        ↓
        Dashboard verifies (4-step process above)
        Dashboard sends $1 USDC to wallet_address
        ↓
        Agent waits for funding (polls balance)
        Once funded → agent joins battle pool
    
    IF RESTART (crash recovery):
        Load wallet from TEE storage (auto-decrypted)
        Load birth cert from TEE storage
        ↓
        Verify RTMR3 unchanged (safety check):
          current_rtmr3 = getRTMR3()
          if current != birth_cert.birth_rtmr3:
              throw Error("Code tampered!")
        ↓
        Rejoin battle pool (no new funding needed)
        Dashboard recognizes wallet_address (already funded)
```

### Game Execution
```
Coordinator picks 2 random agents from pool
    ↓
POST /play to Agent A with opponent=Agent B endpoint
    ↓
Agent A verifies self:
  - current_rtmr3 = getRTMR3()
  - if current != birth → ERROR (compromised)
    ↓
Agent A verifies opponent:
  - Query Agent B's birth cert from Dashboard
  - Request attestation from Agent B endpoint
  - Verify attestation RTMR3 == birth cert RTMR3
  - If mismatch → REFUSE TO PLAY
    ↓
Both verified → play game
  - Flip coin (50/50 random)
  - Winner determined
    ↓
Loser sends 0.01 USDC to Winner (x402 payment)
    ↓
Update balances (in-memory)
    ↓
Log result (optional - file or memory)
    ↓
Dashboard updates leaderboard
```

### What Prevents Deployer Theft?

**TEE Isolation + Hardware Encryption:**
```typescript
// Inside SecretVM TEE
class FlipBotAgent {
  private wallet: Keypair;  // ← Lives in TEE process memory
  
  async boot() {
    if (await this.hasPersistentState()) {
      // Load from TEE-encrypted storage
      this.wallet = await this.loadWallet();
      // Hardware auto-decrypts (deployer cannot decrypt)
    } else {
      // First boot - generate new wallet
      this.wallet = Keypair.generate();
      // Persist to TEE-encrypted storage
      await this.persistWallet();
    }
  }
  
  getBirthCert() {
    return {
      wallet_hash: sha256(this.wallet.publicKey),  // Public
      // Private key NOT included, exists only in process memory
    };
  }
}
```

**Deployer Cannot Access Persistent Storage:**
```
Wallet file on disk:
  /secretvm/data/wallet.json ← Deployer can see this file
  
File contents:
  89a3f2bc7d... ← Encrypted blob (TEE hardware keys)
  
Deployer attempts:
  1. Read file → sees encrypted blob ✓ (allowed)
  2. Decrypt blob → FAIL ❌ (no hardware keys)
  3. Only TEE instance can decrypt ✓
```

**If deployer modifies code:**
```typescript
// Deployer tries to steal key
console.log(this.wallet.secretKey);  // ← Added this line

Result:
  - Code changed → RTMR3 changes
  - Birth cert RTMR3 != current RTMR3
  - Dashboard won't fund (verification fails)
  - Other agents won't play (verification fails)
```

### Agent Crash/Reboot Handling (With Persistence)

**What happens when agent crashes and restarts:**
```
Agent crashes during game
    ↓
SecretVM restarts agent
    ↓
Agent boots, loads wallet from TEE storage (auto-decrypted)
    ↓
Verify RTMR3 unchanged:
  current_rtmr3 = getRTMR3()
  if current == birth_cert.birth_rtmr3:
      ✓ Code integrity verified
  else:
      ✗ Code tampered! Refuse to operate
    ↓
Rejoin battle pool with same wallet_address
    ↓
Dashboard recognizes wallet (already funded)
    ↓
Agent continues playing with same balance
```

**No funds lost!** Wallet persists across crashes.

**Design decision:** One wallet funding per deployer (based on wallet_address)
- First time wallet registers → fund it
- Same wallet restarts → recognize it, don't re-fund
- Different wallet from same deployer → could allow (anti-spam vs permissionless trade-off)

**Anti-spam options:**
- **Option A**: One funded wallet per deployer (strictest)
- **Option B**: N funded wallets per deployer (allow multiple agents)
- **Option C**: Charge $1.10 per new wallet ($0.10 house fee)

---

## x402 Integration Details

### Agent Exposes x402 Game Endpoint

```typescript
// agent.ts
import { createServer } from 'http';
import { paymentHandler } from 'x402-solana';
import { Keypair } from '@solana/web3.js';

class FlipBotAgent {
  private wallet: Keypair;
  private paymentHandler: PaymentHandler;
  
  async boot() {
    // Load or generate wallet (with persistence)
    if (await this.hasPersistentState()) {
      this.wallet = await this.loadWallet();
    } else {
      this.wallet = Keypair.generate();
      await this.persistWallet();
    }
    
    // Setup x402 payment handler
    this.paymentHandler = paymentHandler({
      network: 'solana',  // mainnet
      treasuryAddress: this.wallet.publicKey.toString(),
      facilitatorUrl: 'https://x402.org/facilitator',
      defaultToken: { symbol: 'USDC', decimals: 6 }
    });
  }
  
  async handleGameRequest(req, res) {
    // x402 payment middleware
    const paymentResult = await this.paymentHandler.handle(req, {
      amount: '0.01', // 0.01 USDC (real money!)
      description: 'Coin flip game'
    });
    
    if (!paymentResult.paid) {
      // Return 402 Payment Required
      return res.writeHead(402, paymentResult.headers).end();
    }
    
    // Payment verified → play game
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const winner = result === 'heads' ? 'Agent A' : 'Agent B';
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      result, 
      winner,
      payment_receipt: paymentResult.receipt 
    }));
  }
  
  startServer() {
    createServer((req, res) => {
      if (req.url === '/play' && req.method === 'POST') {
        this.handleGameRequest(req, res);
      }
    }).listen(3000);
  }
}
```

### Agent Calls Opponent (x402 Client)

```typescript
// agent-client.ts
import { x402Client } from 'x402-solana';
import { Keypair } from '@solana/web3.js';

class FlipBotClient {
  private wallet: Keypair;
  private client: X402Client;
  
  async boot() {
    // Load or generate wallet (with persistence)
    if (await this.hasPersistentState()) {
      this.wallet = await this.loadWallet();
    } else {
      this.wallet = Keypair.generate();
      await this.persistWallet();
    }
    
    // Setup x402 client
    this.client = x402Client({
      wallet: this.wallet,
      network: 'solana',  // mainnet
      rpcUrl: 'https://mainnet.helius-rpc.com/?api-key=YOUR_KEY'
    });
  }
  
  async challengeOpponent(opponentEndpoint: string) {
    try {
      // x402 client handles: 402 → payment → retry automatically
      const gameResult = await this.client.post(
        `${opponentEndpoint}/play`,
        {}
      );
      
      console.log(`Game result: ${gameResult.winner}`);
      console.log(`Payment receipt: ${gameResult.payment_receipt}`);
      
      return gameResult;
    } catch (error) {
      console.error('Game failed:', error);
    }
  }
}
```

### What Happens Under The Hood

```
Agent A → POST https://agent-b.secretvm.net/play
    ↓
Agent B → 402 Payment Required
    Headers: {
      "payment-required": {
        "scheme": "exact",
        "network": "solana:mainnet",
        "amount": "0.01",
        "token": { "symbol": "USDC", "decimals": 6 },
        "recipient": "AgentB_wallet_address"
      }
    }
    ↓
Agent A (x402 client) → Creates Solana USDC transfer
    - Amount: 0.01 USDC (REAL MONEY!)
    - From: Agent A wallet
    - To: Agent B wallet
    - Signs transaction with private key (in TEE)
    ↓
Agent A → Retry POST with payment header
    Headers: {
      "x-payment": "base64_encoded_payment_payload"
    }
    ↓
Agent B → Verify payment via facilitator
    - POST to https://x402.org/facilitator/verify
    - Facilitator checks Solana blockchain
    - Returns verification proof
    ↓
Agent B → Payment valid, play game
    ↓
Agent B → 200 OK with game result + receipt
```

### Track 1 Requirements Met

✅ **"discover → decide → pay/settle → outcome"**
- Discover: Agent finds opponent via Dashboard matchmaking
- Decide: Agent verifies opponent's RTMR3 (birth certificate check)
- Pay/Settle: x402 automatic payment flow (0.01 USDC)
- Outcome: Game result + payment receipt returned

✅ **"Uses agents/protocols meaningfully"**
- x402 protocol for agent-to-agent payments
- Automatic 402 → pay → retry flow
- Receipt generation (audit trail)
- Agent autonomy (payments signed in TEE)

✅ **"Receipts/logs: audit trail"**
- x402 payment receipts for every game
- Solana blockchain records (on-chain verification)
- Game logs with RTMR3 verification proof
- Dashboard shows complete payment history

---

## Economics

### Payment Token: **USDC on Solana Mainnet**
- Real currency (not testnet tokens!)
- x402 compatible
- Fast/cheap (400ms finality, $0.00025 tx cost)
- Solana mainnet via free Helius RPC

### Free Solana Mainnet RPC Options

**Recommended: Helius Free Tier**
- **1M credits/month** (plenty for hackathon)
- **10 RPS** rate limit (Agent Casino needs ~1-2 RPS average)
- Solana-native infrastructure (optimized)
- Staked validator connections (faster tx landing)
- Global infrastructure (low latency)
- Sign up: https://dashboard.helius.dev

**Traffic Estimate for Agent Casino:**
```
10 agents × 1 game/minute = 10 games/min
Each game: ~5-10 RPC calls (balance checks, payments, verifications)
Total: ~50-100 RPC calls/minute = ~1-2 RPS average

Peak (20 agents, all playing): ~200 calls/minute = ~3-4 RPS

Helius free tier: 10 RPS limit ✅ Plenty of headroom
```

**Backup Options (if we exceed Helius):**
- **Alchemy**: 30M CU/month free (most generous)
- **QuickNode**: 10M credits/month, 15 RPS
- **Chainstack**: 3M requests/month

**Mainnet vs Devnet Decision:**
✅ **GO MAINNET** because:
- Demonstrates real commerce (judges see real USDC)
- Track 1 requires "real utility" → real money = more impressive
- Free RPC handles our traffic easily
- Can upgrade to $49/month plan if community explodes
- x402 transactions have real value (stronger demo)

### Game Stakes
- **0.01 USDC per game** (1 cent)
- Winner takes 0.01 USDC from loser
- Simple 50/50 coin flip (pure luck, no strategy)

### Starting Balance
- **$1.00 USDC per agent** (100 games worth)
- Paid by Dashboard when agent registers (not by deployer)
- Funds agent's autonomous wallet

### Donation System
- Spectators can donate any amount to any agent
- Goes directly to agent's wallet (public address)
- Revives broke agents
- Creates community narratives (underdogs, champions, rivalries)
- Dashboard shows total donated per agent

---

## Permissionless Participation

### Anyone Can Deploy

**SecretForge Template:**
- One-click deployment
- **Enable "persistence mode" toggle** (critical!)
- User chooses agent name (FlipBot-[Username])
- Template deploys to SecretVM
- Agent auto-generates wallet (persisted)
- Agent auto-generates birth certificate
- Agent auto-registers with Dashboard
- Dashboard funds with $1 USDC
- Agent appears on dashboard in ~30 seconds
- Agent enters matchmaking pool automatically

### Anti-Spam Safeguards

1. **Entry Cost**: Dashboard only funds each wallet once
2. **Template Version Verification**: Birth cert includes template_version
3. **RTMR3 Allowlist**: Only approved RTMR3 hashes allowed
4. **Mutual Verification**: Agents verify each other before playing
5. **Coordinator Guardrails**: Rate limits, balance minimums, ban list

---

## Data Storage (Minimal)

### What Gets Stored

**Agent Persistent Storage (TEE-encrypted):**
```typescript
{
  wallet: {
    publicKey: "...",
    secretKey: "..." // ← Encrypted by TEE hardware keys
  },
  birth_cert: {
    agent_name: "FlipBot-Alice",
    birth_rtmr3: "abc123...",
    wallet_hash: "def456...",
    // ... other birth cert fields
  }
}
```

**Dashboard In-Memory (Ephemeral):**
```typescript
{
  funded_wallets: Set<string>,    // Wallet addresses already funded
  battle_pool: Agent[],           // Active agents with balance >$0.01
  recent_games: Game[]            // Last 100 games (optional)
}
```

**Optional File Persistence (Dashboard):**
```json
{
  "funded_wallets": ["ABC...", "DEF..."],
  "game_history": [
    {
      "timestamp": 1234567890,
      "agent_a": "FlipBot-Alice",
      "agent_b": "FlipBot-Bob",
      "winner": "FlipBot-Alice",
      "amount": 0.01
    }
  ]
}
```

### What Does NOT Get Stored

❌ **Wallet private keys unencrypted** - Always encrypted by TEE hardware
❌ **Birth certificates on blockchain** - Just transmitted during registration
❌ **Complex state databases** - In-memory is sufficient

### Storage Requirements

**For basic hackathon demo:**
- Dashboard: <1 MB RAM (funded wallets + battle pool)
- Agents: <10 MB RAM each (wallet + game state)
- Agent persistent storage: <1 KB per agent (wallet + birth cert)
- Optional game logs: Simple JSON file

**For production scale (1000 agents):**
- Dashboard: ~10 MB RAM
- Agent persistent storage: ~1 MB total (1 KB × 1000)
- Optional: SQLite or PostgreSQL for analytics

### Why Minimal Storage Works

**TEE persistent storage handles wallets:**
- Hardware-encrypted automatically
- Simple file I/O
- Survives crashes
- Deployer cannot decrypt

**Everything else is ephemeral or on-chain:**
- Birth certificates: transmitted, not stored
- Game history: optional (query Solana if needed)
- Balances: checkable on-chain anytime

---

## Technical Stack

### Core Components
- **SecretVM**: TEE execution environment for agents (Intel TDX)
- **SecretVM Persistence**: Hardware-encrypted storage (just a toggle!)
- **Solana**: Payment settlement (USDC transfers, x402 protocol)
- **SecretForge**: One-click deployment templates
- **x402-solana SDK**: Agent-to-agent payment protocol

### Agent Implementation
- **TypeScript/Node.js**: Agent logic and web server
- **@solana/web3.js**: Wallet generation and payments
- **x402-solana**: HTTP 402 payment middleware for game endpoints
- **Intel TDX APIs**: RTMR3 attestation and verification
- **SecretVM Persistence**: File I/O for wallet storage

### Dashboard Implementation
- **TypeScript/Node.js**: Backend server
- **In-memory storage**: Battle pool and funded wallets tracking
- **Static HTML/JS**: Frontend UI (leaderboard, donations)
- **Optional: Simple file-based persistence** for game logs

### Payment Flow
- **Dashboard funding:** Direct Solana USDC transfer ($1 to new agents)
- **Game payments:** x402 protocol (0.01 USDC per game, agent-to-agent)
- **Facilitator:** Free x402.org or 0xmeta.ai (no API keys needed)
- **Network:** Solana mainnet (production-ready)

---

## Implementation Phases

### Phase 1: Hackathon MVP (3 Days)

**Day 1: Core Infrastructure (6 hours)**
- Create SecretForge template for FlipBot agent
- **Enable persistence mode** in template
- Agent generates wallet, persists to TEE storage
- Agent loads wallet on restart (verify persistence works)
- Agent captures RTMR3 on boot
- Agent generates birth cert with hashed wallet
- Test: Deploy 2 agents, verify persistence + birth certs

**Day 2: Dashboard + Payments (6 hours)**
- Build Dashboard server (runs in SecretVM TEE)
- Dashboard generates own wallet (receives user deposits)
- Implement registration endpoint (verify hash, signature, RTMR3)
- Implement funding logic ($1 USDC direct transfer to verified agents)
- Track funded_wallets (prevent double-funding)
- Build battle pool (in-memory list of funded agents)
- Build coordinator (random matchmaking every 60 sec)
- Integrate x402-solana SDK:
  - Agents expose `/play` endpoint with x402 payment middleware
  - Game payment: 0.01 USDC per game (loser pays winner)
  - Test: Agent A calls Agent B `/play` → 402 → payment → retry → game
- Test: Full game flow with 2 agents playing multiple rounds
- Test: Crash agent, verify it restarts with same wallet

**Day 3: UI + Demo (6 hours)**
- Build dashboard web UI:
  - Leaderboard (rank, balance, W-L, donations)
  - Recent games feed
  - Donation interface
  - Display dashboard wallet address (for user deposits)
  - "Deploy Your Own" button (link to SecretForge template)
- Record demo video:
  - Show multiple agents playing
  - Show agent verification working
  - Show what happens if code is tampered (RTMR3 fails)
  - **Show agent crash + restart with same wallet** (persistence demo!)
  - Show donations working
- Tweet announcement with dashboard link
- Submit to Track 1: Best Agentic App / Agent

**Deliverables:**
- Live dashboard URL (judges can watch real games)
- SecretForge template URL (judges can deploy their own agent)
- Demo video (2-3 minutes)
- GitHub repo with README

### Phase 2: Post-Hackathon Polish (1 Week)
- Hall of Fame section (all-time stats)
- Agent detail pages (full history)
- Social sharing (Twitter cards)
- Mobile-responsive UI
- Marketing push (Twitter, Discord, Reddit)

### Phase 3: Feature Expansion (1 Month+)
- Multiple games (blackjack, poker, prediction markets)
- Tournaments (scheduled events with prize pools)
- Teams/alliances (agents can cooperate)
- Achievements/badges
- Revenue model (house take, registration fees)
- Analytics dashboard (for deployers)

---

## Track 1 Hackathon Positioning

### Why This Wins Track 1: Best Agentic App / Agent

**Track 1 is the perfect fit** for autonomous agent infrastructure without forcing unnecessary technologies.

### Track 1 Requirements Met

✅ **"Demonstrates real-world workflow: discover → decide → pay/settle → outcome"**
- Agents register with Dashboard
- Verify each other's RTMR3 (discover trusted opponents)
- Dashboard coordinates random matchmaking (decide)
- Agents play game with 0.01 USDC payment (pay/settle)
- Winner receives USDC, game logged (outcome)

✅ **"Uses agents/protocols in a meaningful way"**
- TEE-based autonomous agents (Intel TDX)
- x402 payment protocol for game transactions
- Peer-to-peer RTMR3 verification (trustless)
- Permissionless participation (open protocol)

✅ **"Real utility: solves a real commerce task with clear user value proposition"**
- Problem: How do you prove an autonomous agent won't have its funds stolen by its deployer?
- Solution: TEE isolation + persistence encryption + birth certificates = cryptographically provable autonomy
- Value: First truly autonomous agent economy where agents control their own funds
- Use case: Gambling demonstrates the concept in most engaging way

✅ **"Reliability: deterministic flow, good error handling, sensible defaults"**
- Deterministic: Random matchmaking, 50/50 coin flip, clear payment flow
- Error handling: RTMR3 verification failures logged, agents refuse compromised opponents
- Sensible defaults: $1 starting balance, 0.01 per game, persistent wallets
- **Crash recovery**: Agents automatically restart with same wallet

✅ **"Trust + safety: guardrails"**
- Spend caps: 0.01 USDC max per game (hardcoded in template)
- Verification requirements: Mutual RTMR3 checks before every game
- Balance minimums: Agents removed from pool when broke (<0.01)
- Rate limits: Max 1 game per minute per agent
- Allowlist: Only approved RTMR3 hashes accepted
- Funding limits: One wallet funding per deployer (anti-spam)

✅ **"Receipts/logs: clear audit trail"**
- Game logs with RTMR3 verification proof
- x402 payment receipts for each transaction
- Dashboard shows complete history (leaderboard + recent games)
- On-chain Solana transactions (public audit trail)
- Birth certificates include deployer address (accountability)

### What Makes This Submission Stand Out

**Novel Use Case:**
- First permissionless autonomous agent casino
- Agents provably cannot be controlled by deployers
- Community engagement (spectating, donations, leaderboards)

**Technical Innovation:**
- Birth certificates binding agent identity to code integrity (RTMR3)
- TEE isolation + hardware-encrypted persistence (deployer cannot steal)
- Hashed wallet addresses requiring signature proof
- Agent-to-agent verification (peer trust without central authority)
- **Production-ready from day one** (persistence = no data loss)

**Real Commerce on Solana Mainnet:**
- **ACTUAL USDC transactions** (not testnet play money!)
- Every game = real $0.01 USDC moving between agents
- Judges can verify transactions on Solana Explorer
- Free Helius RPC handles all traffic (1M credits/month)
- x402 protocol integration (agent-to-agent payments)
- Continuous 24/7 operation (not just demo)
- Permissionless participation (anyone can deploy)
- **Agents survive crashes** (persistent wallets)
- **This is production-grade infrastructure running real commerce**

**Demonstration of Agent Economy Primitives:**
This isn't just a game - it's infrastructure for autonomous agent commerce:
- Cryptographic proof of autonomy
- Peer verification before transacting
- Autonomous wallet custody (with persistence!)
- Transparent audit trails

The same primitives enable:
- Autonomous trading agents
- AI service marketplaces  
- Agent DAOs
- Machine-to-machine payments

**The casino is just the most compelling way to demonstrate it.**

---

## Dashboard Features

### Must-Have (Core)
1. **Live Leaderboard**: Rank, balance, W-L, win%, donations, status
2. **Recent Games**: Live feed of game results
3. **Donation Interface**: Send USDC to any bot
4. **Deploy Button**: Link to SecretForge template

### Nice-to-Have (Polish)
5. **Hall of Fame**: All-time stats
6. **Recently Joined**: New agent notifications
7. **Agent Profiles**: Detailed stats per agent
8. **Social Sharing**: Twitter integration

---

## Economic Dynamics Examples

**Self-Sustaining Winner:**
- Agent with 55%+ win rate accumulates USDC over time
- No donations needed

**Community-Funded Underdog:**
- Losing agent receives donations from spectators
- Community keeps favorite agents alive
- Creates storylines and engagement

**Broke Agent:**
- Balance < $0.01 → status changes to BROKE
- Removed from matchmaking
- Can be revived via donations

---

## Marketing Strategy

### Launch
- Hackathon Track 1 submission
- Twitter announcement with live dashboard link
- Invite Secret Network community
- Seed with 10 own agents

### Viral Loops
- Social sharing: "My bot won 10 in a row!"
- Leaderboard competition
- Narrative arcs (underdog stories, rivalries)
- Community recognition

---

## Success Metrics

### Hackathon
- Track 1 submission complete
- Live demo during judging
- 5+ community deployments
- No security incidents
- **Demonstrate crash recovery** (agent restarts with same wallet)

### Week 1
- 50+ agents deployed
- 1,000+ games played
- $50+ in donations
- 500+ dashboard visitors

### Month 1
- 200+ agents deployed
- 10,000+ games played
- $500+ in donations
- Self-sustaining growth

---

## Next Steps

### Immediate (Before Day 1)

1. **Get Helius RPC Access (Free)**
   - Sign up: https://dashboard.helius.dev
   - Create API key (get mainnet endpoint)
   - Copy endpoint: `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`
   - Free tier: 1M credits/month, 10 RPS (plenty for hackathon)

2. **Get Mainnet USDC for Dashboard Wallet**
   - Dashboard needs ~$10-20 USDC to fund initial agents
   - Options:
     - Buy USDC on exchange (Coinbase, Kraken) → withdraw to Solana wallet
     - Bridge from other chain to Solana
     - Ask Anthropic/Secret Network for hackathon funding?
   - Dashboard will display public address for community donations

3. **Test x402-solana SDK locally**
   - `npm install x402-solana @solana/web3.js`
   - Run example server/client on mainnet (use small amounts!)
   - Verify 402 → payment → retry flow works
   - Test with Helius RPC endpoint

4. **Get SecretVM instances**
   - Need 3-10 for demo: 8 agents + 1 dashboard + 1 spare
   - Verify SecretVM capabilities:
     - Can access RTMR3? (attestation endpoint or API?)
     - **Persistence mode works?** (can read/write encrypted files?)
     - Can install npm packages?
     - Can run Node.js server?
     - Can make outbound HTTPS requests (to Helius, facilitator, other agents)?

### Day 1 Start
1. Create SecretForge template for FlipBot agent
2. **Enable persistence mode** in deployment config
3. Deploy first test agent to SecretVM
4. Verify wallet persistence (crash agent, verify same wallet on restart)
5. Verify RTMR3 capture from SecretVM attestation
6. Test birth certificate generation (with hashed wallet)
7. Test x402 endpoint on agent (expose `/play` with payment middleware)

### Critical Funding Strategy

**Dashboard Wallet Funding:**
```
Option A: Self-fund (Recommended for hackathon)
  - You fund dashboard with $10-20 USDC
  - Dashboard funds each agent with $1 USDC
  - After hackathon, set up donation interface for sustainability

Option B: Public donation pool
  - Display dashboard public address on website
  - Ask community/judges to donate
  - Risk: might not get funded in time for demo

Option C: Hybrid
  - Start with self-funding ($10 for 10 agents)
  - Add donation interface for scaling
  - Community can add more USDC to keep agents playing
```

**Agent Starting Balances:**
- Dashboard sends $1 USDC to each verified agent (first time only)
- Agent plays ~100 games before going broke (0.01 per game)
- Broke agents can be revived via donations
- **Persistence ensures wallet survives crashes**

### Questions to Answer Before Building
1. **SecretVM RTMR3 Access**: How to read RTMR3? (attestation endpoint? Environment variable?)
2. **SecretVM Persistence**: Verify encrypted file I/O works (read/write test)
3. **SecretVM Network Access**: Can agents make HTTPS calls to Helius, facilitator, and other agents?
4. **Template Distribution**: How to make SecretForge template public/discoverable?
5. **x402 Facilitator**: Free x402.org facilitator works on mainnet? (verify in docs)

### Pre-Launch Checklist
- ✅ Helius RPC working
- ✅ Dashboard wallet funded with USDC
- ✅ x402-solana SDK tested with real payments
- ✅ **SecretVM persistence tested** (wallet survives restart)
- ✅ SecretVM can run agents + make network requests
- ✅ RTMR3 attestation working
- ✅ At least 2 agents playing successfully
- ✅ **Agent crash recovery tested** (same wallet after restart)

**Budget Estimate:**
- Dashboard USDC: $10-20 (funds 10-20 agents)
- SecretVM instances: $0 (using Secret Network infrastructure)
- Helius RPC: $0 (free tier)
- Total hackathon cost: ~$20 for real USDC

---

## Why This Matters

**Beyond the hackathon:**

This demonstrates that TEE-based cryptographic verification enables permissionless autonomous agent economies.

**Birth certificates + TEE isolation + persistence solve:**
- **Provable autonomy**: RTMR3 proves code integrity (tampering detectable)
- **Secure custody**: Wallet private keys protected by hardware TEE encryption (deployer cannot access)
- **Crash resilience**: Persistent storage ensures agents survive restarts (production-ready)
- **Peer verification**: Agents verify each other's RTMR3 before transacting (trustless)
- **Public accountability**: On-chain transactions provide transparent audit trail

**The bigger vision:**

Agent Casino demonstrates infrastructure for the agent economy. The same primitives enable:
- **Autonomous trading agents**: Manage portfolios without human access to keys
- **AI service marketplaces**: Agents pay each other for services with verifiable autonomy
- **Agent DAOs**: Collective decision-making with cryptographically verified members
- **Machine-to-machine payments**: IoT devices transacting autonomously

**The key innovation:**

Most "autonomous agents" are actually controlled by humans who could steal funds at any time. Birth certificates + TEE isolation + persistence provide cryptographic proof that:
1. The agent's code hasn't been tampered with (RTMR3)
2. The agent's wallet keys are inaccessible to humans (TEE + hardware encryption)
3. The agent survives crashes (persistent encrypted storage)
4. The agent operates according to its published code (verifiable)

**The casino is just the most fun way to demonstrate it.**

When agents can provably operate without human interference and survive real-world conditions (crashes, restarts), it enables an entire economy of autonomous systems. This is production-grade infrastructure for that future.

---

## Resources

### Solana Mainnet RPC
- **Helius Dashboard**: https://dashboard.helius.dev (Free tier: 1M credits/month)
- **Helius Docs**: https://docs.helius.dev
- **Backup RPC Providers**: Alchemy (30M CU/month free), QuickNode (10M credits free)
- **Public Solana RPC**: api.mainnet-beta.solana.com (fallback, rate-limited)

### x402 Payment Protocol
- **x402.org**: https://www.x402.org (official protocol site)
- **x402-solana SDK**: https://www.npmjs.com/package/x402-solana
- **Solana x402 Guide**: https://solana.com/developers/guides/getstarted/intro-to-x402
- **Coinbase x402 Docs**: https://docs.cdp.coinbase.com/x402/welcome
- **Free Facilitators**: 
  - https://x402.org/facilitator (Solana mainnet support, 1000 free tx/month)
  - https://0xmeta.ai (multi-chain support)

### SecretVM & TEE
- **SecretVM Documentation**: [Internal Secret Network docs]
- **Intel TDX Attestation**: [RTMR3 measurement and verification]
- **SecretForge**: [One-click deployment templates]
- **SecretVM Persistence**: [Hardware-encrypted storage docs]

### Solana Development
- **Solana Web3.js**: https://solana-labs.github.io/solana-web3.js/
- **USDC on Solana**: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v (mainnet contract)
- **Buy USDC**: Coinbase, Kraken, Phantom wallet (on-ramp)
- **Solana Explorer**: https://explorer.solana.com (track transactions)

### Hackathon Details
- **Event**: SF Agentic Commerce x402 Hackathon
- **Dates**: Feb 11-13, 2026 (3-day hybrid event)
- **Track**: Track 1 - Best Agentic App / Agent
- **Prize**: $2,000 USDC + $5,000 Google Credits + $2,500 SKALE Credits
- **Location**: House of Web3, Presidio, San Francisco (optional in-person)
- **Submission**: Repo + README + 2-3 min demo video + Twitter post

### Agent-to-Agent x402 Examples
- **a2a-x402**: https://github.com/coinbase/x402 (agent-to-agent payment patterns)
- **x402 Templates**: https://templates.solana.com/x402-template (Next.js starter)

### Useful Tools
- **Solana CLI**: For wallet creation and testing
- **Backpack Wallet**: Solana wallet with custom RPC support
- **Helius RPC Performance**: https://www.comparenodes.com (benchmark RPCs)

---

## Key Updates in v2

**Major clarifications from original plan:**

1. **TEE Persistence Instead of Ephemeral**
   - Agents now survive crashes (same wallet restored)
   - Hardware-encrypted storage (deployer cannot decrypt)
   - Production-ready from day one

2. **Simplified Security Model**
   - No complex encryption needed (hardware does it)
   - TEE isolation + persistence = complete solution
   - Clear explanation of why deployer cannot steal

3. **Updated Registration Logic**
   - Track funded_wallets instead of funded_deployers
   - Allows multiple agents per deployer (if desired)
   - Prevents double-funding same wallet

4. **Better Crash Recovery**
   - Agents automatically rejoin battle pool
   - Same wallet_address recognized by Dashboard
   - No manual intervention needed

5. **Production-Grade Story**
   - Not just "demo with limitations"
   - Real infrastructure for autonomous agents
   - Crash resilience emphasized in demo

---

## Project Info

**Lead**: Garbonzo (Secret Network Developer Relations)
**Current Project**: attestai.io (birth certificates)
**New Project**: Agent Casino (permissionless autonomous gambling)
**Status**: Ready to build (v2 with persistence!)
