/**
 * firebase/storage-compatible upload/delete backed by presigned S3 URLs.
 * API: ref(storage, path) → { uploadBytes, getDownloadURL, deleteObject }.
 *
 * Uses the API's presign endpoint so authz stays server-side.
 */

import { getIdToken } from './auth';
import { AWS_CONFIG } from './config';

const API = () => AWS_CONFIG.apiUrl.replace(/\/$/, '');

export interface StorageReference {
  fullPath: string;
  name: string;
}

export function ref(storage: unknown, path: string): StorageReference {
  void storage;
  return { fullPath: path, name: path.split('/').pop() ?? path };
}

async function presign(path: string, action: 'put' | 'get' | 'delete'): Promise<string> {
  const token = await getIdToken();
  const res = await fetch(`${API()}/api/storage/presign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ path, action }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Presign failed (${res.status})`);
  }
  const body = (await res.json()) as { url: string };
  return body.url;
}

export async function uploadBytes(
  storageRef: StorageReference,
  data: Blob | ArrayBuffer | Uint8Array,
  _metadata?: Record<string, unknown>,
): Promise<{ ref: StorageReference; metadata: { fullPath: string } }> {
  const url = await presign(storageRef.fullPath, 'put');
  const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': data instanceof Blob ? data.type : 'application/octet-stream' },
    body: bytes as BodyInit,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return { ref: storageRef, metadata: { fullPath: storageRef.fullPath } };
}

export async function getDownloadURL(storageRef: StorageReference): Promise<string> {
  // Public-style URL via API route (auth checked at read time by CloudFront/S3 policy)
  return presign(storageRef.fullPath, 'get');
}

export async function deleteObject(storageRef: StorageReference): Promise<void> {
  const url = await presign(storageRef.fullPath, 'delete');
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
}
