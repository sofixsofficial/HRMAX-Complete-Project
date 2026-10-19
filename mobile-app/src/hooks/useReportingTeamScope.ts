import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

export interface ReportingTeamScope {
  loading: boolean;
  restricted: boolean;
  userIds: Set<string>;
  employeeIds: Set<string>;
  members: any[];
}

export function useReportingTeamScope(
  managerId?: string,
  companyId?: string | null,
  enabled = true
): ReportingTeamScope {
  const restricted = enabled && !!managerId;
  const [members, setMembers] = useState<any[]>([]);
  const [profileIds, setProfileIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(restricted);
  const synced = useRef(false);

  useEffect(() => {
    if (!restricted) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let finished = false;
    const finish = () => { if (!finished) { finished = true; setLoading(false); } };

    getDoc(doc(db, 'users', managerId))
      .then((snap) => {
        const ids = snap.exists() ? (snap.data()?.reportingEmployeeIds || []) : [];
        setProfileIds(Array.isArray(ids) ? ids : []);
      })
      .catch(() => setProfileIds([]));

    const colRef = collection(db, 'employees');
    const q = companyId ? query(colRef, where('companyId', '==', companyId)) : colRef;
    const unsub = onSnapshot(
      q,
      (snap) => {
        const emps = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as any);
        setMembers(emps.filter((e: any) => e.reportingManagerId === managerId || e.userId === managerId));
        finish();
      },
      () => finish()
    );
    return () => unsub();
  }, [managerId, companyId, restricted]);

  // Backfill the RM profile's reportingEmployeeIds once so it stays authoritative
  useEffect(() => {
    if (!restricted || loading || profileIds === null || synced.current) return;
    const ids = members.map((m) => m.id).filter(Boolean);
    const current = (profileIds || []).slice().sort().join(',');
    const next = ids.slice().sort().join(',');
    synced.current = true;
    if (current !== next) {
      updateDoc(doc(db, 'users', managerId), { reportingEmployeeIds: ids }).catch(() => {
        synced.current = false;
      });
    }
  }, [restricted, loading, profileIds, members, managerId]);

  const { userIds, employeeIds } = useMemo(() => {
    const u = new Set<string>();
    const e = new Set<string>();
    if (!restricted) return { userIds: u, employeeIds: e };
    const primary = profileIds && profileIds.length > 0;
    const effective = primary
      ? members.filter((m) => profileIds.includes(m.id) || profileIds.includes(m.userId))
      : members;
    effective.forEach((m) => {
      if (m.id) e.add(m.id);
      if (m.userId) u.add(m.userId);
      else if (m.id) u.add(m.id);
    });
    return { userIds: u, employeeIds: e };
  }, [restricted, members, profileIds]);

  return { loading, restricted, userIds, employeeIds, members };
}
