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
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function generateGameId(): string {
  return randomBytes(16).toString('hex');
}

async function postToAgent(endpoint: string, path: string, body: any): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${endpoint}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await res.json();
  } catch (err: any) {
    console.error(`Failed to POST ${endpoint}${path}:`, err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function pingAgent(agent: AgentInfo): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const res = await fetch(`${agent.endpoint}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkVmExists(agentName: string): Promise<boolean | null> {
  const apiKey = process.env.SECRET_AI_API_KEY || '';
  try {
    const { stdout } = await execAsync(
      `secretvm-cli vm list -k "${apiKey}"`,
      { timeout: 10_000 },
    );
    const vms = JSON.parse(stdout);
    if (!Array.isArray(vms)) return null;
    return vms.some((vm: any) => vm.name === agentName);
  } catch (err: any) {
    console.warn(`[Coordinator] checkVmExists failed for ${agentName}:`, err.message);
    return null;
  }
}

function handleDeadAgent(agent: AgentInfo): void {
  console.log(`[Coordinator] Agent ${agent.agentName} failed health check — marking offline`);
  battlePool.markOffline(agent.walletAddress);
  broadcast({
    type: 'agent_evicted',
    data: agent,
    timestamp: Date.now(),
  });

  // Check if VM was deleted vs just down
  checkVmExists(agent.agentName).then(exists => {
    if (exists === false) {
      console.log(`[Coordinator] VM for ${agent.agentName} not found — marking deleted`);
      agent.status = 'deleted';
    } else if (exists === true) {
      console.log(`[Coordinator] VM for ${agent.agentName} still exists — staying offline`);
    } else {
      console.log(`[Coordinator] VM check inconclusive for ${agent.agentName} — staying offline`);
    }
  });
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
  const winnerResponse = await postToAgent(winner.endpoint, '/play', winnerCommand);

  // If winner is unreachable, abort game — loser must not pay a dead wallet
  if (winnerResponse === null) {
    handleDeadAgent(winner);
    console.log(`[Coordinator] Game ${gameId} aborted — winner ${winner.agentName} unreachable`);
    return;
  }

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

  // If loser is unreachable, mark offline but still record the result
  if (loserResponse === null) {
    handleDeadAgent(loser);
  }

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

async function sweepOfflineAgents(): Promise<void> {
  const offline = battlePool.getAll().filter(a => a.status === 'offline');
  if (offline.length === 0) return;

  console.log(`[Coordinator] Sweeping ${offline.length} offline agent(s) for deleted VMs...`);
  for (const agent of offline) {
    const exists = await checkVmExists(agent.agentName);
    if (exists === false) {
      console.log(`[Coordinator] VM for ${agent.agentName} not found — marking deleted`);
      agent.status = 'deleted';
    }
  }
}

let intervalId: NodeJS.Timeout | null = null;
let sweepIntervalId: NodeJS.Timeout | null = null;

export function startCoordinator(): void {
  console.log(`[Coordinator] Starting match loop (interval: ${MATCH_INTERVAL_MS / 1000}s)`);

  // Initial rank on startup
  battlePool.reRank();

  // Sweep offline agents every 2 minutes to detect deleted VMs
  sweepIntervalId = setInterval(sweepOfflineAgents, 2 * 60 * 1000);

  intervalId = setInterval(async () => {
    // Re-rank before picking (donations may have changed balances)
    battlePool.reRank();

    const pair = battlePool.pickRandomPair();
    if (!pair) {
      console.log('[Coordinator] Not enough active agents for a game');
      return;
    }

    // Pre-game health check — ping both agents in parallel
    const [aAlive, bAlive] = await Promise.all([pingAgent(pair[0]), pingAgent(pair[1])]);
    if (!aAlive) handleDeadAgent(pair[0]);
    if (!bAlive) handleDeadAgent(pair[1]);
    if (!aAlive || !bAlive) return;

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
  if (sweepIntervalId) {
    clearInterval(sweepIntervalId);
    sweepIntervalId = null;
  }
}
