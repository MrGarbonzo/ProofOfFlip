import { Keypair, Connection, Transaction, PublicKey } from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import { USDC_MINT, GAME_STAKE_LAMPORTS, SOLANA_RPC_URL } from '@proof-of-flip/shared';

export class GameService {
  private keypair: Keypair;
  private connection: Connection;

  constructor(secretKey: Uint8Array) {
    this.keypair = Keypair.fromSecretKey(secretKey);
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || SOLANA_RPC_URL,
      'confirmed'
    );
  }

  /**
   * Pay the winner via x402 protocol.
   * Primary: try x402 fetch (402 → sign tx → retry with payment header).
   * Fallback: direct SPL transfer if x402 handshake fails.
   */
  async payWinner(opponentEndpoint: string, opponentWallet: string): Promise<string> {
    try {
      return await this.payViaX402(opponentEndpoint);
    } catch (err) {
      console.warn('x402 payment failed, falling back to direct transfer:', err);
      return await this.directTransfer(opponentWallet);
    }
  }

  private async payViaX402(opponentEndpoint: string): Promise<string> {
    // Step 1: Hit /collect, expect 402
    const res = await fetch(`${opponentEndpoint}/collect`);

    if (res.status !== 402) {
      throw new Error(`Expected 402, got ${res.status}`);
    }

    const paymentRequirements = res.headers.get('X-Payment') || await res.text();
    let requirements: any;
    try {
      requirements = JSON.parse(paymentRequirements);
    } catch {
      throw new Error('Could not parse payment requirements');
    }

    // Step 2: Build and sign SPL transfer
    const recipientWallet = new PublicKey(requirements.address || requirements.payTo);
    const txSignature = await this.directTransfer(recipientWallet.toBase58());

    // Step 3: Retry with payment proof
    const retryRes = await fetch(`${opponentEndpoint}/collect`, {
      headers: {
        'X-Payment': JSON.stringify({
          txSignature,
          amount: GAME_STAKE_LAMPORTS,
          payer: this.keypair.publicKey.toBase58(),
        }),
      },
    });

    if (!retryRes.ok) {
      console.warn(`Collect retry returned ${retryRes.status}, but transfer was sent`);
    }

    return txSignature;
  }

  async directTransfer(recipientAddress: string): Promise<string> {
    const recipient = new PublicKey(recipientAddress);

    const senderATA = await getAssociatedTokenAddress(
      USDC_MINT,
      this.keypair.publicKey
    );

    const recipientATA = await getAssociatedTokenAddress(
      USDC_MINT,
      recipient
    );

    // Ensure recipient ATA exists
    await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.keypair,
      USDC_MINT,
      recipient
    );

    const tx = new Transaction().add(
      createTransferInstruction(
        senderATA,
        recipientATA,
        this.keypair.publicKey,
        GAME_STAKE_LAMPORTS
      )
    );

    const signature = await this.connection.sendTransaction(tx, [this.keypair]);
    await this.connection.confirmTransaction(signature, 'confirmed');

    console.log(`USDC transfer confirmed: ${signature}`);
    return signature;
  }
}
