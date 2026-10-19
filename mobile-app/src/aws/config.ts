/**
 * AWS config for the HR MAX mobile app.
 * Set via EXPO_PUBLIC_* env vars (app.json extra or .env).
 */

// Expo inlines EXPO_PUBLIC_* variables from .env at bundle time. Declared
// module-scoped so the shim typechecks without pulling in @types/node.
declare const process: { env: Record<string, string | undefined> };

export const AWS_CONFIG = {
  region: process.env.EXPO_PUBLIC_AWS_REGION ?? 'us-east-1',
  userPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID ?? '',
  clientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID ?? '',
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, ''),
  filesBucketUrl: process.env.EXPO_PUBLIC_FILES_BUCKET_URL ?? '',
};
