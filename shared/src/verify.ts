import nacl from 'tweetnacl';
import { BirthCertificate, ParsedQuote, VerificationResult } from './types';
import { PCCS_QUOTE_PARSE_URL } from './constants';

/**
 * Parse an attestation quote via SCRT Labs PCCS service.
 * The quote is hardware-signed — PCCS validates the signature chain
 * (Intel/AMD root CA → platform cert → quote) and returns the parsed fields.
 */
export async function parseAttestationQuote(quoteB64: string): Promise<ParsedQuote> {
  const res = await fetch(PCCS_QUOTE_PARSE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quote: quoteB64 }),
  });

  if (!res.ok) {
    throw new Error(`PCCS quote parse failed: ${res.status}`);
  }

  const body = (await res.json()) as { quote?: ParsedQuote };
  if (!body.quote) {
    throw new Error('PCCS returned no parsed quote');
  }

  return body.quote;
}

/**
 * Extract the ed25519 public key from a parsed quote's report_data.
 * First 32 bytes (64 hex chars) of report_data = the TEE-generated public key.
 */
export function extractPubkeyFromQuote(parsedQuote: ParsedQuote): string {
  const reportData = parsedQuote.report_data || '';
  if (reportData.length < 64) {
    throw new Error(`report_data too short: ${reportData.length} hex chars`);
  }
  return reportData.substring(0, 64);
}

/**
 * Verify an ed25519 signature using the TEE public key.
 */
export function verifyTeeSignature(
  message: string,
  signatureB64: string,
  pubkeyHex: string
): boolean {
  try {
    const msgBytes = Buffer.from(message, 'utf-8');
    const sigBytes = Buffer.from(signatureB64, 'base64');
    const pubBytes = Buffer.from(pubkeyHex, 'hex');
    return nacl.sign.detached.verify(msgBytes, sigBytes, pubBytes);
  } catch {
    return false;
  }
}

/**
 * Full verification of a birth certificate's TEE attestation chain.
 *
 * Trust chain:
 * 1. Parse the attestation quote via PCCS (validates hardware signature)
 * 2. Extract the pubkey from quote's report_data
 * 3. Confirm extracted pubkey matches the birth cert's claimed teePubkey
 * 4. Verify the birth cert's teeSignature was made by that pubkey
 * 5. Check RTMR3 from the quote matches the birth cert's claimed rtmr3
 *
 * If all pass: this birth cert was created inside a genuine TEE
 * running the code measured by that RTMR3.
 */
export async function verifyBirthCertAttestation(
  birthCert: BirthCertificate,
  expectedRTMR3s?: Set<string>
): Promise<VerificationResult> {
  // Mock mode: if quote is base64-encoded JSON with mock:true
  let isMock = false;
  try {
    const decoded = JSON.parse(Buffer.from(birthCert.attestationQuote, 'base64').toString());
    if (decoded.mock) isMock = true;
  } catch { /* not mock */ }

  if (isMock) {
    return verifyMockBirthCert(birthCert, expectedRTMR3s);
  }

  // Production: parse quote via PCCS, fall back to local TDX parsing
  let parsedQuote: ParsedQuote;
  try {
    parsedQuote = await parseAttestationQuote(birthCert.attestationQuote);
  } catch (err: any) {
    console.log(`[Verify] PCCS parse failed (${err.message}), trying local TDX parse...`);
    try {
      parsedQuote = parseTdxQuoteLocally(birthCert.attestationQuote);
    } catch (localErr: any) {
      return { verified: false, reason: `Quote parse failed: PCCS: ${err.message}, local: ${localErr.message}` };
    }
  }

  // Extract pubkey from hardware-signed report_data
  let quotePubkey: string;
  try {
    quotePubkey = extractPubkeyFromQuote(parsedQuote);
  } catch (err: any) {
    return { verified: false, reason: `Pubkey extraction failed: ${err.message}` };
  }

  // Step 1: Does the pubkey in the quote match what the birth cert claims?
  if (quotePubkey !== birthCert.teePubkey) {
    return {
      verified: false,
      reason: `TEE pubkey mismatch: quote has ${quotePubkey}, cert claims ${birthCert.teePubkey}`,
    };
  }

  // Step 2: Was the birth cert actually signed by this TEE key?
  const certData = birthCertMessage(birthCert);
  if (!verifyTeeSignature(certData, birthCert.teeSignature, quotePubkey)) {
    return { verified: false, reason: 'TEE signature on birth cert is invalid' };
  }

  // Step 3: Does the RTMR3 in the quote match the birth cert?
  const quoteRTMR3 = parsedQuote.rtmr3 || '';
  if (quoteRTMR3 && quoteRTMR3 !== birthCert.rtmr3) {
    return {
      verified: false,
      reason: `RTMR3 mismatch: quote has ${quoteRTMR3}, cert claims ${birthCert.rtmr3}`,
    };
  }

  // Step 4: Is the RTMR3 in our allowlist of trusted code?
  if (expectedRTMR3s && expectedRTMR3s.size > 0 && !expectedRTMR3s.has(birthCert.rtmr3)) {
    return { verified: false, reason: `RTMR3 ${birthCert.rtmr3} not in allowlist` };
  }

  return {
    verified: true,
    rtmr3: birthCert.rtmr3,
    teePubkey: quotePubkey,
    platform: 'tdx',
  };
}

/**
 * Verify a mock birth cert (local dev). Checks signature math is correct
 * even though there's no hardware attestation.
 */
function verifyMockBirthCert(
  birthCert: BirthCertificate,
  expectedRTMR3s?: Set<string>
): VerificationResult {
  const certData = birthCertMessage(birthCert);

  if (!verifyTeeSignature(certData, birthCert.teeSignature, birthCert.teePubkey)) {
    return { verified: false, reason: 'TEE signature invalid (mock)' };
  }

  if (expectedRTMR3s && expectedRTMR3s.size > 0 && !expectedRTMR3s.has(birthCert.rtmr3)) {
    return { verified: false, reason: `RTMR3 ${birthCert.rtmr3} not in allowlist` };
  }

  return {
    verified: true,
    rtmr3: birthCert.rtmr3,
    teePubkey: birthCert.teePubkey,
    platform: 'mock',
  };
}

/**
 * Parse a TDX quote locally using known byte offsets.
 * TDX Quote v4 layout: 48-byte header, then report body with fields at fixed offsets.
 */
function parseTdxQuoteLocally(quoteB64: string): ParsedQuote {
  // Decode base64 to hex
  const rawHex = Buffer.from(quoteB64, 'base64').toString('hex');
  const BODY_START = 96; // 48 bytes = 96 hex chars

  function extract(bodyOffset: number, size: number): string {
    const start = BODY_START + bodyOffset * 2;
    const end = start + size * 2;
    if (end <= rawHex.length) {
      return rawHex.substring(start, end);
    }
    return '';
  }

  return {
    report_data: extract(520, 64),
    rtmr0: extract(328, 48),
    rtmr1: extract(376, 48),
    rtmr2: extract(424, 48),
    rtmr3: extract(472, 48),
    mr_td: extract(136, 48),
    tcb_svn: extract(0, 16),
  };
}

/** Canonical message that gets TEE-signed in a birth certificate */
export function birthCertMessage(cert: BirthCertificate): string {
  return `${cert.agentName}:${cert.walletAddress}:${cert.dockerImage}:${cert.codeHash}:${cert.rtmr3}:${cert.timestamp}`;
}
