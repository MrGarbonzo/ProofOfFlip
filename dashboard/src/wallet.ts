import { Keypair, Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { USDC_MINT, SOLANA_RPC_URL } from '@proof-of-flip/shared';
import * as fs from 'fs';
import * as path from 'path';

const WALLET_PATH = process.env.STORAGE_PATH || './data';
const WALLET_FILE = 'dashboard-wallet.json';

let keypair: Keypair | null = null;
let connection: Connection | null = null;

function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(
      process.env.SOLANA_RPC_URL || SOLANA_RPC_URL,
      'confirmed'
    );
  }
  return connection;
}

/**
 * Initialize the dashboard wallet.
 * On first boot: generates a new Solana keypair and persists it.
 * On restart: loads the existing keypair from disk.
 * Private key never leaves this process / TEE.
 */
export async function initWallet(): Promise<Keypair> {
  const dir = WALLET_PATH;
  const filePath = path.join(dir, WALLET_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const secretKey = Uint8Array.from(JSON.parse(raw));
    keypair = Keypair.fromSecretKey(secretKey);
    console.log(`[Wallet] Loaded existing wallet: ${keypair.publicKey.toBase58()}`);
  } else {
    keypair = Keypair.generate();
    fs.writeFileSync(filePath, JSON.stringify(Array.from(keypair.secretKey)), 'utf-8');
    console.log(`[Wallet] Generated new wallet: ${keypair.publicKey.toBase58()}`);
  }

  return keypair;
}

export function getWallet(): Keypair {
  if (!keypair) {
    throw new Error('Wallet not initialized — call initWallet() first');
  }
  return keypair;
}

export function getWalletAddress(): string {
  return getWallet().publicKey.toBase58();
}

/** Check the dashboard's SOL balance */
export async function getSOLBalance(): Promise<number> {
  try {
    const conn = getConnection();
    const lamports = await conn.getBalance(getWallet().publicKey);
    return lamports / 1e9;
  } catch {
    return 0;
  }
}

/** Check SOL balance for any address */
export async function getSOLBalanceOf(address: string): Promise<number> {
  try {
    const conn = getConnection();
    const lamports = await conn.getBalance(new PublicKey(address));
    return lamports;
  } catch {
    return 0;
  }
}

/** Check the dashboard's USDC balance */
export async function getUSDCBalance(): Promise<number> {
  try {
    const conn = getConnection();
    const ata = await getAssociatedTokenAddress(USDC_MINT, getWallet().publicKey);
    const account = await getAccount(conn, ata);
    return Number(account.amount) / 1e6;
  } catch {
    return 0;
  }
}
