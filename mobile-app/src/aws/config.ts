/**
 * AWS config for the HR MAX mobile app.
 * Set via EXPO_PUBLIC_* env vars (app.json extra or .env).
 */

export const AWS_CONFIG = {
  region: process.env.EXPO_PUBLIC_AWS_REGION ?? 'us-east-1',
  userPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID ?? '',
  clientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID ?? '',
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, ''),
  filesBucketUrl: process.env.EXPO_PUBLIC_FILES_BUCKET_URL ?? '',
};
