import {
  collection,
  getDocs,
  query,
  where,
} from '../aws/firestore-compat';
import { db } from '../aws/clients';

export async function generateUniqueCode(
  collectionName: string,
  prefix: string,
  codeField: string = 'code',
  companyId?: string
): Promise<string> {
  const ref = collection(db, collectionName);

  let snapshot;
  if (companyId) {
    const q = query(ref, where('companyId', '==', companyId));
    snapshot = await getDocs(q);
  } else {
    snapshot = await getDocs(ref);
  }

  let maxNum = 0;
  snapshot.docs.forEach(doc => {
    const val = doc.data()[codeField] as string | undefined;
    if (val) {
      const match = val.match(/(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  });

  const suffix = String(maxNum + 1).padStart(4, '0');
  return `${prefix}-${suffix}`;
}

export async function generateUniqueId(
  collectionName: string,
  prefix: string,
  idField: string = 'employeeId',
  companyId?: string
): Promise<string> {
  return generateUniqueCode(collectionName, prefix, idField, companyId);
}
