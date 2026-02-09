import {
  BirthCertificate,
  sha256,
  signMessage,
  birthCertMessage,
  createTEEProvider,
  TEEProvider,
} from '@proof-of-flip/shared';
import { getWallet, getWalletAddress } from './wallet';
import * as fs from 'fs';
import * as path from 'path';

interface PersistedIdentity {
  birthCert: BirthCertificate;
}

const IDENTITY_FILE = 'dashboard-identity.json';

export class DashboardIdentity {
  private birthCert!: BirthCertificate;
  private tee: TEEProvider;
  private storagePath: string;

  constructor(teeProvider?: TEEProvider) {
    this.tee = teeProvider || createTEEProvider(process.env.TEE_PROVIDER || 'mock', 'dashboard');
    this.storagePath = process.env.STORAGE_PATH || './data';
  }

  getBirthCert(): BirthCertificate {
    return this.birthCert;
  }

  getTeeProvider(): TEEProvider {
    return this.tee;
  }

  async signWithTeeKey(message: string): Promise<string> {
    return this.tee.signWithTeeKey(message);
  }

  async boot(): Promise<void> {
    const filePath = path.join(this.storagePath, IDENTITY_FILE);

    if (fs.existsSync(filePath)) {
      console.log('[Dashboard] Restarting — loading persisted identity...');
      const raw = fs.readFileSync(filePath, 'utf-8');
      const state: PersistedIdentity = JSON.parse(raw);
      this.birthCert = state.birthCert;

      const currentRTMR3 = await this.tee.getRTMR3();
      if (currentRTMR3 !== this.birthCert.rtmr3) {
        console.warn('[Dashboard] RTMR3 mismatch! Code may have been tampered with.');
        console.warn(`  Expected: ${this.birthCert.rtmr3}`);
        console.warn(`  Got:      ${currentRTMR3}`);
      }
      console.log(`[Dashboard] Identity loaded. RTMR3: ${this.birthCert.rtmr3}`);
    } else {
      console.log('[Dashboard] First boot — generating TEE identity...');
      await this.firstBoot();
      console.log(`[Dashboard] RTMR3: ${this.birthCert.rtmr3}`);
      console.log(`[Dashboard] TEE Pubkey: ${this.birthCert.teePubkey}`);
    }
  }

  private async firstBoot(): Promise<void> {
    const walletAddress = getWalletAddress();

    console.log('[Dashboard] Fetching RTMR3...');
    const rtmr3 = await this.tee.getRTMR3();
    console.log(`[Dashboard] RTMR3: ${rtmr3}`);

    console.log('[Dashboard] Reading TEE pubkey...');
    const teePubkey = await this.tee.getTeePubkey();
    console.log(`[Dashboard] TEE pubkey: ${teePubkey.substring(0, 16)}...`);

    console.log('[Dashboard] Reading attestation quote...');
    const attestationQuote = await this.tee.getAttestationQuote();
    console.log(`[Dashboard] Quote loaded (${attestationQuote.length} chars)`);

    const codeHash = this.computeCodeHash();
    const timestamp = Date.now();
    const dockerImage = process.env.DOCKER_IMAGE || 'local-dev';

    const partialCert: BirthCertificate = {
      agentName: 'dashboard',
      walletAddress,
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

    console.log('[Dashboard] Signing birth cert with TEE key...');
    const teeSignature = await this.tee.signWithTeeKey(message);
    console.log('[Dashboard] TEE signature obtained');

    const wallet = getWallet();
    const walletSignature = signMessage(message, wallet.secretKey);

    this.birthCert = {
      ...partialCert,
      teeSignature,
      walletSignature,
    };

    this.persistState();
  }

  private persistState(): void {
    const filePath = path.join(this.storagePath, IDENTITY_FILE);
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
    const state: PersistedIdentity = { birthCert: this.birthCert };
    fs.writeFileSync(filePath, JSON.stringify(state), 'utf-8');
  }

  private computeCodeHash(): string {
    try {
      const pkg = fs.readFileSync('./package.json', 'utf-8');
      return sha256(pkg);
    } catch {
      return sha256('dashboard-code');
    }
  }
}
