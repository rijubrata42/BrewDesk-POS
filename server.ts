import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from './src/server/db';
import { verifyToken } from './src/server/auth';
import { createApiRouter } from './src/server/routes';

async function startServer() {
  await db.init();

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
    // Leave other upgrade requests (e.g. Vite HMR) to their own handlers
  });

  const broadcast = (event: string, data?: unknown) => {
    const snapshot = db.getPublicSnapshot();
    const message = JSON.stringify({ type: 'state:sync', event, data, state: snapshot });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const token = url.searchParams.get('token') || '';
    const user = verifyToken(token);
    if (!user) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    ws.send(
      JSON.stringify({
        type: 'state:init',
        state: db.getPublicSnapshot(),
      })
    );

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        // Ignore malformed client frames
      }
    });
  });

  app.use('/api', createApiRouter(broadcast));

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT) || 3000;
  // Always listen on 3000 in AI Studio preview unless overridden
  const listenPort = process.env.DEFAULT_APP_PORT ? Number(process.env.DEFAULT_APP_PORT) : port === 8080 ? 3000 : port;
  server.listen(listenPort, '0.0.0.0', () => {
    console.log(`BrewDesk POS server listening on http://0.0.0.0:${listenPort}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
