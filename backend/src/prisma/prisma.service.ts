import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantScopeExtension } from './tenant-scope';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // The database is remote (Supabase pooler), so each query inside an
    // interactive transaction pays network latency. The default 5s transaction
    // timeout is easily exceeded by multi-line receipts/confirmations (P2028).
    super({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } });

    /*
     * Every consumer of this service gets the tenant-scoped client, not the raw
     * one. Returning the extended client from the constructor is what makes
     * that unavoidable: there is no second, unscoped `prisma` handle for a
     * service to reach for by mistake, because none is ever exposed.
     *
     * `$extends` returns a proxy that forwards anything it does not define
     * itself to this instance, so `onModuleInit`, `onModuleDestroy` and the
     * logger below all still work through it.
     */
    return this.$extends(tenantScopeExtension) as unknown as PrismaService;
  }

  async onModuleInit() {
    // The Supabase pooler occasionally refuses the first connection (P1001,
    // transient network/DNS). Retry with backoff instead of crashing startup.
    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        if (attempt > 1) this.logger.log(`Database connected on attempt ${attempt}`);
        return;
      } catch (err: any) {
        if (attempt === maxAttempts) throw err;
        const delay = attempt * 3000;
        this.logger.warn(
          `Database unreachable (attempt ${attempt}/${maxAttempts}): ${err.message?.split('\n')[0]} — retrying in ${delay / 1000}s`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
