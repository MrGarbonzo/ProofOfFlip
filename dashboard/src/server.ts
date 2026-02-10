import express from 'express';
import path from 'path';
import { registerAgent } from './registry';
import { battlePool, leaderboard } from './state';
import { sseHandler, clientCount } from './sse';
import { getWalletAddress, getSOLBalance, getUSDCBalance, getSOLBalanceOf } from './wallet';
import { fundAgentSol } from './funding';
import { SOL_TOPUP_THRESHOLD_LAMPORTS } from '@proof-of-flip/shared';
import { DashboardIdentity } from './identity';

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

      // Agent must be registered and active
      const agent = battlePool.get(walletAddress);
      if (!agent || agent.status !== 'active') {
        res.status(404).json({ success: false, message: 'Agent not found or not active' });
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

  // GET /api/events — SSE stream
  app.get('/api/events', sseHandler);

  return app;
}
