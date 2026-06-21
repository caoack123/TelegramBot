import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Express, NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'telegram_bot_admin';
const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function getSessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || '';
}

function signExpiry(expiry: string): string {
  return createHmac('sha256', getSessionSecret()).update(expiry).digest('hex');
}

function createSessionToken(): string {
  const expiry = String(Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS);
  return `${expiry}.${signExpiry(expiry)}`;
}

function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.cookie || '';
  return Object.fromEntries(cookieHeader.split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return [];
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return [[key, decodeURIComponent(value)]];
  }));
}

export function isAdminAuthenticated(request: Request): boolean {
  const sessionSecret = getSessionSecret();
  if (!sessionSecret) return false;

  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return false;

  const [expiry, signature] = token.split('.');
  if (!expiry || !signature || Number(expiry) <= Math.floor(Date.now() / 1000)) return false;
  return safeEqual(signature, signExpiry(expiry));
}

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (!process.env.ADMIN_PASSWORD || !getSessionSecret()) {
    return response.status(503).json({ error: 'Admin authentication is not configured.' });
  }
  if (!isAdminAuthenticated(request)) {
    return response.status(401).json({ error: 'Authentication required.' });
  }
  next();
}

export function registerAuthRoutes(app: Express) {
  app.get('/api/auth/status', (request, response) => {
    response.json({
      configured: Boolean(process.env.ADMIN_PASSWORD && getSessionSecret()),
      authenticated: isAdminAuthenticated(request),
    });
  });

  app.post('/api/auth/login', (request, response) => {
    const configuredPassword = process.env.ADMIN_PASSWORD || '';
    const submittedPassword = typeof request.body?.password === 'string' ? request.body.password : '';
    const clientId = request.ip || request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempts = loginFailures.get(clientId);

    if (!configuredPassword || !getSessionSecret()) {
      return response.status(503).json({ error: 'Admin authentication is not configured.' });
    }
    if (attempts && attempts.resetAt > now && attempts.count >= MAX_LOGIN_FAILURES) {
      return response.status(429).json({ error: '尝试次数过多，请稍后再试' });
    }
    if (!safeEqual(submittedPassword, configuredPassword)) {
      const current = attempts && attempts.resetAt > now ? attempts : { count: 0, resetAt: now + LOGIN_WINDOW_MS };
      current.count += 1;
      loginFailures.set(clientId, current);
      return response.status(401).json({ error: '密码错误' });
    }

    loginFailures.delete(clientId);
    const secure = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
    const attributes = [
      `${COOKIE_NAME}=${encodeURIComponent(createSessionToken())}`,
      'HttpOnly',
      'Path=/',
      `Max-Age=${SESSION_DURATION_SECONDS}`,
      'SameSite=Strict',
      secure ? 'Secure' : '',
    ].filter(Boolean);
    response.setHeader('Set-Cookie', attributes.join('; '));
    response.json({ success: true });
  });

  app.post('/api/auth/logout', (_request, response) => {
    response.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`);
    response.json({ success: true });
  });
}

export function verifyTelegramWebhook(request: Request): boolean {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  const receivedSecret = request.header('x-telegram-bot-api-secret-token') || '';
  return Boolean(expectedSecret && safeEqual(receivedSecret, expectedSecret));
}

export function isAllowedTelegramChat(chatId: number): boolean {
  const configuredIds = (process.env.ALLOWED_TELEGRAM_CHAT_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return configuredIds.length === 0 || configuredIds.includes(String(chatId));
}

