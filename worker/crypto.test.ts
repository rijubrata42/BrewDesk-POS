import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { hashSecret, signJwt, verifyJwt, verifySecret } from './crypto';

test('hashSecret and verifySecret validate PBKDF2 secrets accurately', async () => {
  const hash = await hashSecret('owner123');
  assert.ok(hash.startsWith('pbkdf2_sha256$100000$'));
  assert.equal(await verifySecret('owner123', hash), true);
  assert.equal(await verifySecret('wrong-pass', hash), false);
});

test('verifySecret remains backward-compatible with bcrypt hashes from Node backups', async () => {
  const bcryptHash = bcrypt.hashSync('1234', 8);
  assert.equal(await verifySecret('1234', bcryptHash), true);
  assert.equal(await verifySecret('9999', bcryptHash), false);
});

test('signJwt and verifyJwt issue and validate HS256 tokens using Web Crypto', async () => {
  const secret = 'test-cloudflare-worker-secret';
  const token = await signJwt(
    {
      id: 'user-owner',
      username: 'owner',
      name: 'Cafe Owner',
      role: 'owner',
      active: true,
      createdAt: new Date().toISOString(),
    },
    secret
  );

  const decoded = await verifyJwt(token, secret);
  assert.ok(decoded);
  assert.equal(decoded?.sub, 'user-owner');
  assert.equal(decoded?.role, 'owner');

  const wrongSecret = await verifyJwt(token, 'other-secret');
  assert.equal(wrongSecret, null);
});
