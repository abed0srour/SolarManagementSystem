import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class NumberingService {
  constructor(private prisma: PrismaService) {}

  /** Atomically get the next document number for an entity (e.g. INV-00042). */
  async next(entity: string, tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx ?? this.prisma;
    const seq = await db.numberSequence.update({
      where: { entity },
      data: { nextNumber: { increment: 1 } },
    });
    const n = seq.nextNumber - 1;
    return `${seq.prefix}${String(n).padStart(seq.padding, '0')}`;
  }
}
