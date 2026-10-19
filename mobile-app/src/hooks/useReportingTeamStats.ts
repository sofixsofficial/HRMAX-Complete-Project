import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useReportingTeamScope } from './useReportingTeamScope';
import { isActiveMissedPunchRecord, isWithinRecentWindow, recentMissPunchSinceDate } from '../utils/attendanceStatus';
import { getActionableMissedPunchTier } from '../services/attendanceApi';

function buildScopedQuery(collectionName: string, companyId?: string | null) {
  const colRef = collection(db, collectionName);
  if (companyId) return query(colRef, where('companyId', '==', companyId));
  return colRef;
}

function isTodayDate(v: any): boolean {
  if (!v) return false;
  const d = v?.toDate ? v.toDate() : new Date(v);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

export interface ReportingTeamStats {
  loading: boolean;
  directReports: number;
  presentToday: number;
  /** Active missed punches awaiting THIS manager's tier decision (web parity). */
  missPunchPending: number;
  pendingLeaves: number;
  activeTasks: number;
}

export function useReportingTeamStats(managerId?: string, companyId?: string | null, refreshKey?: number, role?: string): ReportingTeamStats {
  const scope = useReportingTeamScope(managerId, companyId, true);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    setDataLoading(true);
    let done = 0;
    const mark = () => { done += 1; if (done >= 3) setDataLoading(false); };
    const unsubs: (() => void)[] = [];
    const listen = (ref: any, onNext: (snap: any) => void) => {
      let finished = false;
      const finish = () => { if (!finished) { finished = true; mark(); } };
      const unsub = onSnapshot(ref, (snap: any) => { finish(); onNext(snap); }, () => finish());
      unsubs.push(unsub);
    };

    listen(buildScopedQuery('leaveRequests', companyId), (snap) => setLeaves(snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))));
    listen(buildScopedQuery('attendance', companyId), (snap) => setAttendance(snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))));
    listen(buildScopedQuery('tasks', companyId), (snap) => setTasks(snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))));

    const timeout = setTimeout(() => setDataLoading(false), 15000);
    return () => {
      clearTimeout(timeout);
      unsubs.forEach((u) => { try { u(); } catch {} });
    };
  }, [companyId, refreshKey]);

  const directReports = scope.members.length;
  const pendingLeaves = useMemo(
    () => leaves.filter((l) => l.status === 'Pending' && scope.userIds.has(l.userId)).length,
    [leaves, scope.userIds]
  );
  const presentToday = useMemo(
    () => attendance.filter((r) => (r.status === 'Present' || r.status === 'Late') && scope.userIds.has(r.userId) && isTodayDate(r.date)).length,
    [attendance, scope.userIds]
  );
  // Active (unresolved) missed punches awaiting THIS manager's decision —
  // same rule as the web RM dashboard: within the 14-day look-back window AND
  // the next pending verification tier is stamped to this manager (or their
  // natural role for legacy records). The old "today-only + status === Miss
  // Punch" filter always showed 0 because pending rectifications live on
  // previous days' records.
  const missPunchPending = useMemo(
    () => attendance.filter((r) =>
      isActiveMissedPunchRecord(r) &&
      isWithinRecentWindow(r, recentMissPunchSinceDate()) &&
      getActionableMissedPunchTier(r, managerId || '', role, companyId ? [companyId] : []) !== null
    ).length,
    [attendance, managerId, role, companyId]
  );
  const activeTasks = useMemo(
    () => tasks.filter((t) => (t.status === 'Pending' || t.status === 'In Progress') && (scope.userIds.has(t.assignedToId) || scope.userIds.has(t.assignedTo))).length,
    [tasks, scope.userIds]
  );

  return { loading: scope.loading || dataLoading, directReports, presentToday, missPunchPending, pendingLeaves, activeTasks };
}
