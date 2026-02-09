import * as fs from 'fs';
import { TEEProvider } from './index';
import {
  SECRETVM_ATTEST_URL,
  SECRETVM_SIGN_URL,
  SECRETVM_PUBKEY_PATH,
  SECRETVM_QUOTE_PATH,
} from '../constants';

/**
 * SecretVMTEEProvider uses the real SecretVM infrastructure:
 * - Attestation server at :29343/self for RTMR3
 * - TEE-generated ed25519 keypair mounted at /app/data/
 * - Signing server at 172.17.0.1:49153/sign (internal Docker network only)
 * - Attestation quote binding the pubkey to this TEE enclave
 */
export class SecretVMTEEProvider implements TEEProvider {
  private attestUrl: string;
  private signUrl: string;
  private pubkeyPath: string;
  private quotePath: string;

  private cachedPubkey: string | null = null;
  private cachedQuote: string | null = null;

  constructor(config?: {
    attestUrl?: string;
    signUrl?: string;
    pubkeyPath?: string;
    quotePath?: string;
  }) {
    this.attestUrl = config?.attestUrl || SECRETVM_ATTEST_URL;
    this.signUrl = config?.signUrl || SECRETVM_SIGN_URL;
    this.pubkeyPath = config?.pubkeyPath || SECRETVM_PUBKEY_PATH;
    this.quotePath = config?.quotePath || SECRETVM_QUOTE_PATH;
  }

  async getRTMR3(): Promise<string> {
    const attestation = await this.getSelfAttestation();
    return attestation.rtmr3;
  }

  async getTeePubkey(): Promise<string> {
    if (this.cachedPubkey) return this.cachedPubkey;

    const pem = fs.readFileSync(this.pubkeyPath, 'utf-8');
    // Extract raw key bytes from PEM — strip header/footer and decode base64
    const b64 = pem
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s/g, '');
    // Ed25519 DER-encoded public key: 12-byte header + 32-byte key
    const der = Buffer.from(b64, 'base64');
    const rawKey = der.subarray(der.length - 32);
    this.cachedPubkey = rawKey.toString('hex');
    return this.cachedPubkey;
  }

  async getAttestationQuote(): Promise<string> {
    if (this.cachedQuote) return this.cachedQuote;

    this.cachedQuote = fs.readFileSync(this.quotePath, 'utf-8').trim();
    return this.cachedQuote;
  }

  async signWithTeeKey(payload: string): Promise<string> {
    const res = await fetch(this.signUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key_type: 'ed25519',
        payload,
      }),
    });

    if (!res.ok) {
      throw new Error(`TEE signing server error: ${res.status}`);
    }

    const data = (await res.json()) as { signature: string };
    return data.signature;
  }

  async getSelfAttestation(): Promise<{ rtmr3: string; report: string }> {
    const res = await fetch(this.attestUrl);
    if (!res.ok) {
      throw new Error(`Attestation server error: ${res.status}`);
    }
    const data = (await res.json()) as { rtmr3?: string; RTMR3?: string };
    return {
      rtmr3: data.rtmr3 || data.RTMR3 || '',
      report: JSON.stringify(data),
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
