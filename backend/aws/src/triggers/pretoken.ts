/**
 * Cognito PreTokenGeneration trigger — injects custom:role / custom:companyId
 * claims from the users table into every issued JWT (parity with Firebase
 * setCustomUserClaims). Runs on refresh too so role changes propagate within
 * one token lifetime.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME ?? 'HRMAX';

export const handler = async (event: {
  request: { userAttributes: Record<string, string> };
  response: { claimsOverrideDetails?: Record<string, unknown> };
}) => {
  const uid = event.request.userAttributes.sub;
  try {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { PK: `USER#${uid}`, SK: 'PROFILE' } }));
    const doc_ = res.Item?.data as Record<string, unknown> | undefined;
    if (doc_) {
      event.response.claimsOverrideDetails = {
        claimsToAddOrOverride: {
          role: String(doc_.role ?? 'employee'),
          companyId: String(doc_.companyId ?? ''),
        },
      };
    }
  } catch (err) {
    console.error('pretoken lookup failed', err);
  }
  return event;
};
