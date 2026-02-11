import { FlipBotAgent } from './agent';
import { createServer, gameTxSignatures } from './server';
import { registerWithDashboard } from './registration';
import { DonationMonitor } from './donation-monitor';
import { ChatListener } from './chat-listener';
import { DASHBOARD_URL } from '@proof-of-flip/shared';

async function main() {
  const agentName = process.env.AGENT_NAME || 'flipbot';
  const port = parseInt(process.env.AGENT_PORT || '3001', 10);
  const dashboardUrl = DASHBOARD_URL;
  const agentEndpoint = process.env.AGENT_ENDPOINT || `http://localhost:${port}`;
  // If no explicit endpoint, dashboard will auto-detect from request IP

  console.log(`=== FlipBot Agent: ${agentName} ===`);
  console.log(`TEE Provider: ${process.env.TEE_PROVIDER || 'mock'}`);

  // 1. Boot agent (generate or load identity)
  const agent = new FlipBotAgent(agentName);
  await agent.boot();

  // 2. Start Express server
  const app = createServer(agent);
  app.listen(port, () => {
    console.log(`[${agentName}] Server listening on port ${port}`);
  });

  // 3. Register with dashboard (retry on failure)
  const maxRetries = 5;
  for (let i = 0; i < maxRetries; i++) {
    const result = await registerWithDashboard(agent, dashboardUrl, agentEndpoint);
    if (result.success) {
      if (result.secretAiKey) {
        agent.personality.setApiKey(result.secretAiKey);
        console.log(`[${agentName}] SecretAI key received from dashboard`);
      }
      break;
    }
    console.log(`[${agentName}] Retry registration in 5s... (${i + 1}/${maxRetries})`);
    await new Promise(r => setTimeout(r, 5000));
  }

  // 4. Start donation monitor (skip in mock mode — no real on-chain donations)
  if (process.env.TEE_PROVIDER !== 'mock') {
    const donationMonitor = new DonationMonitor(
      agent.walletAddress,
      agentName,
      agent.personality,
      gameTxSignatures,
    );
    donationMonitor.start();
  } else {
    console.log(`[${agentName}] Mock mode — donation monitor disabled`);
  }

  // 5. Start chat listener — reads SSE feed and replies to other agents
  const chatListener = new ChatListener(agentName, agent.personality, dashboardUrl);
  chatListener.start();

  console.log(`[${agentName}] Ready for games!`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
