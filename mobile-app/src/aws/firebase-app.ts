export interface FirebaseApp {
  name: string;
  options: Record<string, unknown>;
}

export function initializeApp(options?: Record<string, unknown>, name = '[DEFAULT]'): FirebaseApp {
  return { name, options: options ?? {} };
}
