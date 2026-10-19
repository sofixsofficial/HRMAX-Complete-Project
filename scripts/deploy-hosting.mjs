#!/usr/bin/env node
/**
 * Deploy the web build (frontend/dist) to the S3 bucket behind CloudFront.
 *
 * Reads stack outputs from CloudFormation (stack name via HRMAX_STACK, default
 * "hrmax-api" — must match the --stack-name used with `sam deploy`).
 *
 * Usage:  npm run deploy:hosting          (builds first, then runs this)
 * Requires: AWS CLI configured (aws configure) with permissions for S3 + CloudFront.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STACK = process.env.HRMAX_STACK ?? 'hrmax-api';
const REGION = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'dist');

function aws(cmd) {
  const region = REGION ? ` --region ${REGION}` : '';
  return execSync(`aws ${cmd}${region}`, { encoding: 'utf8' }).trim();
}

if (!existsSync(distDir)) {
  console.error(`✗ No build found at ${distDir} — run \`npm run build\` first.`);
  process.exit(1);
}

console.log(`Reading outputs from stack "${STACK}"…`);
let outputs;
try {
  const raw = aws(
    `cloudformation describe-stacks --stack-name ${STACK} --query "Stacks[0].Outputs" --output json`,
  );
  outputs = Object.fromEntries(JSON.parse(raw).map((o) => [o.OutputKey, o.OutputValue]));
} catch (e) {
  console.error(`✗ Could not read stack outputs for "${STACK}". Is the stack deployed?\n${e.message}`);
  process.exit(1);
}

const bucket = outputs.WebBucketName;
const cloudFrontUrl = outputs.CloudFrontUrl ?? '';
// Prefer the dedicated output; fall back to parsing CloudFrontUrl for stacks
// deployed before the CloudFrontDistributionId output existed (legacy
// ID-shaped urls like https://EXAMPLEID.cloudfront.net).
const distributionId =
  outputs.CloudFrontDistributionId ??
  (/^https:\/\/([A-Z0-9]{8,})\.cloudfront\.net/.exec(cloudFrontUrl)?.[1]);

if (!bucket) {
  console.error('✗ Stack has no WebBucketName output.');
  process.exit(1);
}

console.log(`Syncing ${distDir} → s3://${bucket} …`);
aws(`s3 sync "${distDir}" s3://${bucket} --delete`);

if (distributionId) {
  console.log(`Invalidating CloudFront distribution ${distributionId} …`);
  aws(`cloudfront create-invalidation --distribution-id ${distributionId} --paths "/*"`);
  console.log(`✓ Deployed. Site: ${cloudFrontUrl}`);
} else {
  console.log(`✓ Uploaded to s3://${bucket} (could not derive distribution id from CloudFrontUrl "${cloudFrontUrl}" — invalidate manually).`);
}
