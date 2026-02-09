import { RegistrationPayload } from '@proof-of-flip/shared';
import { FlipBotAgent } from './agent';

export async function registerWithDashboard(
  agent: FlipBotAgent,
  dashboardUrl: string,
  agentEndpoint: string
): Promise<boolean> {
  const payload: RegistrationPayload = {
    birthCert: agent.getBirthCert(),
    endpoint: agentEndpoint,
    signature: agent.signRegistration(agentEndpoint),
  };

  try {
    console.log(`[${agent.name}] Registering with dashboard at ${dashboardUrl}...`);
    const res = await fetch(`${dashboardUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[${agent.name}] Registration successful:`, data);
      return true;
    } else {
      const error = await res.text();
      console.error(`[${agent.name}] Registration failed (${res.status}): ${error}`);
      return false;
    }
  } catch (err) {
    console.error(`[${agent.name}] Registration error:`, err);
    return false;
  }
}
