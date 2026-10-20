/**
 * firebase/storage-compatible upload/delete backed by presigned S3 URLs.
 * API: ref(storage, path) → { uploadBytes, getDownloadURL, deleteObject }.
 *
 * Uses the API's presign endpoint so authz stays server-side.
 */

import { getIdToken } from './auth';
import { AWS_CONFIG } from './config';
import { FriendlyError, ERROR_CODES, ERROR_MESSAGES, markSessionExpired, networkError, toFriendlyError } from './errors';

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
  let token: string;
  try {
    token = await getIdToken();
  } catch (err) {
    if (err instanceof FriendlyError) throw err; // already normalized (session expired)
    markSessionExpired();
    throw new FriendlyError(ERROR_CODES.sessionExpired, ERROR_MESSAGES.sessionExpired);
  }
  let res: Response;
  try {
    res = await fetch(`${API()}/api/storage/presign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ path, action }),
    });
  } catch {
    throw networkError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw toFriendlyError(res.status, body);
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
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': data instanceof Blob ? data.type : 'application/octet-stream' },
      body: bytes as BodyInit,
    });
  } catch {
    throw networkError();
  }
  if (!res.ok) throw toFriendlyError(res.status, null);
  return { ref: storageRef, metadata: { fullPath: storageRef.fullPath } };
}

export async function getDownloadURL(storageRef: StorageReference): Promise<string> {
  // Public-style URL via API route (auth checked at read time by CloudFront/S3 policy)
  return presign(storageRef.fullPath, 'get');
}

export async function deleteObject(storageRef: StorageReference): Promise<void> {
  const url = await presign(storageRef.fullPath, 'delete');
  let res: Response;
  try {
    res = await fetch(url, { method: 'DELETE' });
  } catch {
    throw networkError();
  }
  if (!res.ok && res.status !== 404) throw toFriendlyError(res.status, null);
}
