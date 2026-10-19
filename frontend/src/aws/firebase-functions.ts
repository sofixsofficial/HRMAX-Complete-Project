/**
 * `firebase/functions` compatibility module → REST API callables.
 */

export { httpsCallable } from './functions';

/** Sentinel — callables ignore it; httpsCallable(fn, name) does the work. */
export function getFunctions(_app?: unknown): unknown {
  return {};
}

/** No-op: AWS build has no emulator. */
export function connectFunctionsEmulator(): void {}
