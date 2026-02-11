import { Request, Response } from 'express';
import { SSEEvent } from '@proof-of-flip/shared';

const clients: Set<Response> = new Set();
const recentEvents: { data: string; time: number }[] = [];
const BUFFER_MS = 15 * 60 * 1000;

export function sseHandler(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write('data: {"type":"connected"}\n\n');

  for (const event of recentEvents) {
    res.write(`data: ${event.data}\n\n`);
  }

  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
}

export function broadcast(event: SSEEvent): void {
  const data = JSON.stringify(event);
  const now = Date.now();
  recentEvents.push({ data, time: now });
  while (recentEvents.length && recentEvents[0].time < now - BUFFER_MS) {
    recentEvents.shift();
  }
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}

export function clientCount(): number {
  return clients.size;
}
