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
  private cachedHtml: string | null = null;

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

  /** Fetch and cache /cpu.html once — all fields are extracted from this */
  private async getAttestHtml(): Promise<string> {
    if (this.cachedHtml) return this.cachedHtml;
    const url = `${this.attestUrl}/cpu.html`;
    console.log(`[SecretVM] Fetching attestation from ${url}...`);
    this.cachedHtml = await this.fetchInsecure(url);
    return this.cachedHtml;
  }

  /** Extract raw quote hex from the cached HTML */
  private async getRawQuoteHex(): Promise<string> {
    const html = await this.getAttestHtml();
    const quoteMatch = html.match(/<pre[^>]*id="quoteTextarea"[^>]*>([\s\S]*?)<\/pre>/i);
    if (!quoteMatch) {
      throw new Error(`Could not find raw quote in attestation HTML (${html.length} chars)`);
    }
    return quoteMatch[1].replace(/\s/g, '');
  }

  async getRTMR3(): Promise<string> {
    const html = await this.getAttestHtml();
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
      // TDX quote: 48-byte header (96 hex), then body. RTMR3 at body offset 472, 48 bytes
      const BODY_START = 96; // 48 bytes * 2
      const rtmr3 = rawHex.substring(BODY_START + 472 * 2, BODY_START + (472 + 48) * 2);
      console.log(`[SecretVM] RTMR3 parsed from raw quote`);
      return rtmr3.toLowerCase();
    }

    throw new Error(`Could not parse RTMR3 from attestation HTML (${html.length} chars)`);
  }

  async getTeePubkey(): Promise<string> {
    if (this.cachedPubkey) return this.cachedPubkey;

    // Try reading from mounted PEM file first
    try {
      if (fs.existsSync(this.pubkeyPath)) {
        console.log(`[SecretVM] Reading TEE pubkey from ${this.pubkeyPath}...`);
        const pem = fs.readFileSync(this.pubkeyPath, 'utf-8');
        const b64 = pem
          .replace(/-----BEGIN PUBLIC KEY-----/, '')
          .replace(/-----END PUBLIC KEY-----/, '')
          .replace(/\s/g, '');
        const der = Buffer.from(b64, 'base64');
        const rawKey = der.subarray(der.length - 32);
        this.cachedPubkey = rawKey.toString('hex');
        return this.cachedPubkey;
      }
    } catch (err: any) {
      console.warn(`[SecretVM] Could not read pubkey file: ${err.message}`);
    }

    // Extract from TDX quote REPORTDATA (first 32 bytes = 64 hex chars of ed25519 pubkey)
    console.log('[SecretVM] Extracting TEE pubkey from quote REPORTDATA...');
    const rawHex = await this.getRawQuoteHex();
    // TDX quote: 48-byte header (96 hex), then body. REPORTDATA at body offset 520, 64 bytes
    const BODY_START = 96;
    const reportData = rawHex.substring(BODY_START + 520 * 2, BODY_START + (520 + 64) * 2);
    // First 32 bytes (64 hex chars) of report_data = ed25519 public key
    this.cachedPubkey = reportData.substring(0, 64).toLowerCase();
    console.log(`[SecretVM] TEE pubkey extracted from REPORTDATA`);
    return this.cachedPubkey;
  }

  async getAttestationQuote(): Promise<string> {
    if (this.cachedQuote) return this.cachedQuote;

    // Try reading from mounted quote file first
    try {
      if (fs.existsSync(this.quotePath)) {
        console.log(`[SecretVM] Reading attestation quote from ${this.quotePath}...`);
        this.cachedQuote = fs.readFileSync(this.quotePath, 'utf-8').trim();
        return this.cachedQuote;
      }
    } catch (err: any) {
      console.warn(`[SecretVM] Could not read quote file: ${err.message}`);
    }

    // Convert raw hex quote to base64
    console.log('[SecretVM] Converting raw quote hex to base64...');
    const rawHex = await this.getRawQuoteHex();
    this.cachedQuote = Buffer.from(rawHex, 'hex').toString('base64');
    console.log(`[SecretVM] Quote converted (${this.cachedQuote.length} chars base64)`);
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
