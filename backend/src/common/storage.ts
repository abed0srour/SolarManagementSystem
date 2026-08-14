import { Injectable, Logger } from '@nestjs/common';
import { del, head, list, put } from '@vercel/blob';
import { existsSync, mkdirSync } from 'fs';
import { readFile, stat, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

/**
 * File storage, abstracted over "a disk" and "a blob store".
 *
 * The app writes two kinds of file: user uploads (logos, attachments) and
 * database backups. Both used `process.cwd()` directly, which is fine on a box
 * with a disk and useless on a serverless platform, where the filesystem is
 * read-only apart from an ephemeral `/tmp`.
 *
 * Rather than rewrite the features for one deployment target, they now go
 * through this interface. Local development keeps writing real files to
 * `uploads/` and `backups/` exactly as before; production writes to Vercel Blob.
 * The selection is by environment, so nobody has to remember to switch it.
 */
export interface StoredObject {
  /** Absolute URL for blob storage, or an app-relative path for local disk. */
  url: string;
  size: number;
  uploadedAt: Date;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  /**
   * Vercel injects BLOB_READ_WRITE_TOKEN when a Blob store is attached. Its
   * presence is the signal that we are running somewhere without a usable disk.
   */
  private readonly useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

  constructor() {
    this.logger.log(`File storage: ${this.useBlob ? 'Vercel Blob' : 'local disk'}`);
  }

  get isBlob() {
    return this.useBlob;
  }

  private localPath(key: string) {
    return join(process.cwd(), key);
  }

  /**
   * Store bytes under `key` (e.g. `uploads/1712-ab.png`, `backups/latest.gz`).
   *
   * Blob uploads use `addRandomSuffix: false` so a key overwrites in place —
   * the backup rotation depends on `backups/backup.json.gz` being a stable
   * name, not a new URL each time.
   */
  async put(key: string, body: Buffer, contentType?: string): Promise<StoredObject> {
    if (this.useBlob) {
      const res = await put(key, body, {
        access: 'public',
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return { url: res.url, size: body.length, uploadedAt: new Date() };
    }
    const path = this.localPath(key);
    mkdirSync(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { url: `/api/${key}`, size: body.length, uploadedAt: new Date() };
  }

  /** Read bytes back, or null when the object does not exist. */
  async get(key: string): Promise<Buffer | null> {
    if (this.useBlob) {
      const found = await this.headBlob(key);
      if (!found) return null;
      const res = await fetch(found.url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    const path = this.localPath(key);
    if (!existsSync(path)) return null;
    return readFile(path);
  }

  async delete(key: string): Promise<void> {
    if (this.useBlob) {
      const found = await this.headBlob(key);
      if (found) await del(found.url).catch(() => undefined);
      return;
    }
    await unlink(this.localPath(key)).catch(() => undefined);
  }

  /** Size and timestamp without transferring the body. */
  async stat(key: string): Promise<StoredObject | null> {
    if (this.useBlob) {
      const found = await this.headBlob(key);
      return found ? { url: found.url, size: found.size, uploadedAt: found.uploadedAt } : null;
    }
    const path = this.localPath(key);
    if (!existsSync(path)) return null;
    const s = await stat(path);
    return { url: `/api/${key}`, size: s.size, uploadedAt: s.mtime };
  }

  /** Copy an object to a new key. Used to rotate the previous backup. */
  async copy(fromKey: string, toKey: string): Promise<boolean> {
    const body = await this.get(fromKey);
    if (!body) return false;
    await this.put(toKey, body, 'application/gzip');
    return true;
  }

  /**
   * `head()` throws rather than returning null for a missing blob, and the
   * pathname-to-URL mapping is not guessable once a store has a random prefix,
   * so fall back to a prefix listing.
   */
  private async headBlob(key: string): Promise<{ url: string; size: number; uploadedAt: Date } | null> {
    try {
      const found = await head(key);
      return { url: found.url, size: found.size, uploadedAt: found.uploadedAt };
    } catch {
      const listed = await list({ prefix: key, limit: 1 }).catch(() => null);
      const blob = listed?.blobs?.find((b) => b.pathname === key);
      return blob ? { url: blob.url, size: blob.size, uploadedAt: blob.uploadedAt } : null;
    }
  }
}
