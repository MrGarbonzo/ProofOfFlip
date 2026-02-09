import express from 'express';
import path from 'path';
import { registerAgent } from './registry';
import { battlePool, leaderboard } from './state';
import { sseHandler, clientCount } from './sse';
import { getWalletAddress, getUSDCBalance } from './wallet';

export function createDashboardServer(): express.Express {
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
    const balance = await getUSDCBalance();
    res.json({
      activeAgents: battlePool.activeCount(),
      totalAgents: battlePool.size(),
      totalGames: leaderboard.totalGames(),
      connectedClients: clientCount(),
      dashboardWallet: getWalletAddress(),
      dashboardBalance: balance,
    });
  });

  // GET /api/events — SSE stream
  app.get('/api/events', sseHandler);

  return app;
}
