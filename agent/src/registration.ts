import { RegistrationPayload } from '@proof-of-flip/shared';
import { FlipBotAgent } from './agent';

export async function registerWithDashboard(
  agent: FlipBotAgent,
  dashboardUrl: string,
  agentEndpoint: string
): Promise<{ success: boolean; secretAiKey?: string }> {
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
      const data = await res.json() as { success: boolean; message: string; secretAiKey?: string };
      console.log(`[${agent.name}] Registration successful (secretAiKey: ${data.secretAiKey ? 'provided' : 'none'})`);
      return { success: true, secretAiKey: data.secretAiKey };
    } else {
      const error = await res.text();
      console.log(`[${agent.name}] Registration failed (${res.status}): ${error}`);
      return { success: false };
    }
  } catch (err: any) {
    console.log(`[${agent.name}] Registration error: ${err.message || err}`);
    return { success: false };
  }
}
