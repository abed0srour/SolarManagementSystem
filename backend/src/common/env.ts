/**
 * Map the database URLs a hosting integration provides onto the names Prisma
 * expects.
 *
 * `schema.prisma` reads `DATABASE_URL` and `DIRECT_URL`. Vercel's Supabase
 * integration injects `POSTGRES_PRISMA_URL` (pooled, via PgBouncer) and
 * `POSTGRES_URL_NON_POOLING` (direct) instead, and marks them sensitive — their
 * values cannot be read back out to be copied into differently-named variables.
 *
 * So the translation happens here, at startup, before anything constructs a
 * PrismaClient. Explicitly-set values always win, which keeps local development
 * and any other host working unchanged.
 *
 * Must be imported before the Nest application is created.
 */
export function applyDatabaseEnv(): void {
  if (!process.env.DATABASE_URL && process.env.POSTGRES_PRISMA_URL) {
    process.env.DATABASE_URL = process.env.POSTGRES_PRISMA_URL;
  }
  if (!process.env.DIRECT_URL) {
    // Migrations cannot run through a transaction pooler, so they need the
    // direct connection; fall back to the pooled one only if that is all there is.
    process.env.DIRECT_URL =
      process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL ?? undefined;
  }
}

applyDatabaseEnv();
