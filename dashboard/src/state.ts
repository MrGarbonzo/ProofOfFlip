import { AgentInfo, GameResult, MIN_BALANCE_TO_PLAY, MAX_ACTIVE_AGENTS } from '@proof-of-flip/shared';

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

  markOffline(walletAddress: string): AgentInfo | undefined {
    const agent = this.agents.get(walletAddress);
    if (agent) {
      agent.status = 'offline';
    }
    return agent;
  }

  /**
   * Re-rank agents: top N by balance are 'active', rest are 'benched' or 'broke'.
   * Returns arrays of newly promoted and newly benched agents for event broadcasting.
   */
  reRank(): { promoted: AgentInfo[]; benched: AgentInfo[] } {
    const promoted: AgentInfo[] = [];
    const benched: AgentInfo[] = [];

    // Only consider non-offline agents
    const eligible = Array.from(this.agents.values())
      .filter(a => a.status !== 'offline' && a.status !== 'deleted');

    // Sort by balance descending
    eligible.sort((a, b) => b.balance - a.balance);

    for (let i = 0; i < eligible.length; i++) {
      const agent = eligible[i];

      if (agent.balance < MIN_BALANCE_TO_PLAY) {
        // Broke — can't play regardless of rank
        if (agent.status !== 'broke') {
          agent.status = 'broke';
          benched.push(agent);
        }
      } else if (i < MAX_ACTIVE_AGENTS) {
        // Top N — active
        if (agent.status !== 'active') {
          const wasBenched = agent.status === 'benched' || agent.status === 'broke';
          agent.status = 'active';
          if (wasBenched) promoted.push(agent);
        }
      } else {
        // Outside top N — benched
        if (agent.status !== 'benched') {
          agent.status = 'benched';
          benched.push(agent);
        }
      }
    }

    return { promoted, benched };
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
