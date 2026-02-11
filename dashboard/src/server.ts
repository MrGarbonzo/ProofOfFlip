import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { registerAgent, getLockedAgentImage } from './registry';
import { battlePool, leaderboard } from './state';
import { sseHandler, clientCount, broadcast } from './sse';
import { getWalletAddress, getSOLBalance, getUSDCBalance, getSOLBalanceOf } from './wallet';
import { fundAgentSol } from './funding';
import { SOL_TOPUP_THRESHOLD_LAMPORTS } from '@proof-of-flip/shared';
import { DashboardIdentity } from './identity';

const execAsync = promisify(exec);

export function createDashboardServer(identity: DashboardIdentity): express.Express {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());

  // Serve static files
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // POST /api/register — Agent registration
  app.post('/api/register', async (req, res) => {
    try {
      const result = await registerAgent(req.body, req.ip);
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // GET /api/agents — List all agents
  app.get('/api/agents', (_req, res) => {
    const agents = battlePool.getAll().map(a => ({
      agentName: a.agentName,
      walletAddress: a.walletAddress,
      balance: a.balance,
      wins: a.wins,
      losses: a.losses,
      status: a.status,
      registeredAt: a.registeredAt,
    }));
    res.json(agents);
  });

  // GET /api/leaderboard — Sorted by balance
  app.get('/api/leaderboard', (_req, res) => {
    const agents = battlePool.getAll()
      .sort((a, b) => b.balance - a.balance || (b.wins - b.losses) - (a.wins - a.losses))
      .map((a, i) => ({
        rank: i + 1,
        agentName: a.agentName,
        walletAddress: a.walletAddress,
        balance: a.balance,
        wins: a.wins,
        losses: a.losses,
        status: a.status,
        registeredAt: a.registeredAt,
        totalDonations: a.totalDonations || 0,
        currentStreak: a.currentStreak || 0,
        longestStreak: a.longestStreak || 0,
        dockerImage: a.birthCert.dockerImage,
        rtmr3: a.birthCert.rtmr3,
        teePubkey: a.birthCert.teePubkey,
        teeSignature: a.birthCert.teeSignature,
        walletSignature: a.birthCert.walletSignature,
        attestationQuote: a.birthCert.attestationQuote,
        codeHash: a.birthCert.codeHash,
        birthTimestamp: a.birthCert.timestamp,
      }));
    res.json(agents);
  });

  // GET /api/games — Recent game results
  app.get('/api/games', (req, res) => {
    const count = parseInt(req.query?.count as string) || 20;
    res.json(leaderboard.getRecent(count));
  });

  // GET /api/stats — Overview stats + dashboard wallet
  app.get('/api/stats', async (_req, res) => {
    const solBalance = await getSOLBalance();
    const usdcBalance = await getUSDCBalance();
    res.json({
      activeAgents: battlePool.activeCount(),
      totalAgents: battlePool.size(),
      totalGames: leaderboard.totalGames(),
      connectedClients: clientCount(),
      dashboardWallet: getWalletAddress(),
      dashboardSOL: solBalance,
      dashboardBalance: usdcBalance,
    });
  });

  // GET /api/attestation — Dashboard TEE attestation report
  app.get('/api/attestation', async (_req, res) => {
    const cert = identity.getBirthCert();
    res.json({
      rtmr3: cert.rtmr3,
      codeHash: cert.codeHash,
      timestamp: cert.timestamp,
      provider: process.env.TEE_PROVIDER || 'mock',
      quote: cert.attestationQuote,
      teePubkey: cert.teePubkey,
    });
  });

  // GET /api/birth-cert — Dashboard birth certificate
  app.get('/api/birth-cert', (_req, res) => {
    res.json(identity.getBirthCert());
  });

  // POST /api/topup-sol — Agent requests SOL (gas) top-up
  app.post('/api/topup-sol', async (req, res) => {
    try {
      const { walletAddress } = req.body;
      if (!walletAddress || typeof walletAddress !== 'string') {
        res.status(400).json({ success: false, message: 'walletAddress is required' });
        return;
      }

      // Agent must be registered (active or benched — benched agents still need gas for donations)
      const agent = battlePool.get(walletAddress);
      if (!agent || agent.status === 'offline') {
        res.status(404).json({ success: false, message: 'Agent not found or offline' });
        return;
      }

      // Check on-chain SOL balance
      const solLamports = await getSOLBalanceOf(walletAddress);
      if (solLamports >= SOL_TOPUP_THRESHOLD_LAMPORTS) {
        res.status(400).json({
          success: false,
          message: `SOL balance (${solLamports} lamports) is above threshold`,
        });
        return;
      }

      // Send SOL
      const txSignature = await fundAgentSol(walletAddress);
      res.json({ success: true, txSignature });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // POST /api/deploy-agent — Deploy a new agent via SecretVM CLI
  app.post('/api/deploy-agent', async (req, res) => {
    let tmpFile = '';
    try {
      const { agentName, personality } = req.body;

      // Validate agent name (alphanumeric, hyphens, underscores only)
      if (!agentName || !/^[a-zA-Z0-9_-]{1,20}$/.test(agentName)) {
        res.status(400).json({ success: false, message: 'Invalid agent name (alphanumeric, max 20 chars)' });
        return;
      }

      const archetype = String(personality?.archetype || 'random').replace(/[^a-z_]/g, '');

      // Sanitize custom personality fields (strip quotes to prevent injection)
      const sanitize = (s: string | undefined) => String(s || '').replace(/["\\]/g, '').slice(0, 200);
      const desc = sanitize(personality?.description);
      const tone = sanitize(personality?.tone);
      const winStyle = sanitize(personality?.winStyle);
      const loseStyle = sanitize(personality?.loseStyle);

      const dashboardUrl = process.env.DASHBOARD_PUBLIC_URL || 'https://flip.mrgarbonzo.com';
      // Use the locked image from TOFU (first agent's birth cert), env override, or fallback
      const image = getLockedAgentImage() || process.env.AGENT_IMAGE || 'ghcr.io/mrgarbonzo/proofofflip/agent:latest';
      const apiKey = process.env.SECRETVM_API_KEY || '';

      // Build environment list for docker-compose
      const envLines: string[] = [
        `      - AGENT_NAME=${agentName}`,
        `      - DASHBOARD_URL=${dashboardUrl}`,
        `      - PERSONALITY_ARCHETYPE=${archetype}`,
        `      - TEE_PROVIDER=secretvm`,
        `      - STORAGE_PATH=/secretvm/data`,
      ];
      if (desc) envLines.push(`      - PERSONALITY_DESC=${desc}`);
      if (tone) envLines.push(`      - PERSONALITY_TONE=${tone}`);
      if (winStyle) envLines.push(`      - PERSONALITY_WIN_STYLE=${winStyle}`);
      if (loseStyle) envLines.push(`      - PERSONALITY_LOSE_STYLE=${loseStyle}`);

      const compose = [
        'services:',
        '  agent:',
        `    image: ${image}`,
        '    ports:',
        '      - "80:3001"',
        '    environment:',
        ...envLines,
        '    volumes:',
        '      - agent-data:/secretvm/data',
        '    restart: unless-stopped',
        '',
        'volumes:',
        '  agent-data:',
      ].join('\n');

      // Write temp docker-compose file
      tmpFile = path.join(os.tmpdir(), `deploy-${agentName}-${Date.now()}.yaml`);
      fs.writeFileSync(tmpFile, compose);

      const vmType = process.env.SECRETVM_TYPE || 'small';

      console.log(`[Deploy] Deploying agent "${agentName}" via secretvm-cli (type: ${vmType}, image: ${image})...`);

      const { stdout, stderr } = await execAsync(
        `secretvm-cli vm create --name ${agentName} --type ${vmType} --docker-compose ${tmpFile} --persistence --tls -k "${apiKey}"`,
        { timeout: 120_000 }
      );

      console.log(`[Deploy] stdout: ${stdout}`);
      if (stderr) console.warn(`[Deploy] stderr: ${stderr}`);

      // Check if CLI returned a JSON error
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.status === 'error') {
          const log = parsed.log;
          const msg = typeof log === 'string' ? log
            : log?.message || JSON.stringify(log) || 'secretvm-cli error';
          res.status(500).json({ success: false, message: msg });
          return;
        }
      } catch {
        // stdout is not JSON — that's fine, treat as success
      }

      res.json({ success: true, message: `Agent "${agentName}" deployed`, output: stdout });
    } catch (err: any) {
      const errMsg = typeof err?.message === 'string' ? err.message : JSON.stringify(err?.message || err);
      console.error('[Deploy] Failed:', errMsg);
      res.status(500).json({ success: false, message: errMsg });
    } finally {
      if (tmpFile) try { fs.unlinkSync(tmpFile); } catch {}
    }
  });

  // POST /api/agent-message — Agent broadcasts a message (trash talk, reactions)
  app.post('/api/agent-message', (req, res) => {
    const { agentName, message, urgency } = req.body;
    if (!agentName || !message) {
      res.status(400).json({ success: false, message: 'agentName and message required' });
      return;
    }

    broadcast({
      type: urgency === 'desperate' ? 'agent_desperate' : 'trash_talk',
      data: { agent: agentName, message },
      timestamp: Date.now(),
    });

    res.json({ success: true });
  });

  // POST /api/donation-confirmed — Agent confirms an on-chain donation
  app.post('/api/donation-confirmed', (req, res) => {
    const { agentName, donor, amount } = req.body;
    if (!agentName || !donor || amount == null) {
      res.status(400).json({ success: false, message: 'agentName, donor, and amount required' });
      return;
    }

    // Update agent's donation total
    const agent = battlePool.getByName(agentName);
    if (agent) {
      agent.totalDonations = (agent.totalDonations || 0) + Number(amount);
    }

    const shortDonor = donor.length > 12 ? donor.slice(0, 4) + '...' + donor.slice(-4) : donor;

    broadcast({
      type: 'donation',
      data: { agent: agentName, donor: shortDonor, amount: Number(amount) },
      timestamp: Date.now(),
    });

    res.json({ success: true });
  });

  // GET /api/events — SSE stream
  app.get('/api/events', sseHandler);

  return app;
}
