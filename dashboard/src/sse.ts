import { Request, Response } from 'express';
import { SSEEvent } from '@proof-of-flip/shared';

const clients: Set<Response> = new Set();

export function sseHandler(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write('data: {"type":"connected"}\n\n');

  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
}

export function broadcast(event: SSEEvent): void {
  const data = JSON.stringify(event);
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}

export function clientCount(): number {
  return clients.size;
}
