import {
  Connection,
  PublicKey,
  SystemProgram,
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
  SOL_FUNDING_LAMPORTS,
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

/** Send SOL (gas) only to an agent */
export async function fundAgentSol(recipientAddress: string): Promise<string> {
  const conn = getConnection();
  const payer = getWallet();
  const recipient = new PublicKey(recipientAddress);

  console.log(`[Funding] Sending ${SOL_FUNDING_LAMPORTS / 1e9} SOL to ${recipientAddress} for tx fees`);
  const solTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports: SOL_FUNDING_LAMPORTS,
    })
  );
  const solSig = await conn.sendTransaction(solTx, [payer]);
  await conn.confirmTransaction(solSig, 'confirmed');
  console.log(`[Funding] SOL transfer confirmed: ${solSig}`);
  return solSig;
}

export async function fundAgent(recipientAddress: string): Promise<string> {
  // 1. Send SOL for tx fees
  await fundAgentSol(recipientAddress);

  // 2. Send USDC
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
