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
import * as fs from 'fs';

interface PersistedState {
  secretKey: number[];
  birthCert: BirthCertificate;
}

export class FlipBotAgent {
  readonly name: string;
  private keypair!: Keypair;
  private birthCert!: BirthCertificate;
  private tee: TEEProvider;
  private storage: StorageProvider;
  private bootTime: number;

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
      await this.firstBoot();
      console.log(`[${this.name}] Wallet: ${this.walletAddress}`);
      console.log(`[${this.name}] RTMR3: ${this.birthCert.rtmr3}`);
      console.log(`[${this.name}] TEE Pubkey: ${this.birthCert.teePubkey}`);
    }
  }

  private async firstBoot(): Promise<void> {
    // Generate Solana wallet (for USDC transfers)
    this.keypair = Keypair.generate();

    // Get TEE attestation data
    const rtmr3 = await this.tee.getRTMR3();
    const teePubkey = await this.tee.getTeePubkey();
    const attestationQuote = await this.tee.getAttestationQuote();
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
    const teeSignature = await this.tee.signWithTeeKey(message);

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
  }

  private async persistState(): Promise<void> {
    const state: PersistedState = {
      secretKey: Array.from(this.keypair.secretKey),
      birthCert: this.birthCert,
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
