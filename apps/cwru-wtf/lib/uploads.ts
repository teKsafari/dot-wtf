// Uploaded application images. The driver interface is the whole contract the
// rest of the app knows about, so moving these bytes to S3 (Garage, MinIO) is a
// second implementation of UploadStore, not a change to the join form or review.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type UploadContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface StoredUpload {
  contentType: UploadContentType;
  bytes: Uint8Array;
}

export interface UploadStore {
  save(bytes: Uint8Array, contentType: UploadContentType): Promise<string>;
  read(key: string): Promise<StoredUpload | null>;
  delete(key: string): Promise<void>;
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

const extensions: Record<UploadContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const typesByExtension = new Map(
  Object.entries(extensions).map(([type, extension]) => [extension, type as UploadContentType])
);

// A key is the whole public name of the file. Anything else is a path traversal
// attempt or a stale link, and never reaches the filesystem.
const keyPattern = /^[0-9a-f]{32}\.(jpg|png|webp)$/;

export function isUploadKey(value: string): boolean {
  return keyPattern.test(value);
}

export const defaultMaximumUploadBytes = 5_000_000;

// The declared type of a browser upload is a hint. These are the file's own bytes.
export function sniffImageType(bytes: Uint8Array): UploadContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'RIFF' &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === 'WEBP'
  ) return 'image/webp';
  return null;
}

export async function readImageUpload(file: unknown, maximumBytes = defaultMaximumUploadBytes): Promise<StoredUpload> {
  if (!(file instanceof File) || file.size === 0) {
    throw new UploadError('Add a photo in JPEG, PNG, or WebP format.');
  }
  if (file.size > maximumBytes) {
    throw new UploadError(`Keep your photo under ${Math.floor(maximumBytes / 1_000_000)} MB.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // A browser can lie about size too; the bytes are what gets stored.
  if (bytes.byteLength > maximumBytes) {
    throw new UploadError(`Keep your photo under ${Math.floor(maximumBytes / 1_000_000)} MB.`);
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) throw new UploadError('That file is not a JPEG, PNG, or WebP image.');
  return { contentType, bytes };
}

export function contentTypeForKey(key: string): UploadContentType | null {
  if (!isUploadKey(key)) return null;
  return typesByExtension.get(key.slice(key.lastIndexOf('.') + 1)) ?? null;
}

export function createFilesystemUploadStore(root: string): UploadStore {
  function filePath(key: string): string {
    if (!isUploadKey(key)) throw new UploadError('Unknown image.');
    // A runtime data directory, not a bundled asset: nothing here is traced.
    return path.join(/* turbopackIgnore: true */ root, key);
  }
  return {
    async save(bytes, contentType) {
      const key = `${randomBytes(16).toString('hex')}.${extensions[contentType]}`;
      await mkdir(root, { recursive: true });
      await writeFile(path.join(/* turbopackIgnore: true */ root, key), bytes, { mode: 0o640 });
      return key;
    },
    async read(key) {
      const contentType = contentTypeForKey(key);
      if (!contentType) return null;
      try {
        return { contentType, bytes: new Uint8Array(await readFile(filePath(key))) };
      } catch {
        return null;
      }
    },
    async delete(key) {
      if (!isUploadKey(key)) return;
      await rm(filePath(key), { force: true });
    },
  };
}
