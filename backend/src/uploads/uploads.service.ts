import { Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';

@Injectable()
export class UploadsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async register(userId: string, entity: string, entityId: string, file: Express.Multer.File) {
    const attachment = await this.prisma.attachment.create({
      data: {
        entity,
        entityId,
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: `/api/uploads/${file.filename}`,
        uploadedById: userId,
      },
    });
    await this.audit.log(userId, 'UPLOAD', entity, entityId, { file: file.originalname, size: file.size });
    return attachment;
  }

  list(entity: string, entityId: string) {
    return this.prisma.attachment.findMany({
      where: { entity, entityId },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { name: true } } },
    });
  }

  async remove(userId: string, id: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    await this.prisma.attachment.delete({ where: { id } });
    await unlink(join(process.cwd(), 'uploads', attachment.filename)).catch(() => {});
    await this.audit.log(userId, 'DELETE', 'Attachment', id, { file: attachment.originalName });
    return { success: true };
  }
}
