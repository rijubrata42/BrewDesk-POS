import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { Role, UserPublic } from '../shared/types';
import { db } from './db';

export interface AuthTokenPayload {
  sub: string;
  username: string;
  name: string;
  role: Role;
}

export interface AuthedRequest extends Request {
  user?: UserPublic;
}

function getSecret(): string {
  return process.env.JWT_SECRET?.trim() || db.getState().jwtSecret;
}

export function signToken(user: UserPublic): string {
  const payload: AuthTokenPayload = {
    sub: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
  };
  return jwt.sign(payload, getSecret(), { expiresIn: '7d' });
}

export function verifyToken(token: string): UserPublic | null {
  try {
    const decoded = jwt.verify(token, getSecret()) as AuthTokenPayload;
    const found = db.getState().users.find((u) => u.id === decoded.sub && u.active);
    if (!found) return null;
    const { passwordHash: _ph, ...pub } = found;
    return pub;
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const user = verifyToken(token);
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  req.user = user;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: `Permission denied for role: ${req.user.role}` });
      return;
    }
    next();
  };
}

export function verifyOwnerPin(pin: string): boolean {
  if (!pin || typeof pin !== 'string') return false;
  return bcrypt.compareSync(pin.trim(), db.getState().ownerPinHash);
}
