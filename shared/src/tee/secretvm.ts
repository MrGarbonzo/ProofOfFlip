import * as fs from 'fs';
import * as https from 'https';
import { TEEProvider } from './index';
import {
  SECRETVM_ATTEST_URL,
  SECRETVM_SIGN_URL,
  SECRETVM_PUBKEY_PATH,
  SECRETVM_QUOTE_PATH,
} from '../constants';

// Allow self-signed certs on the attest server
const insecureAgent = new https.Agent({ rejectUnauthorized: false });

/**
 * SecretVMTEEProvider uses the real SecretVM infrastructure:
 * - Attestation server at :29343 (HTTPS, self-signed) for RTMR3 via /cpu.html
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
    const url = `${this.attestUrl}/cpu.html`;
    console.log(`[SecretVM] Fetching attestation from ${url}...`);

    // Use Node https module directly — native fetch doesn't support self-signed certs
    const html = await this.fetchInsecure(url);
    return this.parseRTMR3FromHtml(html);
  }

  private async fetchInsecure(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { rejectUnauthorized: false }, (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Attestation request timed out'));
      });
    });
  }

  private parseRTMR3FromHtml(html: string): string {
    // Try label-based parsing first (e.g. "RTMR3: <hex>")
    const labelMatch = html.match(/RTMR3[:\s]+([0-9a-fA-F]{64,96})/i);
    if (labelMatch) {
      console.log(`[SecretVM] RTMR3 parsed from label`);
      return labelMatch[1].toLowerCase();
    }

    // Fallback: extract raw quote hex from <pre id="quoteTextarea"> and parse TDX offsets
    const quoteMatch = html.match(/<pre[^>]*id="quoteTextarea"[^>]*>([\s\S]*?)<\/pre>/i);
    if (quoteMatch) {
      const rawHex = quoteMatch[1].replace(/\s/g, '');
      // TDX quote structure: RTMR3 is at byte offset 472, 48 bytes
      const rtmr3 = rawHex.substring(472 * 2, (472 + 48) * 2);
      console.log(`[SecretVM] RTMR3 parsed from raw quote`);
      return rtmr3.toLowerCase();
    }

    throw new Error(`Could not parse RTMR3 from attestation HTML (${html.length} chars)`);
  }

  async getTeePubkey(): Promise<string> {
    if (this.cachedPubkey) return this.cachedPubkey;

    console.log(`[SecretVM] Reading TEE pubkey from ${this.pubkeyPath}...`);
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

    console.log(`[SecretVM] Reading attestation quote from ${this.quotePath}...`);
    this.cachedQuote = fs.readFileSync(this.quotePath, 'utf-8').trim();
    return this.cachedQuote;
  }

  async signWithTeeKey(payload: string): Promise<string> {
    console.log(`[SecretVM] Signing with TEE key via ${this.signUrl}...`);
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
    const rtmr3 = await this.getRTMR3();
    return {
      rtmr3,
      report: JSON.stringify({ rtmr3, source: 'secretvm-cpu-html' }),
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
