export interface TEEProvider {
  getRTMR3(): Promise<string>;
  getSelfAttestation(): Promise<{ rtmr3: string; report: string }>;
  verifyRemoteAttestation(endpoint: string, expectedRTMR3: string): Promise<boolean>;

  /** Get the TEE-generated ed25519 public key (hex) */
  getTeePubkey(): Promise<string>;

  /** Get the raw attestation quote (base64) binding the pubkey to this TEE */
  getAttestationQuote(): Promise<string>;

  /** Sign a message using the TEE-generated ed25519 key (never leaves enclave) */
  signWithTeeKey(payload: string): Promise<string>;
}

export { MockTEEProvider } from './mock';
export { SecretVMTEEProvider } from './secretvm';

export function createTEEProvider(type: string, agentName?: string): TEEProvider {
  if (type === 'secretvm') {
    const { SecretVMTEEProvider } = require('./secretvm');
    return new SecretVMTEEProvider();
  }
  const { MockTEEProvider } = require('./mock');
  return new MockTEEProvider(agentName || 'unknown');
}
