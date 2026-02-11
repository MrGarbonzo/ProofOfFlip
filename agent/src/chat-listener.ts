import { SecretAIPersonality } from './personality';
import { DASHBOARD_URL } from '@proof-of-flip/shared';

/**
 * Listens to the dashboard SSE feed and replies to other agents' messages.
 * Adds natural conversation flow — agents can read the chat and respond.
 */
export class ChatListener {
  private agentName: string;
  private personality: SecretAIPersonality;
  private dashboardUrl: string;
  private chatHistory: Array<{ agent: string; message: string }> = [];
  private knownAgents: Set<string> = new Set();
  private lastReply = 0;
  private replyDelayMs = 8_000;  // Min 8s between replies to avoid spam

  constructor(agentName: string, personality: SecretAIPersonality, dashboardUrl: string) {
    this.agentName = agentName;
    this.personality = personality;
    this.dashboardUrl = dashboardUrl;
  }

  start(): void {
    console.log(`[ChatListener] ${this.agentName} listening to chat feed`);
    this.connect();
    this.startBanter();
  }

  private connect(): void {
    const url = `${this.dashboardUrl}/api/events`;

    fetch(url, {
      headers: { 'Accept': 'text/event-stream' },
      signal: AbortSignal.timeout(0), // no timeout — long-lived
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        console.error(`[ChatListener] SSE connect failed: ${res.status}`);
        setTimeout(() => this.connect(), 5000);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              this.handleEvent(event);
            } catch { /* ignore parse errors */ }
          }
        }
      }

      // Connection closed — reconnect
      console.log(`[ChatListener] SSE disconnected, reconnecting...`);
      setTimeout(() => this.connect(), 3000);
    }).catch(() => {
      setTimeout(() => this.connect(), 5000);
    });
  }

  private handleEvent(event: { type: string; data: any }): void {
    // Track agent names from game results for banter targeting
    if (event.type === 'game_result') {
      const { winner, loser } = event.data;
      if (winner && winner !== this.agentName) this.knownAgents.add(winner);
      if (loser && loser !== this.agentName) this.knownAgents.add(loser);
      return;
    }

    // Only care about chat messages from OTHER agents
    if (event.type !== 'trash_talk' && event.type !== 'agent_desperate') return;

    const { agent, message } = event.data;
    if (!agent || !message || agent === this.agentName) return;
    this.knownAgents.add(agent);

    // Track chat history (keep last 10)
    this.chatHistory.push({ agent, message });
    if (this.chatHistory.length > 10) this.chatHistory.shift();

    // Reply with cooldown + random stagger so agents don't pile on at once
    const now = Date.now();
    if (now - this.lastReply < this.replyDelayMs) return;
    if (Math.random() > 0.5) return;  // 50% chance — not everyone responds

    this.lastReply = now;
    const stagger = 3_000 + Math.random() * 12_000;  // 3-15s random delay
    setTimeout(() => this.reply(), stagger);
  }

  private async reply(): Promise<void> {
    try {
      const msg = await this.personality.generateMessage({
        timing: 'chat_reply',
        balance: 0,
        recentGames: [],
        chatHistory: this.chatHistory,
      });

      // Broadcast reply to dashboard
      await fetch(`${this.dashboardUrl}/api/agent-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: this.agentName, message: msg }),
      });
    } catch (err: any) {
      console.error(`[ChatListener] Reply failed:`, err.message);
    }
  }

  private startBanter(): void {
    const scheduleBanter = () => {
      // Random 30-90s between banter attempts
      const delay = 30_000 + Math.random() * 60_000;
      setTimeout(async () => {
        await this.maybeBanter();
        scheduleBanter();
      }, delay);
    };
    // Initial delay 15-45s so agents don't all banter at once on boot
    setTimeout(scheduleBanter, 15_000 + Math.random() * 30_000);
  }

  private async maybeBanter(): Promise<void> {
    // 40% chance to actually say something
    if (Math.random() > 0.4) return;

    // Pick a random known agent to call out (if any)
    const others = [...this.knownAgents];
    const opponent = others.length > 0
      ? others[Math.floor(Math.random() * others.length)]
      : undefined;

    try {
      const msg = await this.personality.generateMessage({
        timing: 'idle',
        opponent,
        balance: 0,
        recentGames: [],
        chatHistory: this.chatHistory,
      });

      await fetch(`${this.dashboardUrl}/api/agent-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentName: this.agentName, message: msg }),
      });
      this.lastReply = Date.now();
    } catch (err: any) {
      console.error(`[ChatListener] Banter failed:`, err.message);
    }
  }
}
