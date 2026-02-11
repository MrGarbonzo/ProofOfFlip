import { createDashboardServer } from './server';
import { startCoordinator } from './coordinator';
import { initWallet, getSOLBalance, getUSDCBalance } from './wallet';
import { DashboardIdentity } from './identity';
import { addToAllowlist } from './registry';

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

  // 2. Parse ALLOWED_RTMR3 env var → pre-seed allowlist
  const allowedRtmr3 = process.env.ALLOWED_RTMR3;
  if (allowedRtmr3) {
    for (const v of allowedRtmr3.split(',').map(s => s.trim()).filter(Boolean)) {
      addToAllowlist(v);
    }
    console.log(`[Dashboard] RTMR3 mode: explicit allowlist (${allowedRtmr3.split(',').length} entries)`);
  } else if (process.env.TEE_PROVIDER === 'mock') {
    console.log(`[Dashboard] RTMR3 mode: open (mock)`);
  } else {
    console.log(`[Dashboard] RTMR3 mode: TOFU (first agent locks the value)`);
  }

  // 3. Initialize TEE identity (birth certificate, attestation)
  const identity = new DashboardIdentity();
  await identity.boot();

  // 4. Start Express server
  const app = createDashboardServer(identity);
  app.listen(port, () => {
    console.log(`[Dashboard] Server listening on port ${port}`);
    console.log(`[Dashboard] UI: http://localhost:${port}`);
  });

  // 5. Start coordinator match loop
  startCoordinator();

  console.log('[Dashboard] Ready!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
