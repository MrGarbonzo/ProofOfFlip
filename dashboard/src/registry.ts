import { PublicKey } from '@solana/web3.js';
import {
  RegistrationPayload,
  AgentInfo,
  VerificationResult,
  verifySignature,
  verifyBirthCertAttestation,
  birthCertMessage,
} from '@proof-of-flip/shared';
import { battlePool, fundedWallets } from './state';
import { fundAgent } from './funding';
import { broadcast } from './sse';

// Allowlist of known RTMR3 values (populated at startup or from env)
const rtmr3Allowlist: Set<string> = new Set();

export function addToAllowlist(rtmr3: string): void {
  rtmr3Allowlist.add(rtmr3);
}

export async function registerAgent(payload: RegistrationPayload, requestIp?: string): Promise<{
  success: boolean;
  message: string;
  agent?: AgentInfo;
  verification?: VerificationResult;
}> {
  const { birthCert, signature } = payload;

  // Auto-detect callback URL from request IP if agent sent localhost.
  // The agent signs `register:<wallet>:<endpoint>` with its own endpoint value,
  // so we must verify the signature against payload.endpoint (what was signed),
  // then store the auto-detected callback URL for game commands.
  let callbackUrl = payload.endpoint;
  if (!callbackUrl || callbackUrl.includes('localhost')) {
    const ip = requestIp?.replace('::ffff:', '') || '127.0.0.1';
    callbackUrl = `http://${ip}`;  // port 80 — SecretVM exposes 80:3001
    console.log(`[Registry] Auto-detected callback for ${birthCert.agentName}: ${callbackUrl}`);
  }

  // ─── Step 1: Verify TEE attestation chain ───
  // This is the core proof of autonomy:
  //   parse quote → validate hardware signature → extract pubkey from report_data
  //   → verify teeSignature was made by that pubkey → check RTMR3
  const verification = await verifyBirthCertAttestation(birthCert, rtmr3Allowlist);

  if (!verification.verified) {
    console.warn(`[Registry] TEE verification failed for ${birthCert.agentName}: ${verification.reason}`);
    return {
      success: false,
      message: `TEE attestation failed: ${verification.reason}`,
      verification,
    };
  }

  console.log(`[Registry] TEE verified: ${birthCert.agentName} (platform: ${verification.platform}, rtmr3: ${verification.rtmr3?.substring(0, 16)}...)`);

  // ─── Step 2: Verify wallet signature ───
  // The walletSignature proves the Solana wallet key also signed the same birth cert.
  // Combined with the TEE signature, this creates a binding:
  //   TEE key (proven by hardware) ←→ birth cert data ←→ Solana wallet
  const certData = birthCertMessage(birthCert);
  let pubKeyBytes: Uint8Array;
  try {
    pubKeyBytes = new PublicKey(birthCert.walletAddress).toBytes();
  } catch {
    return { success: false, message: 'Invalid wallet address' };
  }

  if (!verifySignature(certData, birthCert.walletSignature, pubKeyBytes)) {
    return { success: false, message: 'Wallet signature on birth cert is invalid' };
  }

  // ─── Step 3: Verify registration signature ───
  // Proves the entity registering actually controls the wallet.
  // Verify against payload.endpoint — the value the agent actually signed.
  const regMessage = `register:${birthCert.walletAddress}:${payload.endpoint}`;
  if (!verifySignature(regMessage, signature, pubKeyBytes)) {
    return { success: false, message: 'Registration signature invalid' };
  }

  // ─── Step 4: Duplicate check ───
  if (battlePool.get(birthCert.walletAddress)) {
    return { success: false, message: 'Agent already registered' };
  }

  // ─── Step 5: Fund agent with USDC ───
  let funded = false;
  if (!fundedWallets.has(birthCert.walletAddress)) {
    try {
      await fundAgent(birthCert.walletAddress);
      fundedWallets.add(birthCert.walletAddress);
      funded = true;
    } catch (err: any) {
      console.warn(`[Registry] Failed to fund agent ${birthCert.agentName}: ${err.message}`);
      console.log(`[Registry] Granting ${birthCert.agentName} mock balance for local dev`);
    }
  }

  // Create agent info and add to pool
  // If funding fails (local dev, no USDC), grant a mock starting balance so games can run
  const agent: AgentInfo = {
    agentName: birthCert.agentName,
    walletAddress: birthCert.walletAddress,
    endpoint: callbackUrl,
    birthCert,
    balance: funded ? 1.0 : 1.0,
    wins: 0,
    losses: 0,
    status: 'active',
    registeredAt: Date.now(),
  };

  battlePool.add(agent);

  broadcast({
    type: 'agent_joined',
    data: agent,
    timestamp: Date.now(),
  });

  console.log(`[Registry] Agent ${birthCert.agentName} registered (wallet: ${birthCert.walletAddress}, funded: ${funded}, platform: ${verification.platform})`);

  return { success: true, message: 'Registration successful', agent, verification };
}
