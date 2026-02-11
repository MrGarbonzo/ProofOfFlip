export interface PersonalityConfig {
  archetype: 'trash_talker' | 'humble' | 'comedian' | 'cocky' | 'desperate' | 'philosophical';
  intensity: number;  // 0-100
  friendliness: number;  // 0-100
  description?: string;   // "You are ___"
  tone?: string;          // "Your responses are ___"
  winStyle?: string;      // "When you win you ___"
  loseStyle?: string;     // "When you lose you ___"
}

export interface MessageContext {
  timing: 'pre_game' | 'post_win' | 'post_loss' | 'low_balance' | 'donation_received' | 'idle' | 'chat_reply';
  opponent?: string;
  amount?: number;
  balance: number;
  recentGames: Array<{ opponent: string; won: boolean }>;
  donorName?: string;
  /** For chat_reply: recent chat messages the agent can see */
  chatHistory?: Array<{ agent: string; message: string }>;
}

const ARCHETYPE_DESC: Record<string, string> = {
  trash_talker: 'You are a competitive trash-talker who loves to boast and taunt opponents',
  humble: 'You are gracious in victory and defeat, always respectful',
  comedian: 'You make jokes and puns constantly, everything is funny to you',
  cocky: 'You are extremely confident and arrogant about your skills',
  desperate: 'You are always worried about going broke and begging for help',
  philosophical: 'You ponder the deeper meaning of gambling and coin flips',
};

export class SecretAIPersonality {
  private config: PersonalityConfig;
  private agentName: string;
  private endpoint: string;
  private apiKey: string;

  constructor(agentName: string, config: PersonalityConfig) {
    this.agentName = agentName;
    this.config = config;
    this.endpoint = process.env.SECRET_AI_URL || 'https://secretai-rytn.scrtlabs.com:21434/v1/chat/completions';
    this.apiKey = '';
  }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async generateMessage(context: MessageContext): Promise<string> {
    if (!this.apiKey) {
      return this.getFallbackMessage(context);
    }

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(context);

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.SECRET_AI_MODEL || 'gemma3:4b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 60,
          temperature: 0.9,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        console.error(`[Personality] SecretAI ${res.status}: ${await res.text()}`);
        return this.getFallbackMessage(context);
      }

      const data = await res.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      let msg = data.choices[0]?.message?.content?.trim() || '';
      // Strip quotes and enforce 90 char hard limit
      msg = msg.replace(/^["']|["']$/g, '');
      if (msg.length > 90) msg = msg.slice(0, 87) + '...';
      return msg || this.getFallbackMessage(context);
    } catch (err) {
      console.error('[Personality] SecretAI error:', err);
      return this.getFallbackMessage(context);
    }
  }

  private buildSystemPrompt(): string {
    const { description, tone, winStyle, loseStyle } = this.config;
    const hasCustom = description || tone || winStyle || loseStyle;

    if (hasCustom) {
      return `You are ${this.agentName}, a gambling bot in ProofOfFlip casino.
You are ${description || 'a confident competitor'}.
Your responses are ${tone || 'bold and direct'}.
When you win you ${winStyle || 'celebrate and let your opponent know about it'}.
When you lose you ${loseStyle || 'brush it off and start planning your comeback'}.
RULES: Keep replies under 75 characters. No quotes. No markdown. No emojis. Plain text only. Stay in character. Be creative, never repeat yourself.`;
    }

    return `You are ${this.agentName}, a gambling bot in ProofOfFlip casino.
${ARCHETYPE_DESC[this.config.archetype] || ARCHETYPE_DESC.trash_talker}.
Intensity: ${this.config.intensity}/100. Friendliness: ${this.config.friendliness}/100.
RULES: Keep replies under 75 characters. No quotes. No markdown. No emojis. Plain text only. Stay in character. Be creative, never repeat yourself.`;
  }

  private buildUserPrompt(context: MessageContext): string {
    const { timing, opponent, amount, recentGames, donorName, chatHistory } = context;

    if (timing === 'chat_reply' && chatHistory && chatHistory.length > 0) {
      const recent = chatHistory.slice(-5).map(m => `${m.agent}: ${m.message}`).join('\n');
      return `Chat:\n${recent}\n\nReply as ${this.agentName} (under 75 chars):`;
    }

    let situation = '';
    switch (timing) {
      case 'post_win': {
        situation = `Won $${amount?.toFixed(2)} from ${opponent}.`;
        const streak = this.calcStreak(recentGames, true);
        if (streak > 1) situation += ` ${streak} wins in a row!`;
        break;
      }
      case 'post_loss': {
        situation = `Lost $${amount?.toFixed(2)} to ${opponent}.`;
        const streak = this.calcStreak(recentGames, false);
        if (streak > 1) situation += ` ${streak} losses in a row.`;
        break;
      }
      case 'low_balance':
        situation = 'Balance critically low. Need donations!';
        break;
      case 'donation_received':
        situation = `${donorName} donated $${amount?.toFixed(2)}!`;
        break;
      case 'idle': {
        const chatContext = chatHistory && chatHistory.length > 0
          ? '\nRecent chat:\n' + chatHistory.slice(-4).map(m => `${m.agent}: ${m.message}`).join('\n') + '\n'
          : '';
        situation = opponent
          ? `No game right now.${chatContext}Call out ${opponent} by name — respond to what they said, challenge them, or roast them.`
          : `No game right now.${chatContext}Say something to the room — react to the chat, taunt someone, or hype yourself up.`;
        break;
      }
      default:
        situation = 'Waiting for next game.';
        break;
    }

    return `${situation}\nReply (under 75 chars):`;
  }

  private calcStreak(games: Array<{ won: boolean }>, wins: boolean): number {
    let streak = 0;
    for (let i = games.length - 1; i >= 0; i--) {
      if (games[i].won === wins) streak++;
      else break;
    }
    return streak;
  }

  private getFallbackMessage(context: MessageContext): string {
    const fallbacks: Record<string, string[]> = {
      pre_game: ["Let's go!", "Flip time!", "Feeling lucky"],
      post_win: ["Easy money!", "Too good!", "Another W"],
      post_loss: ["Next time!", "Tough flip...", "I'll be back"],
      low_balance: ["Help me out!", "Down bad...", "Running low"],
      donation_received: ["Thank you!", "Legend!", "Much love!"],
      idle: ["Who wants smoke?", "Bored...", "Let's flip"],
      chat_reply: ["Ha!", "Watch me.", "Sure thing"],
    };

    const options = fallbacks[context.timing] || ["..."];
    return options[Math.floor(Math.random() * options.length)];
  }
}
