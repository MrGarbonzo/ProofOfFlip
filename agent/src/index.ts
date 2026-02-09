import { FlipBotAgent } from './agent';
import { createServer } from './server';
import { registerWithDashboard } from './registration';
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
    const success = await registerWithDashboard(agent, dashboardUrl, agentEndpoint);
    if (success) break;
    console.log(`[${agentName}] Retry registration in 5s... (${i + 1}/${maxRetries})`);
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log(`[${agentName}] Ready for games!`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
