import { PublicKey } from '@solana/web3.js';

export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const USDC_DECIMALS = 6;

export const GAME_STAKE = 0.01;
export const GAME_STAKE_LAMPORTS = GAME_STAKE * 10 ** USDC_DECIMALS; // 10000

export const FUNDING_AMOUNT = 1.0;
export const FUNDING_AMOUNT_LAMPORTS = FUNDING_AMOUNT * 10 ** USDC_DECIMALS; // 1000000

export const MATCH_INTERVAL_MS = 60_000;

export const MIN_BALANCE_TO_PLAY = GAME_STAKE;

export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

export const SECRETVM_ATTEST_URL = process.env.SECRETVM_ATTEST_URL || 'https://172.17.0.1:29343';

// SecretVM Verifiable Message Signing
export const SECRETVM_SIGN_URL = 'http://172.17.0.1:49153/sign';
export const SECRETVM_PUBKEY_PATH = '/app/data/pubkey.pem';
export const SECRETVM_QUOTE_PATH = '/app/data/quote.txt';

// SCRT Labs PCCS quote parser
export const PCCS_QUOTE_PARSE_URL = 'https://pccs.scrtlabs.com/dcap-tools/quote-parse';

// Dashboard — the single well-known endpoint every agent connects to.
// Baked into the image. Override with DASHBOARD_URL env var for local dev only.
export const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://mrgarbonzo.com';
