import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // The database is remote (Supabase pooler), so each query inside an
    // interactive transaction pays network latency. The default 5s transaction
    // timeout is easily exceeded by multi-line receipts/confirmations (P2028).
    super({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } });
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
