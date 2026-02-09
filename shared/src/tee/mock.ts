import nacl from 'tweetnacl';
import { TEEProvider } from './index';
import { sha256 } from '../crypto';

/**
 * MockTEEProvider simulates the SecretVM TEE for local development.
 * Generates a deterministic ed25519 keypair from the agent name,
 * and produces a fake attestation quote embedding the pubkey.
 */
export class MockTEEProvider implements TEEProvider {
  private agentName: string;
  private rtmr3: string;
  private teeKeypair: nacl.SignKeyPair;
  private quote: string;

  constructor(agentName: string) {
    this.agentName = agentName;
    this.rtmr3 = sha256(`mock-rtmr3-${agentName}`);

    // Deterministic seed from agent name → same key on every boot
    const seedHex = sha256(`mock-tee-seed-${agentName}`);
    const seed = Buffer.from(seedHex, 'hex').subarray(0, 32);
    this.teeKeypair = nacl.sign.keyPair.fromSeed(seed);

    // Fake quote: JSON with report_data containing the pubkey hex
    const pubkeyHex = Buffer.from(this.teeKeypair.publicKey).toString('hex');
    this.quote = Buffer.from(JSON.stringify({
      mock: true,
      platform: 'mock',
      report_data: pubkeyHex.padEnd(128, '0'),
      rtmr3: this.rtmr3,
      timestamp: Date.now(),
    })).toString('base64');
  }

  async getRTMR3(): Promise<string> {
    return this.rtmr3;
  }

  async getTeePubkey(): Promise<string> {
    return Buffer.from(this.teeKeypair.publicKey).toString('hex');
  }

  async getAttestationQuote(): Promise<string> {
    return this.quote;
  }

  async signWithTeeKey(payload: string): Promise<string> {
    const messageBytes = Buffer.from(payload, 'utf-8');
    const signature = nacl.sign.detached(messageBytes, this.teeKeypair.secretKey);
    return Buffer.from(signature).toString('base64');
  }

  async getSelfAttestation(): Promise<{ rtmr3: string; report: string }> {
    return {
      rtmr3: this.rtmr3,
      report: JSON.stringify({
        provider: 'mock',
        agentName: this.agentName,
        rtmr3: this.rtmr3,
        teePubkey: await this.getTeePubkey(),
        timestamp: Date.now(),
      }),
    };
  }

  async verifyRemoteAttestation(endpoint: string, expectedRTMR3: string): Promise<boolean> {
    try {
      const res = await fetch(`${endpoint}/attestation`);
      const data = (await res.json()) as { rtmr3?: string };
      return data.rtmr3 === expectedRTMR3;
    } catch {
      return false;
    }
  }
}
