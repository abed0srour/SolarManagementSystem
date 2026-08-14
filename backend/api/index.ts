import type { IncomingMessage, ServerResponse } from 'http';
import { createApp } from '../src/bootstrap';

/**
 * Vercel serverless entry point.
 *
 * A serverless function is invoked per request, but the container is reused
 * between invocations while it stays warm. Booting Nest costs a second or more,
 * so the app is created once and the promise cached at module scope —
 * subsequent requests on the same instance skip straight to routing.
 *
 * The promise (not the resolved app) is cached deliberately: two requests
 * arriving during a cold start both await the same boot instead of racing to
 * build two applications.
 */
let cached: Promise<any> | null = null;

async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!cached) {
    cached = createApp().then(async (app) => {
      await app.init();
      return app.getHttpAdapter().getInstance();
    });
  }
  const expressApp = await cached;
  return expressApp(req, res);
}

export default handler;
