/**
 * `firebase/firestore` compatibility module → REST API + polling.
 * Exact export surface used by the HR MAX frontend.
 */

export {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  onSnapshot,
  invalidateSnapshots,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  deleteField,
  Timestamp,
  FirestoreError,
  Query,
  CollectionReference,
  DocumentReference,
  QueryConstraint,
  type WhereFilterOp,
  type QuerySnapshot,
  type QueryDocumentSnapshot,
  type DocumentSnapshot,
  type DocumentData,
  type FieldValue,
  type SnapshotMetadata,
  type SnapshotOptions,
  type SnapshotListenOptions,
  type Unsubscribe,
} from './firestore';

/** Sentinel — the app's config.ts calls getFirestore(app); collection/doc ignore it. */
export function getFirestore(_app?: unknown): unknown {
  return {};
}

/** No-op: AWS build has no emulator. */
export function connectFirestoreEmulator(): void {}

/**
 * writeBatch — Firestore batch semantics over sequential REST calls.
 * (Used by companyService + emailService for multi-doc writes.)
 */
export function writeBatch(_db: unknown) {
  interface Op {
    run(): Promise<void>;
  }
  const ops: Op[] = [];
  return {
    set(
      ref: { id: string; _path: string },
      data: Record<string, unknown>,
      _opts?: { merge?: boolean },
    ) {
      ops.push({
        run: async () => {
          const { setDoc } = await import('./firestore');
          const { DocumentReference } = await import('./firestore');
          await setDoc(new DocumentReference(ref.id, ref._path), data, { merge: true });
        },
      });
    },
    update(ref: { id: string; _path: string }, data: Record<string, unknown>) {
      ops.push({
        run: async () => {
          const { updateDoc, DocumentReference } = await import('./firestore');
          await updateDoc(new DocumentReference(ref.id, ref._path), data);
        },
      });
    },
    delete(ref: { id: string; _path: string }) {
      ops.push({
        run: async () => {
          const { deleteDoc, DocumentReference } = await import('./firestore');
          await deleteDoc(new DocumentReference(ref.id, ref._path));
        },
      });
    },
    async commit(): Promise<void> {
      for (const op of ops) await op.run();
    },
  };
}
