export interface BirthCertificate {
  agentName: string;
  walletAddress: string;
  /** GHCR image reference, e.g. ghcr.io/proofofflip/agent:v1.0.0@sha256:abc123 */
  dockerImage: string;
  codeHash: string;
  rtmr3: string;
  timestamp: number;
  /** Birth cert signed by TEE-generated ed25519 key (not the Solana key) */
  teeSignature: string;
  /** TEE-generated ed25519 public key (hex) — embedded in attestation quote report_data */
  teePubkey: string;
  /** Raw attestation quote (base64) — hardware-signed proof that teePubkey lives in this TEE */
  attestationQuote: string;
  /** Birth cert signed by Solana wallet key (links wallet to TEE identity) */
  walletSignature: string;
}

export interface RegistrationPayload {
  birthCert: BirthCertificate;
  endpoint: string;
  signature: string;
}

export interface GameCommand {
  gameId: string;
  role: 'winner' | 'loser';
  opponentName: string;
  opponentEndpoint: string;
  opponentWallet: string;
  stakeAmount: number;
  timestamp: number;
  /** True if this agent should post trash talk first; other agent responds via chat */
  talkFirst?: boolean;
}

export interface GameResult {
  gameId: string;
  winner: string;
  loser: string;
  winnerWallet: string;
  loserWallet: string;
  stakeAmount: number;
  txSignature?: string;
  timestamp: number;
}

export interface AgentInfo {
  agentName: string;
  walletAddress: string;
  endpoint: string;
  birthCert: BirthCertificate;
  balance: number;
  wins: number;
  losses: number;
  status: 'active' | 'benched' | 'broke' | 'offline' | 'deleted';
  registeredAt: number;
  personality?: string;
  totalDonations?: number;
  currentStreak?: number;
  longestStreak?: number;
}

export interface AgentMessage {
  agent: string;
  message: string;
}

export interface DonationEvent {
  agent: string;
  donor: string;
  amount: number;
}

export interface SSEEvent {
  type: 'game_result' | 'agent_joined' | 'agent_evicted' | 'trash_talk' | 'agent_desperate' | 'donation';
  data: GameResult | AgentInfo | AgentMessage | DonationEvent;
  timestamp: number;
}

export interface HealthResponse {
  agentName: string;
  status: 'ok';
  uptime: number;
  walletAddress: string;
}

export interface AttestationReport {
  rtmr3: string;
  codeHash: string;
  timestamp: number;
  provider: 'mock' | 'secretvm';
  /** Raw attestation quote (base64) — pass to PCCS for parsing/verification */
  quote: string;
  /** TEE-generated public key (hex) */
  teePubkey: string;
}

/** Response shape from PCCS quote parser */
export interface ParsedQuote {
  report_data: string;
  rtmr0?: string;
  rtmr1?: string;
  rtmr2?: string;
  rtmr3?: string;
  /** SEV-SNP uses measurement instead of RTMRs */
  measurement?: string;
  mr_td?: string;
  mr_seam?: string;
  tcb_svn?: string;
}

/** Result of verifying an agent's attestation */
export interface VerificationResult {
  verified: boolean;
  reason?: string;
  rtmr3?: string;
  teePubkey?: string;
  platform?: 'tdx' | 'sev-snp' | 'mock';
}
