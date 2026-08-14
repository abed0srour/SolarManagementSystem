import { createApp } from './bootstrap';

/** Local / long-running server. Vercel uses `api/index.ts` instead. */
async function bootstrap() {
  const app = await createApp();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Solar Store API running on http://localhost:${port}/api (docs at /api/docs)`);
}
bootstrap();
