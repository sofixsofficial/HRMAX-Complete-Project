/**
 * Read-only inventory: counts every DynamoDB entity + lists users/companies.
 * Usage: node scripts/inventory.mjs   (cwd = backend/aws, reads TABLE_NAME)
 */
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const TABLE = process.env.TABLE_NAME ?? 'HRMAX';
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'ap-southeast-2';
const ddb = new DynamoDBClient({ region: REGION });

async function scanAll() {
  const out = [];
  let start;
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE,
      ExclusiveStartKey: start,
      ProjectionExpression: 'entity, #i, email, role, companyId, PK, SK',
      ExpressionAttributeNames: { '#i': 'id' },
    }));
    out.push(...(res.Items ?? []).map((i) => unmarshall(i)));
    start = res.LastEvaluatedKey;
  } while (start);
  return out;
}

const items = await scanAll();
const byEntity = {};
for (const it of items) {
  const key = it.entity ?? it.PK?.split('#')[0] ?? 'unknown';
  byEntity[key] = (byEntity[key] ?? 0) + 1;
}
console.log('TOTAL', items.length);
console.log(JSON.stringify(Object.fromEntries(Object.entries(byEntity).sort((a, b) => b[1] - a[1])), null, 0));
console.log('--- USERS ---');
for (const it of items.filter((x) => x.email && x.role)) {
  console.log(`${it.role}\t${it.email}\tcompany=${it.companyId ?? '-'}\tid=${it.id ?? it.SK}`);
}
console.log('--- COMPANIES ---');
for (const it of items.filter((x) => x.entity === 'company')) {
  console.log(`${it.id}\t${it.name ?? ''}`);
}
