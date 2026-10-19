/**
 * AWS config for the HR MAX clients (web).
 * Set these in frontend/.env — values come from `sam deploy` outputs.
 */

export const AWS_CONFIG = {
  region: import.meta.env.VITE_AWS_REGION ?? 'us-east-1',
  userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? '',
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? '',
  apiUrl: import.meta.env.VITE_API_URL ?? '',
  filesBucketUrl: import.meta.env.VITE_FILES_BUCKET_URL ?? '',
};

export const isAwsConfigured = Boolean(AWS_CONFIG.userPoolId && AWS_CONFIG.apiUrl);
