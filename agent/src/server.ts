import express from 'express';
import { FlipBotAgent } from './agent';
import { GameService } from './game-service';
import {
  GameCommand,
  HealthResponse,
  AttestationReport,
  createTEEProvider,
  GAME_STAKE_LAMPORTS,
  USDC_MINT,
  DASHBOARD_URL,
} from '@proof-of-flip/shared';

// Shared set of game tx signatures — donation monitor uses this to skip game payments
export const gameTxSignatures: Set<string> = new Set();

export function createServer(agent: FlipBotAgent): express.Express {
  const app = express();
  app.use(express.json());

  const tee = createTEEProvider(
    process.env.TEE_PROVIDER || 'mock',
    agent.name
  );

  let gameService: GameService | null = null;

  function getGameService(): GameService {
    if (!gameService) {
      gameService = new GameService(agent.secretKey);
    }
    return gameService;
  }

  // Fire-and-forget message broadcast to dashboard
  function broadcastMessage(message: string, urgency: string = 'normal'): void {
    fetch(`${DASHBOARD_URL}/api/agent-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: agent.name, message, urgency }),
    }).catch(err => console.error('[Broadcast] Failed:', err.message));
  }

  // GET /health
  app.get('/health', (_req, res) => {
    const response: HealthResponse = {
      agentName: agent.name,
      status: 'ok',
      uptime: agent.getUptime(),
      walletAddress: agent.walletAddress,
    };
    res.json(response);
  });

  // GET /birth-cert
  app.get('/birth-cert', (_req, res) => {
    res.json(agent.getBirthCert());
  });

  // GET /attestation — returns attestation report with quote + TEE pubkey
  app.get('/attestation', async (_req, res) => {
    try {
      const attestation = await tee.getSelfAttestation();
      const report: AttestationReport = {
        rtmr3: attestation.rtmr3,
        codeHash: agent.getBirthCert().codeHash,
        timestamp: Date.now(),
        provider: (process.env.TEE_PROVIDER || 'mock') as 'mock' | 'secretvm',
        quote: await tee.getAttestationQuote(),
        teePubkey: await tee.getTeePubkey(),
      };
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: 'Attestation failed' });
    }
  });

  // GET /collect — x402-protected endpoint (winner receives payment here)
  // Returns 402 with payment requirements, or 200 if valid payment header
  app.get('/collect', (req, res) => {
    const paymentHeader = req.headers['x-payment'];

    if (!paymentHeader) {
      // Return 402 with payment requirements
      res.status(402).json({
        type: 'x402',
        version: '1',
        address: agent.walletAddress,
        token: USDC_MINT.toBase58(),
        amount: GAME_STAKE_LAMPORTS,
        network: 'solana-mainnet',
        description: `Payment to ${agent.name} for coin flip game`,
      });
      return;
    }

    // Verify payment header
    try {
      const payment = typeof paymentHeader === 'string'
        ? JSON.parse(paymentHeader)
        : paymentHeader;

      console.log(`[${agent.name}] Received payment:`, payment);
      if (payment.txSignature) gameTxSignatures.add(payment.txSignature);

      res.json({
        status: 'collected',
        agent: agent.name,
        txSignature: payment.txSignature,
      });
    } catch {
      res.status(400).json({ error: 'Invalid payment header' });
    }
  });

  // POST /play — Dashboard sends game command
  app.post('/play', async (req, res) => {
    const command: GameCommand = req.body;
    const opponentName = command.opponentName || 'opponent';
    console.log(`[${agent.name}] Game ${command.gameId}: I am the ${command.role}`);

    if (command.role === 'winner') {
      // Winner: just acknowledge — the loser will pay us via /collect
      console.log(`[${agent.name}] Won! Waiting for payment from ${command.opponentEndpoint}`);
      res.json({ status: 'acknowledged', role: 'winner', gameId: command.gameId });

      // Track game
      agent.recentGames.push({ opponent: opponentName, won: true });
      if (agent.recentGames.length > 20) agent.recentGames.shift();

      // Only post if talkFirst — other agent responds via ChatListener
      if (command.talkFirst) {
        const delay = 1000 + Math.random() * 3000; // 1-4s random delay
        setTimeout(() => {
          agent.personality.generateMessage({
            timing: 'post_win',
            opponent: opponentName,
            amount: command.stakeAmount,
            balance: command.stakeAmount,
            recentGames: agent.recentGames,
          }).then(msg => broadcastMessage(msg));
        }, delay);
      }
    } else {
      // Loser: initiate payment to winner's /collect endpoint
      console.log(`[${agent.name}] Lost! Paying ${command.opponentWallet}...`);

      // Track game
      agent.recentGames.push({ opponent: opponentName, won: false });
      if (agent.recentGames.length > 20) agent.recentGames.shift();

      // Only post if talkFirst — other agent responds via ChatListener
      if (command.talkFirst) {
        const delay = 1000 + Math.random() * 3000; // 1-4s random delay
        setTimeout(() => {
          agent.personality.generateMessage({
            timing: 'post_loss',
            opponent: opponentName,
            amount: command.stakeAmount,
            balance: 0,
            recentGames: agent.recentGames,
          }).then(msg => broadcastMessage(msg));
        }, delay);
      }

      try {
        const gs = getGameService();
        const txSignature = await gs.payWinner(
          command.opponentEndpoint,
          command.opponentWallet
        );
        console.log(`[${agent.name}] Payment sent: ${txSignature}`);
        gameTxSignatures.add(txSignature);
        res.json({
          status: 'paid',
          role: 'loser',
          gameId: command.gameId,
          txSignature,
        });
      } catch (err: any) {
        console.error(`[${agent.name}] Payment failed:`, err.message);
        res.status(500).json({
          status: 'payment_failed',
          role: 'loser',
          gameId: command.gameId,
          error: err.message,
        });
      }
    }
  });

  return app;
}
