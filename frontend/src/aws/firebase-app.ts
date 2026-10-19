/**
 * `firebase/app` compatibility module → AWS build.
 * Only the tiny surface the app uses: initializeApp + FirebaseApp type.
 */

export interface FirebaseApp {
  name: string;
  options: Record<string, unknown>;
}

export function initializeApp(options?: Record<string, unknown>, name = '[DEFAULT]'): FirebaseApp {
  return { name, options: options ?? {} };
}

export default initializeApp;
