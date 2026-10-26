/**
 * Fixed-window rate limiter backed by DynamoDB (atomic ADD) — accurate across
 * concurrent Lambda instances, unlike in-memory counters.
 *
 * Used on the public/credential-sensitive auth routes (forgot-password,
 * reset-password, verify-reset-code, accept-invite, change-password) for
 * brute-force and code-spam protection. Counter rows are tiny and expire via
 * the table's TTL attribute (best-effort when TTL is not enabled).
 */

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { doc, TABLE } from './db.js';
import { ApiError } from './types.js';

export async function enforceRateLimit(bucket: string, limit: number, windowSeconds: number): Promise<void> {
  // Test escape hatch: `node --test` runs these auth routes repeatedly inside a
  // single fixed window, so the live counter returned 429 where the test asserts
  // 400. Tests must exercise validation, not the throttle.
  if (process.env.HRMAX_DISABLE_RATE_LIMIT === '1') return;
  const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
  const res = await doc.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: `RATELIMIT#${bucket}#${windowId}`, SK: 'COUNT' },
      UpdateExpression: 'ADD #c :one SET #ttl = :ttl',
      ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':one': 1,
        ':ttl': Math.floor(Date.now() / 1000) + windowSeconds * 2,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );
  const count = Number(res.Attributes?.count ?? 1);
  if (count > limit) {
    throw new ApiError('resource-exhausted', 'Too many requests. Please wait a moment and try again.');
  }
}
