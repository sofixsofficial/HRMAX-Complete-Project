/**
 * Metro config — AWS migration.
 * All `firebase/*` imports resolve to the local AWS compatibility shims
 * (Cognito + REST API + S3). App code stays untouched.
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const shims = {
  'firebase/app': path.resolve(__dirname, 'src/aws/firebase-app.ts'),
  'firebase/auth': path.resolve(__dirname, 'src/aws/firebase-auth.ts'),
  'firebase/firestore': path.resolve(__dirname, 'src/aws/firebase-firestore.ts'),
  'firebase/functions': path.resolve(__dirname, 'src/aws/firebase-functions.ts'),
  'firebase/storage': path.resolve(__dirname, 'src/aws/firebase-storage.ts'),
};

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (shims[moduleName]) {
    return { type: 'sourceFile', filePath: shims[moduleName] };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
