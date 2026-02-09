import { createDashboardServer } from './server';
import { startCoordinator } from './coordinator';
import { initWallet } from './wallet';
import { DashboardIdentity } from './identity';

async function main() {
  const port = parseInt(process.env.DASHBOARD_PORT || '3000', 10);

  console.log('=== ProofOfFlip Dashboard ===');

  // 1. Initialize wallet (generate on first boot, load on restart)
  const wallet = await initWallet();
  console.log(`[Dashboard] Fund this wallet to start games:`);
  console.log(`[Dashboard]   ${wallet.publicKey.toBase58()}`);

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
