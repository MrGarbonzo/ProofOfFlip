import {
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import {
  USDC_MINT,
  FUNDING_AMOUNT_LAMPORTS,
  SOLANA_RPC_URL,
} from '@proof-of-flip/shared';
import { getWallet } from './wallet';

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

export async function fundAgent(recipientAddress: string): Promise<string> {
  const conn = getConnection();
  const payer = getWallet();
  const recipient = new PublicKey(recipientAddress);

  console.log(`[Funding] Sending ${FUNDING_AMOUNT_LAMPORTS / 1e6} USDC to ${recipientAddress}`);

  const payerATA = await getAssociatedTokenAddress(USDC_MINT, payer.publicKey);

  await getOrCreateAssociatedTokenAccount(
    conn,
    payer,
    USDC_MINT,
    recipient
  );

  const recipientATA = await getAssociatedTokenAddress(USDC_MINT, recipient);

  const tx = new Transaction().add(
    createTransferInstruction(
      payerATA,
      recipientATA,
      payer.publicKey,
      FUNDING_AMOUNT_LAMPORTS
    )
  );

  const signature = await conn.sendTransaction(tx, [payer]);
  await conn.confirmTransaction(signature, 'confirmed');

  console.log(`[Funding] Transfer confirmed: ${signature}`);
  return signature;
}
