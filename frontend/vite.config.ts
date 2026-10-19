import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// AWS migration: every `firebase/*` import resolves to the local AWS
// compatibility shim (Cognito + REST API + S3) instead of the Firebase SDK.
// App code stays untouched — only the import target changes.
const firebaseShims = {
  'firebase/app': path.resolve(__dirname, 'src/aws/firebase-app.ts'),
  'firebase/auth': path.resolve(__dirname, 'src/aws/firebase-auth.ts'),
  'firebase/firestore': path.resolve(__dirname, 'src/aws/firebase-firestore.ts'),
  'firebase/functions': path.resolve(__dirname, 'src/aws/firebase-functions.ts'),
  'firebase/storage': path.resolve(__dirname, 'src/aws/firebase-storage.ts'),
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: firebaseShims,
  },
  optimizeDeps: {
    // firebase SDK no longer ships in the bundle — shims are local modules
    include: [],
    exclude: [],
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
})
