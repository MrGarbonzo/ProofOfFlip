import { createDashboardServer } from './server';
import { startCoordinator } from './coordinator';
import { initWallet, getSOLBalance, getUSDCBalance } from './wallet';
import { DashboardIdentity } from './identity';

async function main() {
  const port = parseInt(process.env.DASHBOARD_PORT || '3000', 10);

  console.log('=== ProofOfFlip Dashboard ===');

  // 1. Initialize wallet (generate on first boot, load on restart)
  const wallet = await initWallet();
  const solBalance = await getSOLBalance();
  const usdcBalance = await getUSDCBalance();
  console.log(`[Dashboard] Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`[Dashboard] SOL balance: ${solBalance}`);
  console.log(`[Dashboard] USDC balance: ${usdcBalance}`);
  if (solBalance < 0.01 || usdcBalance < 1) {
    console.warn(`[Dashboard] ⚠ Wallet needs funding! Send SOL and USDC to the address above to enable agent funding.`);
  }

  // 2. Initialize TEE identity (birth certificate, attestation)
  const identity = new DashboardIdentity();
  await identity.boot();

  // 3. Start Express server
  const app = createDashboardServer(identity);
  app.listen(port, () => {
    console.log(`[Dashboard] Server listening on port ${port}`);
    console.log(`[Dashboard] UI: http://localhost:${port}`);
  });

  // 4. Start coordinator match loop
  startCoordinator();

  console.log('[Dashboard] Ready!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
