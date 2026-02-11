import {
  GameCommand,
  GameResult,
  AgentInfo,
  GAME_STAKE,
  MATCH_INTERVAL_MS,
} from '@proof-of-flip/shared';
import { battlePool, leaderboard } from './state';
import { broadcast } from './sse';
import { randomBytes } from 'crypto';

function generateGameId(): string {
  return randomBytes(16).toString('hex');
}

async function postToAgent(endpoint: string, path: string, body: any): Promise<any> {
  try {
    const res = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err: any) {
    console.error(`Failed to POST ${endpoint}${path}:`, err.message);
    return null;
  }
}

async function runGame(agentA: AgentInfo, agentB: AgentInfo): Promise<void> {
  const gameId = generateGameId();

  // Flip coin
  const coinFlip = randomBytes(1)[0] % 2 === 0;
  const winner = coinFlip ? agentA : agentB;
  const loser = coinFlip ? agentB : agentA;

  console.log(`[Coordinator] Game ${gameId}: ${winner.agentName} vs ${loser.agentName} → ${winner.agentName} wins!`);

  const timestamp = Date.now();

  // Randomly pick who talks first — the other responds via ChatListener
  const winnerTalksFirst = randomBytes(1)[0] % 2 === 0;

  // Notify winner first (so they're ready to receive payment)
  const winnerCommand: GameCommand = {
    gameId,
    role: 'winner',
    opponentName: loser.agentName,
    opponentEndpoint: loser.endpoint,
    opponentWallet: loser.walletAddress,
    stakeAmount: GAME_STAKE,
    timestamp,
    talkFirst: winnerTalksFirst,
  };
  await postToAgent(winner.endpoint, '/play', winnerCommand);

  // Notify loser (they will initiate payment)
  const loserCommand: GameCommand = {
    gameId,
    role: 'loser',
    opponentName: winner.agentName,
    opponentEndpoint: winner.endpoint,
    opponentWallet: winner.walletAddress,
    stakeAmount: GAME_STAKE,
    timestamp,
    talkFirst: !winnerTalksFirst,
  };
  const loserResponse = await postToAgent(loser.endpoint, '/play', loserCommand);

  // Record result
  const result: GameResult = {
    gameId,
    winner: winner.agentName,
    loser: loser.agentName,
    winnerWallet: winner.walletAddress,
    loserWallet: loser.walletAddress,
    stakeAmount: GAME_STAKE,
    txSignature: loserResponse?.txSignature,
    timestamp,
  };

  leaderboard.addResult(result);

  // Update agent stats
  winner.wins++;
  winner.balance += GAME_STAKE;
  loser.losses++;
  loser.balance -= GAME_STAKE;

  // Track win/loss streaks (positive = wins, negative = losses)
  const ws = winner.currentStreak || 0;
  winner.currentStreak = ws > 0 ? ws + 1 : 1;
  if (winner.currentStreak > (winner.longestStreak || 0)) {
    winner.longestStreak = winner.currentStreak;
  }
  const ls = loser.currentStreak || 0;
  loser.currentStreak = ls < 0 ? ls - 1 : -1;

  // Re-rank: promotes/demotes agents based on new balances
  const { promoted, benched } = battlePool.reRank();

  for (const agent of benched) {
    console.log(`[Coordinator] ${agent.agentName} has been benched (${agent.status})`);
    broadcast({
      type: 'agent_evicted',
      data: agent,
      timestamp: Date.now(),
    });
  }

  for (const agent of promoted) {
    console.log(`[Coordinator] ${agent.agentName} promoted to active!`);
    broadcast({
      type: 'agent_joined',
      data: agent,
      timestamp: Date.now(),
    });
  }

  // Broadcast result
  broadcast({
    type: 'game_result',
    data: result,
    timestamp: Date.now(),
  });
}

let intervalId: NodeJS.Timeout | null = null;

export function startCoordinator(): void {
  console.log(`[Coordinator] Starting match loop (interval: ${MATCH_INTERVAL_MS / 1000}s)`);

  // Initial rank on startup
  battlePool.reRank();

  intervalId = setInterval(async () => {
    // Re-rank before picking (donations may have changed balances)
    battlePool.reRank();

    const pair = battlePool.pickRandomPair();
    if (!pair) {
      console.log('[Coordinator] Not enough active agents for a game');
      return;
    }

    try {
      await runGame(pair[0], pair[1]);
    } catch (err: any) {
      console.error('[Coordinator] Game error:', err.message);
    }
  }, MATCH_INTERVAL_MS);
}

export function stopCoordinator(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
