import bcrypt from 'bcryptjs';
import type { Role, UserPublic } from '../src/shared/types';

export interface AuthTokenPayload {
  sub: string;
  username: string;
  name: string;
  role: Role;
  iat: number;
  exp: number;
}

const te = new TextEncoder();
const td = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function hashSecret(plain: string): Promise<string> {
  const iterations = 100_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', te.encode(plain), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return `pbkdf2_sha256$${iterations}$${toHex(salt)}$${toHex(new Uint8Array(bits))}`;
}

export async function verifySecret(plain: string, storedHash: string): Promise<boolean> {
  if (!plain || !storedHash) return false;
  if (storedHash.startsWith('pbkdf2_sha256$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 4) return false;
    const iterations = Number(parts[1]);
    const salt = fromHex(parts[2]);
    const expected = fromHex(parts[3]);
    if (!Number.isFinite(iterations) || iterations < 1000) return false;

    const key = await crypto.subtle.importKey('raw', te.encode(plain), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      key,
      expected.length * 8
    );
    return timingSafeEqual(new Uint8Array(bits), expected);
  }

  // Backward compatibility if a JSON backup from Node/MongoDB ($2a$ / $2b$) is restored
  if (storedHash.startsWith('$2')) {
    return bcrypt.compareSync(plain, storedHash);
  }

  return false;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    te.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signJwt(user: UserPublic, secret: string, ttlSeconds = 7 * 24 * 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(te.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payloadObj: AuthTokenPayload = {
    sub: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + ttlSeconds,
  };
  const payload = toBase64Url(te.encode(JSON.stringify(payloadObj)));
  const data = `${header}.${payload}`;
  const key = await importHmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(data)));
  return `${data}.${toBase64Url(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<AuthTokenPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sigB64] = parts;
    const key = await importHmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, fromBase64Url(sigB64), te.encode(`${header}.${payload}`));
    if (!ok) return null;
    const decoded = JSON.parse(td.decode(fromBase64Url(payload))) as AuthTokenPayload;
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}
