import { AgentInfo, GameResult } from '@proof-of-flip/shared';

export class BattlePool {
  private agents: Map<string, AgentInfo> = new Map();

  add(agent: AgentInfo): void {
    this.agents.set(agent.walletAddress, agent);
  }

  remove(walletAddress: string): void {
    this.agents.delete(walletAddress);
  }

  get(walletAddress: string): AgentInfo | undefined {
    return this.agents.get(walletAddress);
  }

  getByName(name: string): AgentInfo | undefined {
    for (const agent of this.agents.values()) {
      if (agent.agentName === name) return agent;
    }
    return undefined;
  }

  getActive(): AgentInfo[] {
    return Array.from(this.agents.values()).filter(a => a.status === 'active');
  }

  getAll(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  pickRandomPair(): [AgentInfo, AgentInfo] | null {
    const active = this.getActive();
    if (active.length < 2) return null;

    const i = Math.floor(Math.random() * active.length);
    let j = Math.floor(Math.random() * (active.length - 1));
    if (j >= i) j++;

    return [active[i], active[j]];
  }

  size(): number {
    return this.agents.size;
  }

  activeCount(): number {
    return this.getActive().length;
  }
}

export class FundedWallets {
  private funded: Set<string> = new Set();

  add(walletAddress: string): void {
    this.funded.add(walletAddress);
  }

  has(walletAddress: string): boolean {
    return this.funded.has(walletAddress);
  }
}

export class Leaderboard {
  private games: GameResult[] = [];

  addResult(result: GameResult): void {
    this.games.push(result);
  }

  getRecent(count: number = 20): GameResult[] {
    return this.games.slice(-count).reverse();
  }

  totalGames(): number {
    return this.games.length;
  }
}

// Singleton state
export const battlePool = new BattlePool();
export const fundedWallets = new FundedWallets();
export const leaderboard = new Leaderboard();
