/**
 * `firebase/storage` compatibility module → S3 presigned URLs.
 */

export { ref, uploadBytes, getDownloadURL, deleteObject, type StorageReference } from './storage';

/** Sentinel — ref(storage, path) ignores it. */
export function getStorage(_app?: unknown): unknown {
  return {};
}
