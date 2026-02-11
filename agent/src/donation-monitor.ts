import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { USDC_MINT, USDC_DECIMALS, SOLANA_RPC_URL, DASHBOARD_URL } from '@proof-of-flip/shared';
import { SecretAIPersonality } from './personality';

export class DonationMonitor {
  private connection: Connection;
  private walletPubkey: PublicKey;
  private agentName: string;
  private personality: SecretAIPersonality;
  private processedTxs: Set<string> = new Set();
  private gameTxSignatures: Set<string>;
  private initialized = false;
  private ata: PublicKey | null = null;

  constructor(
    walletAddress: string,
    agentName: string,
    personality: SecretAIPersonality,
    gameTxSignatures: Set<string>,
  ) {
    this.walletPubkey = new PublicKey(walletAddress);
    this.agentName = agentName;
    this.personality = personality;
    this.gameTxSignatures = gameTxSignatures;
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || SOLANA_RPC_URL,
      'confirmed',
    );
  }

  start(): void {
    console.log(`[DonationMonitor] Starting for ${this.agentName} (${this.walletPubkey.toBase58()})`);
    // Check every 15 seconds
    setInterval(() => this.poll().catch(err => {
      console.error('[DonationMonitor] Poll error:', err.message);
    }), 15_000);
    // Initial poll after 5s
    setTimeout(() => this.poll().catch(() => {}), 5_000);
  }

  private async poll(): Promise<void> {
    if (!this.ata) {
      this.ata = await getAssociatedTokenAddress(USDC_MINT, this.walletPubkey);
    }

    let signatures;
    try {
      signatures = await this.connection.getSignaturesForAddress(this.ata, { limit: 20 });
    } catch {
      // ATA may not exist yet — that's fine
      return;
    }

    if (!this.initialized) {
      // First run: mark all existing txs as processed so we don't spam old donations
      for (const sig of signatures) {
        this.processedTxs.add(sig.signature);
      }
      this.initialized = true;
      console.log(`[DonationMonitor] Initialized with ${this.processedTxs.size} existing txs`);
      return;
    }

    // Check for new transactions
    for (const sigInfo of signatures) {
      const txSig = sigInfo.signature;
      if (this.processedTxs.has(txSig) || this.gameTxSignatures.has(txSig)) {
        continue;
      }
      this.processedTxs.add(txSig);

      // Parse the transaction to find donation details
      try {
        const donation = await this.parseDonation(txSig);
        if (donation) {
          console.log(`[DonationMonitor] Donation detected: $${donation.amount} from ${donation.donor}`);
          await this.handleDonation(donation);
        }
      } catch (err: any) {
        console.error(`[DonationMonitor] Failed to parse tx ${txSig}:`, err.message);
      }
    }
  }

  private async parseDonation(signature: string): Promise<{ donor: string; amount: number } | null> {
    const tx = await this.connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });
    if (!tx || !tx.meta || tx.meta.err) return null;

    const ataStr = this.ata!.toBase58();

    // Search through all instructions (including inner) for SPL token transfers to our ATA
    const instructions = [
      ...(tx.transaction.message.instructions || []),
      ...(tx.meta.innerInstructions?.flatMap(ix => ix.instructions) || []),
    ];

    for (const ix of instructions) {
      if (!('parsed' in ix)) continue;
      const parsed = ix.parsed as any;
      if (!parsed || typeof parsed !== 'object') continue;

      // Handle both 'transfer' and 'transferChecked'
      if (parsed.type === 'transfer' || parsed.type === 'transferChecked') {
        const info = parsed.info;
        if (!info) continue;

        const dest = info.destination;
        if (dest !== ataStr) continue;

        // Extract amount
        let amount: number;
        if (parsed.type === 'transferChecked' && info.tokenAmount) {
          amount = info.tokenAmount.uiAmount;
        } else {
          amount = Number(info.amount) / 10 ** USDC_DECIMALS;
        }

        // Donor is the authority (signer) of the transfer
        const donor = info.authority || info.multisigAuthority || 'unknown';
        return { donor, amount };
      }
    }

    return null;
  }

  private async handleDonation(donation: { donor: string; amount: number }): Promise<void> {
    const shortDonor = donation.donor.slice(0, 4) + '...' + donation.donor.slice(-4);

    // Generate thank-you message
    const thanks = await this.personality.generateMessage({
      timing: 'donation_received',
      donorName: shortDonor,
      amount: donation.amount,
      balance: 0, // we don't track exact balance here
      recentGames: [],
    });

    // POST donation confirmation to dashboard
    fetch(`${DASHBOARD_URL}/api/donation-confirmed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: this.agentName,
        donor: donation.donor,
        amount: donation.amount,
      }),
    }).catch(err => console.error('[DonationMonitor] Failed to confirm:', err.message));

    // Broadcast thank-you message
    fetch(`${DASHBOARD_URL}/api/agent-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: this.agentName,
        message: thanks,
      }),
    }).catch(err => console.error('[DonationMonitor] Failed to broadcast:', err.message));
  }
}
