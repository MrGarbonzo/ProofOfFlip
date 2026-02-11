import { Keypair } from '@solana/web3.js';
import {
  BirthCertificate,
  sha256,
  signMessage,
  birthCertMessage,
  createTEEProvider,
  TEEProvider,
} from '@proof-of-flip/shared';
import { StorageProvider, FileStorageProvider } from './persistence';
import { SecretAIPersonality, PersonalityConfig } from './personality';
import { randomBytes } from 'crypto';
import * as fs from 'fs';

const ARCHETYPES: PersonalityConfig['archetype'][] = [
  'trash_talker', 'humble', 'comedian', 'cocky', 'desperate', 'philosophical',
];

interface PersistedState {
  secretKey: number[];
  birthCert: BirthCertificate;
  personalityConfig?: PersonalityConfig;  // sealed in TEE
}

export class FlipBotAgent {
  readonly name: string;
  private keypair!: Keypair;
  private birthCert!: BirthCertificate;
  private tee: TEEProvider;
  private storage: StorageProvider;
  private bootTime: number;
  private personalityConfig: PersonalityConfig | null = null;
  personality!: SecretAIPersonality;
  recentGames: Array<{ opponent: string; won: boolean }> = [];

  constructor(name: string, teeProvider?: TEEProvider, storage?: StorageProvider) {
    this.name = name;
    this.tee = teeProvider || createTEEProvider(process.env.TEE_PROVIDER || 'mock', name);
    this.storage = storage || new FileStorageProvider();
    this.bootTime = Date.now();
  }

  get walletAddress(): string {
    return this.keypair.publicKey.toBase58();
  }

  get secretKey(): Uint8Array {
    return this.keypair.secretKey;
  }

  get publicKey(): Uint8Array {
    return this.keypair.publicKey.toBytes();
  }

  getBirthCert(): BirthCertificate {
    return this.birthCert;
  }

  getUptime(): number {
    return Date.now() - this.bootTime;
  }

  getTeeProvider(): TEEProvider {
    return this.tee;
  }

  async boot(): Promise<void> {
    const hasState = await this.storage.exists('agent-state');

    if (hasState) {
      console.log(`[${this.name}] Restarting — loading persisted state...`);
      await this.loadState();
      const currentRTMR3 = await this.tee.getRTMR3();
      if (currentRTMR3 !== this.birthCert.rtmr3) {
        console.warn(`[${this.name}] RTMR3 mismatch! Code may have been tampered with.`);
        console.warn(`  Expected: ${this.birthCert.rtmr3}`);
        console.warn(`  Got:      ${currentRTMR3}`);
      }
      console.log(`[${this.name}] Wallet: ${this.walletAddress}`);
    } else {
      console.log(`[${this.name}] First boot — generating identity...`);
      try {
        await this.firstBoot();
      } catch (err: any) {
        console.error(`[${this.name}] Boot FAILED:`, err.message);
        console.error(err.stack);
        throw err;
      }
      console.log(`[${this.name}] Wallet: ${this.walletAddress}`);
      console.log(`[${this.name}] RTMR3: ${this.birthCert.rtmr3}`);
      console.log(`[${this.name}] TEE Pubkey: ${this.birthCert.teePubkey}`);
    }

    // Personality is sealed in TEE persisted state.
    // On first boot it's determined from env (or random), then locked forever.
    if (!this.personalityConfig) {
      // First boot — resolve personality
      this.personalityConfig = this.resolvePersonality();
      await this.persistState();
    }
    this.personality = new SecretAIPersonality(this.name, this.personalityConfig);
    console.log(`[${this.name}] Personality sealed in TEE (hidden from outside)`);
  }

  private resolvePersonality(): PersonalityConfig {
    const env = process.env.PERSONALITY_ARCHETYPE || 'random';

    // Check for custom fill-in-the-blank fields
    const description = process.env.PERSONALITY_DESC || '';
    const tone = process.env.PERSONALITY_TONE || '';
    const winStyle = process.env.PERSONALITY_WIN_STYLE || '';
    const loseStyle = process.env.PERSONALITY_LOSE_STYLE || '';
    const hasCustom = description || tone || winStyle || loseStyle;

    if (env === 'random' && !hasCustom) {
      // TEE picks its own personality using secure randomness
      const idx = randomBytes(1)[0] % ARCHETYPES.length;
      const intensity = 30 + (randomBytes(1)[0] % 71);  // 30-100
      const friendliness = randomBytes(1)[0] % 101;      // 0-100
      console.log(`[${this.name}] TEE chose its own personality (hidden)`);
      return { archetype: ARCHETYPES[idx], intensity, friendliness };
    }

    return {
      archetype: (env as PersonalityConfig['archetype']) || 'trash_talker',
      intensity: parseInt(process.env.PERSONALITY_INTENSITY || '70', 10),
      friendliness: parseInt(process.env.PERSONALITY_FRIENDLINESS || '50', 10),
      ...(description && { description }),
      ...(tone && { tone }),
      ...(winStyle && { winStyle }),
      ...(loseStyle && { loseStyle }),
    };
  }

  private async firstBoot(): Promise<void> {
    // Generate Solana wallet (for USDC transfers)
    this.keypair = Keypair.generate();
    console.log(`[${this.name}] Wallet generated: ${this.walletAddress}`);

    // Get TEE attestation data
    console.log(`[${this.name}] Fetching RTMR3...`);
    const rtmr3 = await this.tee.getRTMR3();
    console.log(`[${this.name}] RTMR3: ${rtmr3}`);

    console.log(`[${this.name}] Reading TEE pubkey...`);
    const teePubkey = await this.tee.getTeePubkey();
    console.log(`[${this.name}] TEE pubkey: ${teePubkey.substring(0, 16)}...`);

    console.log(`[${this.name}] Reading attestation quote...`);
    const attestationQuote = await this.tee.getAttestationQuote();
    console.log(`[${this.name}] Quote loaded (${attestationQuote.length} chars)`);

    const codeHash = this.computeCodeHash();
    const timestamp = Date.now();

    const dockerImage = process.env.DOCKER_IMAGE || 'local-dev';

    // Build the canonical message for signing
    const partialCert: BirthCertificate = {
      agentName: this.name,
      walletAddress: this.walletAddress,
      dockerImage,
      codeHash,
      rtmr3,
      timestamp,
      teeSignature: '',
      teePubkey,
      attestationQuote,
      walletSignature: '',
    };

    const message = birthCertMessage(partialCert);

    // Sign with TEE key (proves this cert was created inside this TEE enclave)
    console.log(`[${this.name}] Signing birth cert with TEE key...`);
    const teeSignature = await this.tee.signWithTeeKey(message);
    console.log(`[${this.name}] TEE signature obtained`);

    // Sign with Solana wallet key (links the wallet to this TEE identity)
    const walletSignature = signMessage(message, this.keypair.secretKey);

    this.birthCert = {
      ...partialCert,
      teeSignature,
      walletSignature,
    };

    await this.persistState();
  }

  private async loadState(): Promise<void> {
    const raw = await this.storage.read('agent-state');
    const state: PersistedState = JSON.parse(raw);
    this.keypair = Keypair.fromSecretKey(Uint8Array.from(state.secretKey));
    this.birthCert = state.birthCert;
    this.personalityConfig = state.personalityConfig || null;
  }

  private async persistState(): Promise<void> {
    const state: PersistedState = {
      secretKey: Array.from(this.keypair.secretKey),
      birthCert: this.birthCert,
      personalityConfig: this.personalityConfig || undefined,
    };
    await this.storage.write('agent-state', JSON.stringify(state));
  }

  private computeCodeHash(): string {
    try {
      const pkg = fs.readFileSync('./package.json', 'utf-8');
      return sha256(pkg);
    } catch {
      return sha256(`${this.name}-agent-code`);
    }
  }

  signRegistration(endpoint: string): string {
    const message = `register:${this.walletAddress}:${endpoint}`;
    return signMessage(message, this.keypair.secretKey);
  }
}
