import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { StorageService } from './storage';

/**
 * Local-disk mode only.
 *
 * Blob mode talks to a hosted service, so it is not unit-testable without a
 * token; what matters here is that the abstraction preserves the behaviour the
 * backup and upload features relied on when they wrote to disk directly.
 */
describe('StorageService (local disk)', () => {
  const KEY = 'test-storage/sample.bin';
  const DIR = join(process.cwd(), 'test-storage');
  let storage: StorageService;

  beforeEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    storage = new StorageService();
  });

  afterEach(() => {
    rmSync(DIR, { recursive: true, force: true });
  });

  it('uses local disk when no blob token is configured', () => {
    expect(storage.isBlob).toBe(false);
  });

  it('round-trips bytes', async () => {
    const body = Buffer.from('solar store backup contents');
    await storage.put(KEY, body);
    expect(await storage.get(KEY)).toEqual(body);
  });

  it('creates missing directories on the way', async () => {
    await storage.put('test-storage/nested/deep/file.bin', Buffer.from('x'));
    expect(existsSync(join(process.cwd(), 'test-storage/nested/deep/file.bin'))).toBe(true);
  });

  it('overwrites in place rather than versioning', async () => {
    // The backup rotation depends on a stable key holding the latest archive.
    await storage.put(KEY, Buffer.from('first'));
    await storage.put(KEY, Buffer.from('second'));
    expect((await storage.get(KEY))?.toString()).toBe('second');
  });

  it('returns null for a missing object instead of throwing', async () => {
    expect(await storage.get('test-storage/never-written.bin')).toBeNull();
    expect(await storage.stat('test-storage/never-written.bin')).toBeNull();
  });

  it('reports size and a URL', async () => {
    await storage.put(KEY, Buffer.from('12345'));
    const info = await storage.stat(KEY);
    expect(info?.size).toBe(5);
    expect(info?.url).toBe(`/api/${KEY}`);
  });

  it('deletes, and deleting something absent is not an error', async () => {
    await storage.put(KEY, Buffer.from('x'));
    await storage.delete(KEY);
    expect(await storage.get(KEY)).toBeNull();
    await expect(storage.delete(KEY)).resolves.toBeUndefined();
  });

  it('copies one key to another, leaving the source intact', async () => {
    // This is the backup rotation: latest becomes previous before being replaced.
    await storage.put(KEY, Buffer.from('generation one'));
    expect(await storage.copy(KEY, 'test-storage/previous.bin')).toBe(true);
    expect((await storage.get('test-storage/previous.bin'))?.toString()).toBe('generation one');
    expect((await storage.get(KEY))?.toString()).toBe('generation one');
  });

  it('reports a copy of a missing source as not done', async () => {
    // The first backup ever taken has no previous generation to rotate.
    expect(await storage.copy('test-storage/absent.bin', 'test-storage/previous.bin')).toBe(false);
  });

  it('switches to blob mode when a token is present', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test';
    expect(new StorageService().isBlob).toBe(true);
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });
});
