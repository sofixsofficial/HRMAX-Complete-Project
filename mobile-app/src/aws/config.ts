/**
 * AWS config for the HR MAX mobile app.
 * Set via EXPO_PUBLIC_* env vars (app.json extra or .env).
 *
 * The fallbacks below are the REAL production values, not placeholders.
 * CI builds (GitHub Actions `Build APK`) never see the gitignored .env, so a
 * build without fallbacks shipped apiUrl='', clientId='' and the wrong
 * region ('us-east-1') — Cognito InitiateAuth then failed and the app could
 * not sign in AT ALL. These values are public client config (they ship inside
 * every APK / web bundle anyway, never secrets), so inlining them as
 * defaults makes EVERY build path (CI, local, EAS) work out of the box while
 * .env / EXPO_PUBLIC_* still override when present.
 */

// Expo inlines EXPO_PUBLIC_* variables from .env at bundle time. Declared
// module-scoped so the shim typechecks without pulling in @types/node.
declare const process: { env: Record<string, string | undefined> };

export const AWS_CONFIG = {
  region: process.env.EXPO_PUBLIC_AWS_REGION ?? 'ap-southeast-2',
  userPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID ?? 'ap-southeast-2_DUe0sfFOx',
  clientId: process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID ?? '3ginli5f52pf07c46ltgrq0rvc',
  apiUrl: (process.env.EXPO_PUBLIC_API_URL ?? 'https://u2y0p4665a.execute-api.ap-southeast-2.amazonaws.com').replace(/\/$/, ''),
  filesBucketUrl: process.env.EXPO_PUBLIC_FILES_BUCKET_URL ?? 'https://hrmax-files-549243453699.s3.ap-southeast-2.amazonaws.com',
};
