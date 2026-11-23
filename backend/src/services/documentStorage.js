import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { env } from '../config/env.js';
import {
  assertNoSupabaseError,
  getSupabaseClient,
  isSupabaseActive,
} from '../config/supabase.js';

export const PRIVATE_DOCUMENT_BUCKET = 'land-application-documents';

function useSupabaseDocumentStorage() {
  if (isSupabaseActive()) return true;
  if (!process.env.ANAGU_STORE_PATH && !env.pg.enabled && env.supabase.enabled) {
    throw new Error('Supabase is configured but its application schema is not ready.');
  }
  return false;
}

function createSafeObjectName(fileName) {
  const safeName = String(fileName || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${randomUUID()}-${safeName}`;
}

// All local document uploads live under backend/uploads/ so they stay
// within the backend layer and are never served as static frontend assets.
function localUploadDirectory() {
  if (process.env.VERCEL) return path.join(os.tmpdir(), 'anagu-uploads');
  // __dirname resolves to backend/src/services — go up two levels to backend/
  const backendRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  return path.join(backendRoot, 'uploads');
}

function resolveLocalDocumentPath(storagePath) {
  if (!storagePath) return null;
  const cleanRel = String(storagePath).replace(/^[/\\]+/, '');
  // Accept both legacy 'uploads/...' paths and new 'backend/uploads/...' paths
  const backendRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const roots = [
    path.join(backendRoot, 'uploads'),              // backend/uploads (new canonical)
    path.resolve(process.cwd(), 'uploads'),          // legacy root/uploads
    path.resolve(os.tmpdir(), 'anagu-uploads'),      // Vercel tmp
  ];
  const candidates = [
    path.resolve(process.cwd(), cleanRel),
    ...roots.map((root) => path.resolve(root, path.basename(cleanRel))),
  ];

  for (const candidate of candidates) {
    if (roots.some((root) => candidate.startsWith(`${root}${path.sep}`))) return candidate;
  }
  return null;
}

export async function storeSupportingDocumentFile({
  applicationId,
  fileName,
  mimeType,
  buffer,
}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('Supporting document content must be a Buffer.');
  }

  const objectName = createSafeObjectName(fileName);
  if (useSupabaseDocumentStorage()) {
    const storagePath = `${Number(applicationId)}/${objectName}`;
    const { error } = await getSupabaseClient()
      .storage.from(PRIVATE_DOCUMENT_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType || 'application/octet-stream',
        upsert: false,
      });
    assertNoSupabaseError(error, 'Upload supporting document to private Supabase Storage');
    return { storagePath, storageBucket: PRIVATE_DOCUMENT_BUCKET };
  }

  const storedFileName = `app-${Number(applicationId)}-${objectName}`;
  const uploadDirectory = localUploadDirectory();
  await fs.mkdir(uploadDirectory, { recursive: true });
  await fs.writeFile(path.join(uploadDirectory, storedFileName), buffer, { flag: 'wx' });
  return {
    storagePath: `backend/uploads/${storedFileName}`,
    storageBucket: null,
  };
}

export async function readSupportingDocumentFile(document) {
  if (document.storage_bucket) {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase Storage is required to read this supporting document.');
    }
    const { data, error } = await client.storage
      .from(document.storage_bucket)
      .download(document.storage_path);
    assertNoSupabaseError(error, 'Download supporting document from private Supabase Storage');
    if (!data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  const diskPath = resolveLocalDocumentPath(document.storage_path);
  if (!diskPath) return null;
  try {
    return await fs.readFile(diskPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function removeSupportingDocumentFile(document) {
  if (document.storage_bucket) {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase Storage is required to remove this supporting document.');
    }
    const { error } = await client.storage
      .from(document.storage_bucket)
      .remove([document.storage_path]);
    assertNoSupabaseError(error, 'Remove supporting document from private Supabase Storage');
    return;
  }

  const diskPath = resolveLocalDocumentPath(document.storage_path);
  if (!diskPath) return;
  try {
    await fs.unlink(diskPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
