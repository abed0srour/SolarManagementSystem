import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { requireTenantId } from './tenant-context';

@Injectable()
export class NumberingService {
  constructor(private prisma: PrismaService) {}

  /**
   * Atomically get the next document number for an entity (e.g. INV-00042).
   *
   * Counters are per store: two tenants each run their own INV-00001, and
   * neither can see or advance the other one. The compound key is spelled out
   * rather than left to the scoping extension because `update` needs a complete
   * unique key up front — `entity` alone stopped being unique the moment there
   * was more than one store.
   */
  async next(entity: string, tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx ?? this.prisma;
    const tenantId = requireTenantId();
    const seq = await db.numberSequence.update({
      where: { tenantId_entity: { tenantId, entity } },
      data: { nextNumber: { increment: 1 } },
    });
    const n = seq.nextNumber - 1;
    return `${seq.prefix}${String(n).padStart(seq.padding, '0')}`;
  }
}
