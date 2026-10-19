import { initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableMultiTabIndexedDbPersistence } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = Constants.expoConfig?.extra ?? {};

const firebaseConfig = {
  apiKey: extra.firebaseApiKey || process.env.EXPO_PUBLIC_FIREBASE_API_KEY || '',
  authDomain: extra.firebaseAuthDomain || process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  projectId: extra.firebaseProjectId || process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: extra.firebaseStorageBucket || process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: extra.firebaseMessagingSenderId || process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: extra.firebaseAppId || process.env.EXPO_PUBLIC_FIREBASE_APP_ID || '',
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);

if (Platform.OS !== 'web') {
  enableMultiTabIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('[Firebase] Persistence failed: multiple tabs open');
    } else if (err.code === 'unimplemented') {
      console.warn('[Firebase] Persistence not supported');
    }
  });
}

export default app;
