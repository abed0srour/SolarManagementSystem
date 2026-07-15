import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NumberingService } from '../common/numbering.service';
import { InvoicesService } from '../invoices/invoices.service';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private numbering: NumberingService,
    private invoices: InvoicesService,
  ) {}

  findAll(query: {
    direction?: string;
    clientId?: string;
    supplierId?: string;
    invoiceId?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: Prisma.PaymentWhereInput = { deletedAt: null };
    if (query.direction) where.direction = query.direction as any;
    if (query.clientId) where.clientId = query.clientId;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.invoiceId) where.invoiceId = query.invoiceId;
    if (query.search) {
      where.OR = [
        { number: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
        { client: { name: { contains: query.search, mode: 'insensitive' } } },
        { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const page = Number(query.page) || 1;
    const pageSize = Math.min(Number(query.pageSize) || 25, 200);
    return this.prisma.payment
      .findMany({
        where,
        include: {
          invoice: { select: { number: true } },
          client: { select: { name: true } },
          supplier: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: { paymentDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      })
      .then(async (items) => ({ items, total: await this.prisma.payment.count({ where }), page, pageSize }));
  }

  async findOne(id: string) {
    const p = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        invoice: { include: { client: true, supplier: true } },
        client: true,
        supplier: true,
        schedule: true,
        createdBy: { select: { name: true } },
      },
    });
    if (!p) throw new NotFoundException('Payment not found');
    return p;
  }

  async create(userId: string, dto: any) {
    if (dto.amount <= 0) throw new BadRequestException('Amount must be positive');

    let invoice = null as any;
    if (dto.invoiceId) {
      invoice = await this.prisma.invoice.findUnique({ where: { id: dto.invoiceId } });
      if (!invoice) throw new NotFoundException('Invoice not found');
      if (invoice.status === 'CANCELLED') throw new BadRequestException('Invoice is cancelled');
      const remaining = Number(invoice.total) - Number(invoice.paidAmount);
      if (dto.direction === 'INCOMING' && dto.amount > remaining + 0.01)
        throw new BadRequestException(`Payment exceeds remaining balance (${remaining.toFixed(2)})`);
    }

    // Paying with store credit reduces the client's credit balance
    if (dto.method === 'STORE_CREDIT') {
      const clientId = dto.clientId ?? invoice?.clientId;
      if (!clientId) throw new BadRequestException('Store credit payments need a client');
      const client = await this.prisma.client.findUnique({ where: { id: clientId } });
      if (!client || Number(client.storeCredit) < dto.amount)
        throw new BadRequestException('Insufficient store credit');
    }

    const number = await this.numbering.next('PAYMENT');
    const payment = await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          number,
          direction: dto.direction,
          invoiceId: dto.invoiceId,
          clientId: dto.clientId ?? invoice?.clientId,
          supplierId: dto.supplierId ?? invoice?.supplierId,
          scheduleId: dto.scheduleId,
          method: dto.method,
          amount: dto.amount,
          currency: dto.currency ?? 'USD',
          exchangeRate: dto.exchangeRate ?? 1,
          paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
          reference: dto.reference,
          notes: dto.notes,
          createdById: userId,
        },
      });

      if (dto.method === 'STORE_CREDIT') {
        await tx.client.update({
          where: { id: p.clientId! },
          data: { storeCredit: { decrement: dto.amount } },
        });
      }

      if (dto.invoiceId) {
        await this.invoices.refreshPaymentStatus(tx, dto.invoiceId);
        // Mark schedule installments as paid in order
        const schedules = await tx.paymentSchedule.findMany({
          where: { invoiceId: dto.invoiceId },
          orderBy: { installmentNo: 'asc' },
        });
        if (schedules.length) {
          const inv = await tx.invoice.findUnique({ where: { id: dto.invoiceId } });
          let paid = Number(inv!.paidAmount);
          for (const s of schedules) {
            if (s.status === 'PAID') {
              paid -= Number(s.amount);
              continue;
            }
            if (paid >= Number(s.amount) - 0.01) {
              await tx.paymentSchedule.update({ where: { id: s.id }, data: { status: 'PAID', paidAt: new Date() } });
              paid -= Number(s.amount);
            }
          }
        }
      }
      return p;
    });

    await this.audit.log(userId, 'CREATE', 'Payment', payment.id, { number, amount: dto.amount, direction: dto.direction });
    return this.findOne(payment.id);
  }

  async remove(userId: string, id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Payment not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id }, data: { deletedAt: new Date() } });
      if (p.method === 'STORE_CREDIT' && p.clientId) {
        await tx.client.update({ where: { id: p.clientId }, data: { storeCredit: { increment: Number(p.amount) } } });
      }
      if (p.invoiceId) {
        await this.invoices.refreshPaymentStatus(tx, p.invoiceId);
        await tx.paymentSchedule.updateMany({
          where: { invoiceId: p.invoiceId, status: 'PAID' },
          data: { status: 'PENDING', paidAt: null },
        });
      }
    });
    await this.audit.log(userId, 'DELETE', 'Payment', id, { number: p.number, amount: p.amount });
    return { success: true };
  }

  /** Upcoming and overdue installments for the payments dashboard. */
  async dueSchedules() {
    const now = new Date();
    const in14days = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
    const schedules = await this.prisma.paymentSchedule.findMany({
      where: { status: { not: 'PAID' }, dueDate: { lte: in14days } },
      include: { invoice: { include: { client: { select: { name: true } } } } },
      orderBy: { dueDate: 'asc' },
    });
    return schedules.map((s) => ({ ...s, isOverdue: s.dueDate < now }));
  }
}
