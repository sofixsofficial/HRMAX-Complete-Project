/**
 * S3 presigned URL endpoints — replaces Firebase Storage for the clients.
 * Authz mirrors the original storage.rules per prefix.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Route } from '../lib/http.js';
import { must } from '../lib/http.js';
import { isSuperAdmin, assertCompanyScope, hasPermission } from '../lib/auth.js';
import { ApiError } from '../lib/types.js';

const s3 = new S3Client({});
const BUCKET = process.env.FILES_BUCKET ?? '';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DOC_TYPES = [...IMAGE_TYPES, 'application/pdf'];

/** Prefix → allowed max size (bytes) + content types. */
function policyFor(path: string): { maxSize: number; types: string[] } {
  if (path.startsWith('selfies/')) return { maxSize: 5 * 1024 * 1024, types: IMAGE_TYPES };
  if (path.startsWith('avatars/')) return { maxSize: 2 * 1024 * 1024, types: IMAGE_TYPES };
  if (path.startsWith('company-logos/')) return { maxSize: 5 * 1024 * 1024, types: IMAGE_TYPES };
  if (path.startsWith('executives/') || path.startsWith('team-leaders/')) return { maxSize: 5 * 1024 * 1024, types: DOC_TYPES };
  if (path.startsWith('documents/') || path.startsWith('employees/')) return { maxSize: 10 * 1024 * 1024, types: DOC_TYPES };
  if (path.startsWith('company-docs/')) return { maxSize: 10 * 1024 * 1024, types: DOC_TYPES };
  return { maxSize: 10 * 1024 * 1024, types: DOC_TYPES };
}

/** Extract companyId from a path like selfies/{companyId}/{userId}/… */
function companyInPath(path: string): string | null {
  const parts = path.split('/');
  if (parts.length < 2) return null;
  const knownSecond = ['selfies', 'company-logos', 'documents', 'company-docs'];
  if (knownSecond.includes(parts[0])) return parts[1] ?? null;
  return null;
}

export const storageRoutes: Route[] = [
  {
    method: 'POST',
    path: '/api/storage/presign',
    handler: async (req) => {
      const caller = must(req);
      const { path: objPath, action, contentType } = req.body as { path: string; action: 'put' | 'get' | 'delete'; contentType?: string };
      if (!BUCKET) throw new ApiError('internal', 'File storage is not configured');
      if (!objPath) throw new ApiError('bad-request', 'path required');
      if (objPath.includes('..')) throw new ApiError('bad-request', 'Invalid path');

      const policy = policyFor(objPath);

      // Selfie: owner only (parity with storage.rules)
      if (objPath.startsWith('selfies/')) {
        const parts = objPath.split('/');
        if (parts[2] !== caller.uid) throw new ApiError('permission-denied', 'Selfies are owner-only');
      }

      // Company-scoped prefixes enforce scope
      const cid = companyInPath(objPath);
      if (cid && !isSuperAdmin(caller)) {
        if (caller.role === 'executive' || caller.role === 'team-leader' || caller.role === 'company-admin') {
          try {
            assertCompanyScope(caller, cid);
          } catch {
            throw new ApiError('permission-denied', 'File path out of company scope');
          }
        }
      }

      // Staff document prefixes require employee-manage permission
      if (['executives/', 'team-leaders/', 'employees/', 'documents/'].some((p) => objPath.startsWith(p))) {
        if (!isSuperAdmin(caller) && !hasPermission(caller, 'employees.create') && !hasPermission(caller, 'employees.edit') && !hasPermission(caller, 'employees.view')) {
          throw new ApiError('permission-denied', 'Cannot manage these files');
        }
      }

      if (action === 'put') {
        if (contentType && !policy.types.includes(contentType)) {
          throw new ApiError('bad-request', `Content type not allowed (allowed: ${policy.types.join(', ')})`);
        }
        const url = await getSignedUrl(
          s3,
          new PutObjectCommand({
            Bucket: BUCKET,
            Key: objPath,
            ContentType: contentType || 'application/octet-stream',
          }),
          { expiresIn: 300 },
        );
        return { url, maxSize: policy.maxSize };
      }

      if (action === 'get') {
        const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: objPath }), { expiresIn: 3600 });
        return { url };
      }

      // delete
      if (!isSuperAdmin(caller) && !hasPermission(caller, 'employees.delete') && !hasPermission(caller, 'employees.edit')) {
        // owners can delete their own files
        const owner = objPath.split('/')[1];
        if (owner !== caller.uid && !objPath.startsWith(`selfies/${''}${caller.uid}`)) {
          throw new ApiError('permission-denied', 'Cannot delete this file');
        }
      }
      const url = await getSignedUrl(s3, new DeleteObjectCommand({ Bucket: BUCKET, Key: objPath }), { expiresIn: 60 });
      return { url };
    },
  },
];
