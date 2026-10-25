/**
 * `firebase/firestore` compatibility (mobile) â†’ REST API + polling.
 */

export {
  collection,
  doc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  getDoc,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  invalidateSnapshots,
  serverTimestamp,
  deleteField,
  Timestamp,
  FirestoreError,
  enableMultiTabIndexedDbPersistence,
  Query,
  CollectionReference,
  DocumentReference,
  type QueryConstraint,
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

export function getFirestore(_app?: unknown): unknown {
  return {};
}

export function writeBatch(_db: unknown) {
  interface Op {
    run(): Promise<void>;
  }
  const ops: Op[] = [];
  return {
    set(ref: { id: string; _path: string }, data: Record<string, unknown>) {
      ops.push({
        run: async () => {
          const { setDoc, DocumentReference } = await import('./firestore');
          await setDoc(new DocumentReference(ref.id, ref._path), data);
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
