import { Injectable, NotFoundException } from '@nestjs/common';
import { extname } from 'path';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { StorageService } from '../common/storage';

@Injectable()
export class UploadsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private storage: StorageService,
  ) {}

  /**
   * Persist an uploaded file and record it.
   *
   * `path` holds whatever the browser should request: an absolute blob URL in
   * production, or the app-relative `/api/uploads/...` route served by
   * `useStaticAssets` in development. Storing the resolved location rather than
   * rebuilding it at read time means files uploaded before a move keep working
   * after it.
   */
  async register(userId: string, entity: string, entityId: string, file: Express.Multer.File) {
    // multer's memoryStorage gives no filename, so mint one the same way the
    // old diskStorage did — timestamped and random, keeping the extension.
    const filename = `${Date.now()}-${randomBytes(8).toString('hex')}${extname(file.originalname).toLowerCase()}`;
    const stored = await this.storage.put(`uploads/${filename}`, file.buffer, file.mimetype);

    const attachment = await this.prisma.attachment.create({
      data: {
        entity,
        entityId,
        filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: stored.url,
        uploadedById: userId,
      },
    });
    await this.audit.log(userId, 'UPLOAD', entity, entityId, { file: file.originalname, size: file.size });
    return attachment;
  }

  list(entity: string, entityId: string) {
    return this.prisma.attachment.findMany({ relationLoadStrategy: 'join',
      where: { entity, entityId },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { name: true } } },
    });
  }

  async remove(userId: string, id: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('Attachment not found');
    await this.prisma.attachment.delete({ where: { id } });
    await this.storage.delete(`uploads/${attachment.filename}`);
    await this.audit.log(userId, 'DELETE', 'Attachment', id, { file: attachment.originalName });
    return { success: true };
  }
}
