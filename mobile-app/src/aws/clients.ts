/**
 * Shared client instances handed through app code — `doc(db, …)`,
 * `auth.currentUser`, `httpsCallable(functions, …)`, `ref(storage, …)`.
 * These are inert sentinels: the compat modules do all real work over
 * Amazon Cognito + API Gateway REST + S3. (No Firebase involved.)
 */
import { getAuth } from './auth-compat';
import { getFirestore } from './firestore-compat';
import { getFunctions } from './functions-compat';
import { getStorage } from './storage-compat';

export const auth = getAuth();
export const db = getFirestore();
export const functions = getFunctions();
export const storage = getStorage();
