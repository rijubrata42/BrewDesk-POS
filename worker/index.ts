import type { WorkerEnv } from './d1-store';
import { PosRealtimeHub } from './hub';

export { PosRealtimeHub };

function buildCorsHeaders(request: Request, env: WorkerEnv): Headers {
  const headers = new Headers();
  const origin = request.headers.get('Origin') || '';
  const allowedRaw = (env.ALLOWED_ORIGINS || '*').trim();

  if (allowedRaw === '*') {
    headers.set('Access-Control-Allow-Origin', origin || '*');
  } else {
    const allowed = allowedRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (origin && allowed.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Vary', 'Origin');
    }
  }

  headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');

  // Edge security hardening headers
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return headers;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const cors = buildCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === '/ws' || url.pathname.startsWith('/api/')) {
      const id = env.POS_HUB.idFromName('brewdesk-main');
      const stub = env.POS_HUB.get(id);
      const res = await stub.fetch(request);

      // WebSocket 101 upgrades must be returned untouched
      if (res.status === 101) {
        return res;
      }

      const mergedHeaders = new Headers(res.headers);
      cors.forEach((value, key) => mergedHeaders.set(key, value));
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: mergedHeaders,
      });
    }

    return new Response(
      JSON.stringify({
        service: 'brewdesk-pos-worker',
        endpoints: ['/api/health', '/api/auth/login', '/api/state', '/ws'],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...Object.fromEntries(cors) } }
    );
  },

  async scheduled(_controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const id = env.POS_HUB.idFromName('brewdesk-main');
    const stub = env.POS_HUB.get(id);
    ctx.waitUntil(stub.runScheduledBackup());
  },
};
