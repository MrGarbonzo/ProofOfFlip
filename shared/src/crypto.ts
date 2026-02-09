import nacl from 'tweetnacl';
import { createHash } from 'crypto';

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function signMessage(message: string, secretKey: Uint8Array): string {
  const messageBytes = Buffer.from(message, 'utf-8');
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return Buffer.from(signature).toString('base64');
}

export function verifySignature(
  message: string,
  signature: string,
  publicKey: Uint8Array
): boolean {
  try {
    const messageBytes = Buffer.from(message, 'utf-8');
    const signatureBytes = Buffer.from(signature, 'base64');
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
  } catch {
    return false;
  }
}

export function generateKeypair(): nacl.SignKeyPair {
  return nacl.sign.keyPair();
}
