/**
 * firebase/storage compatibility (mobile) → S3 presigned URLs.
 * Mobile uploads pass RN file URIs — converted to blobs via fetch.
 */

import { getIdToken } from './auth';
import { AWS_CONFIG } from './config';
import { FriendlyError, ERROR_CODES, ERROR_MESSAGES, markSessionExpired, networkError, toFriendlyError } from './errors';

const API = () => AWS_CONFIG.apiUrl;

export interface StorageReference {
  fullPath: string;
  name: string;
}

export function ref(_storage: unknown, path: string): StorageReference {
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
  return ((await res.json()) as { url: string }).url;
}

export async function uploadBytes(
  storageRef: StorageReference,
  data: Blob | string | { uri?: string },
  _metadata?: Record<string, unknown>,
): Promise<{ ref: StorageReference; metadata: { fullPath: string } }> {
  let body: Blob | ArrayBuffer;
  let contentType = 'application/octet-stream';

  if (typeof data === 'string') {
    // RN file URI → fetch as blob
    const resp = await fetch(data);
    body = await resp.blob();
    contentType = (body as Blob).type || contentType;
  } else if (data && typeof data === 'object' && 'uri' in data && data.uri) {
    const resp = await fetch(data.uri);
    body = await resp.blob();
    contentType = (body as Blob).type || contentType;
  } else {
    body = data as Blob;
    contentType = (data as Blob).type || contentType;
  }

  const url = await presign(storageRef.fullPath, 'put');
  let res: Response;
  try {
    res = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body });
  } catch {
    throw networkError();
  }
  if (!res.ok) throw toFriendlyError(res.status, null);
  return { ref: storageRef, metadata: { fullPath: storageRef.fullPath } };
}

export async function getDownloadURL(storageRef: StorageReference): Promise<string> {
  return presign(storageRef.fullPath, 'get');
}

export function getStorage(_app?: unknown): unknown {
  return {};
}
