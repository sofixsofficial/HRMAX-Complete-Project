/**
 * Metro config — standard Expo defaults. The app talks to AWS directly
 * (Cognito + API Gateway REST + S3) via `src/aws/*` modules; there is no
 * import aliasing layer anymore.
 */

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

module.exports = config;
