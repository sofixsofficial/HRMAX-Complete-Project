import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot } from '../aws/firestore-compat';
import { db } from '../aws/clients';
import { useReportingTeamScope } from './useReportingTeamScope';
import { isActiveMissedPunchRecord, isWithinRecentWindow, recentMissPunchSinceDate } from '../utils/attendanceStatus';

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
  /** Active missed punches across self + assigned employees (web parity). */
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
  // Active (unresolved) missed punches across THIS manager's world — their own
  // punches plus every assigned employee's, within the 14-day look-back
  // window (covers the 2-working-day correction window + slow tier approvals).
  // Web RM dashboard parity: same self+team scope, same window predicate.
  const missPunchPending = useMemo(
    () => attendance.filter((r) =>
      isActiveMissedPunchRecord(r) &&
      isWithinRecentWindow(r, recentMissPunchSinceDate()) &&
      (scope.userIds.has(r.userId) || r.userId === managerId)
    ).length,
    [attendance, scope.userIds, managerId]
  );
  const activeTasks = useMemo(
    () => tasks.filter((t) => (t.status === 'Pending' || t.status === 'In Progress') && (scope.userIds.has(t.assignedToId) || scope.userIds.has(t.assignedTo))).length,
    [tasks, scope.userIds]
  );

  return { loading: scope.loading || dataLoading, directReports, presentToday, missPunchPending, pendingLeaves, activeTasks };
}
