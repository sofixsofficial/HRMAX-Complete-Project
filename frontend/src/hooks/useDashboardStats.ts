import { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot, doc, type FirestoreError } from '../aws/firestore-compat';
import { auth, db } from '../aws/clients';
import { isDate } from '../utils/dateUtils';
import { isActiveMissedPunchRecord, isWithinRecentWindow, recentMissPunchSinceDate } from '../utils/attendanceStatus';
import { buildScopedQuery } from '../services/scopedQueries';
import { useAuth } from '../context/AuthContext';

export interface DashboardStats {
  totalCompanies: number;
  activeCompanies: number;
  totalEmployees: number;
  activeEmployees: number;
  inactiveEmployees: number;
  totalExecutives: number;
  totalTeamLeaders: number;
  presentToday: number;
  absentToday: number;
  lateToday: number;
  onLeaveToday: number;
  missPunchToday: number;
  missPunchApprovals: number;
  approvedAttendanceToday: number;
  attendanceRate: number;
  pendingLeaves: number;
  pendingLeaveApprovals: number;
  totalLeaveRequests: number;
  approvedLeaves: number;
  rejectedLeaves: number;
  salaryGenerated: number;
  pendingTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  upcomingHolidays: number;
  todayBirthdays: number;
  activeDepartments: number;
  totalAssets: number;
  totalRoles: number;
  activeRoles: number;
}

export interface DashboardRecords {
  employees: any[];
  attendanceToday: any[];
  missPunchRecords: any[];
  leaves: any[];
  companies: any[];
  tasks: any[];
}

const emptyRecords: DashboardRecords = { employees: [], attendanceToday: [], missPunchRecords: [], leaves: [], companies: [], tasks: [] };

const initialStats: DashboardStats = {
  totalCompanies: 0, activeCompanies: 0,
  totalEmployees: 0, activeEmployees: 0, inactiveEmployees: 0,
  totalExecutives: 0, totalTeamLeaders: 0,
  presentToday: 0, absentToday: 0, lateToday: 0, onLeaveToday: 0,
  missPunchToday: 0, missPunchApprovals: 0, approvedAttendanceToday: 0,
  attendanceRate: 0, pendingLeaves: 0, pendingLeaveApprovals: 0,
  totalLeaveRequests: 0, approvedLeaves: 0, rejectedLeaves: 0, salaryGenerated: 0,
  pendingTasks: 0, completedTasks: 0, inProgressTasks: 0,
  upcomingHolidays: 0, todayBirthdays: 0,
  activeDepartments: 0,
  totalAssets: 0, totalRoles: 0, activeRoles: 0,
};

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
}

function getDateValue(value: any): Date | null {
  if (!value) return null;
  if (isDate(value)) return value;
  if (value.toDate) return value.toDate();
  if (typeof value === 'string') return new Date(value);
  return null;
}

// Firestore caps `in` at 10 values, so split into chunked queries and merge.
function chunkArray<T>(arr: T[], size = 10): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function useDashboardStats(companyId?: string | string[] | null): DashboardStats & { loading: boolean; records: DashboardRecords } {
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [records, setRecords] = useState<DashboardRecords>(emptyRecords);
  const [loading, setLoading] = useState(true);
  const loadedCount = useRef(0);
  const expectedListeners = useRef(0);

  const markLoaded = () => {
    loadedCount.current += 1;
    if (expectedListeners.current > 0 && loadedCount.current >= expectedListeners.current) {
      setLoading(false);
    }
  };

  const { user } = useAuth();

  useEffect(() => {
    if (!auth.currentUser || !user) {
      setLoading(true);
      return;
    }

    loadedCount.current = 0;
    expectedListeners.current = 0;
    setRecords(emptyRecords);
    const now = new Date();

    const companyIds = Array.isArray(companyId) ? companyId : (companyId ? [companyId] : []);

    // Listen to a scoped collection across any number of company ids without
    // silently dropping companies beyond 10. Splits the id list into chunks
    // (Firestore `in` limit) and merges results, deduping by document id.
    // Role scoping (employee/RM/company-admin/master-admin) is still applied
    // per chunk via buildScopedQuery, exactly as for the single-query path.
    const listenScopedCollection = (
      collectionName: string,
      ids: string[],
      onDocs: (docs: any[]) => void,
    ) => {
      expectedListeners.current += 1;
      // null chunk = no company constraint → rely on role scoping only
      const chunks: (string[] | null)[] = ids.length === 0 ? [null] : chunkArray(ids);
      const cache: (any[] | null)[] = chunks.map(() => null);
      const docMap: Record<string, any> = {};
      let reported = false;
      const report = () => {
        if (cache.every(c => c !== null)) {
          if (!reported) { reported = true; markLoaded(); }
          onDocs(Object.values(docMap));
        }
      };
      const unsubs = chunks.map((chunk, idx) => {
        const ref = buildScopedQuery({
          collectionName,
          user,
          companyIds: chunk ? chunk : undefined,
        });
        const snapHandler = (snap: any) => {
          const arr = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          cache[idx] = arr;
          arr.forEach((d: any) => { docMap[d.id] = d; });
          report();
        };
        return onSnapshot(
          ref,
          snapHandler,
          (err: FirestoreError) => {
            console.error(`[useDashboardStats] ${collectionName} chunk error:`, err?.message || err);
            cache[idx] = cache[idx] ?? [];
            report();
          },
        );
      });
      return () => unsubs.forEach(unsub => { try { unsub() } catch {} });
    };

    // Companies are keyed by their document id. Management dashboards scope the
    // query to an explicit id list. A `where('__name__','in',...)` list query is
    // denied by the Firestore rules for scoped roles, so we attach one
    // per-document listener (a `get`-style read, allowed via canReadCompany)
    // for each id. When there is no id constraint (unrestricted roles only), we
    // fall back to a collection list query.
    // True when the current role may globally list all companies (e.g. no
    // company-scope constraint). Master-admins and company-admins always can;
    // executives/team-leaders only when their companies permission is 'all'
    // (full scope), never under an 'assigned' scope.
    const canListAllCompanies = (): boolean => {
      if (!user) return false;
      if (user.role === 'master-admin' || user.role === 'company-admin') return true;
      if (user.role === 'executive' || user.role === 'team-leader') {
        return user.permissionScopes?.companies !== 'assigned';
      }
      return false;
    };

    const listenScopedCompanies = (ids: string[], onDocs: (docs: any[]) => void) => {
      expectedListeners.current += 1;
      if (ids.length === 0) {
        // Scoped roles must NOT attempt a global companies list query (the
        // rules deny it and it surfaces as a permissions error). When the user
        // has no company constraint but also no global-listing right, report an
        // empty result instead of firing a denied query.
        if (!canListAllCompanies()) {
          markLoaded();
          onDocs([]);
          return () => {};
        }
        const unsub = onSnapshot(
          collection(db, 'companies'),
          (snap: any) => {
            const arr = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
            markLoaded();
            onDocs(arr);
          },
          (err: FirestoreError) => {
            console.warn('[useDashboardStats] companies chunk error:', err?.message || err);
            markLoaded();
            onDocs([]);
          },
        );
        return unsub;
      }

      const uniqueIds = [...new Set(ids)];
      const cache: Record<string, boolean> = {};
      const docMap: Record<string, any> = {};
      let reported = false;
      const tryReport = () => {
        if (uniqueIds.every(id => cache[id])) {
          if (!reported) { reported = true; markLoaded(); }
          onDocs(Object.values(docMap));
        }
      };
      const unsubs = uniqueIds.map((id) =>
        onSnapshot(
          doc(db, 'companies', id),
          (snap: any) => {
            cache[id] = true;
            if (snap.exists()) docMap[id] = { id, ...snap.data() };
            else delete docMap[id];
            tryReport();
          },
          (err: FirestoreError) => {
            console.error(`[useDashboardStats] company get error (${id}):`, err?.message || err);
            cache[id] = true;
            delete docMap[id];
            tryReport();
          },
        ),
      );
      return () => unsubs.forEach(unsub => { try { unsub() } catch {} });
    };

    const unsubscribers: (() => void)[] = [];

    const unsubCompanies = listenScopedCompanies(companyIds, (docs) => {
      setRecords(prev => ({ ...prev, companies: docs }));
      setStats(prev => ({
        ...prev,
        totalCompanies: docs.length,
        activeCompanies: docs.filter((d: any) => d.status === 'Active').length,
        totalEmployees: docs.length > 0 ? prev.totalEmployees : 0,
      }));
    });
    unsubscribers.push(unsubCompanies);

    const unsubEmployees = listenScopedCollection('employees', companyIds, (docs) => {
      setRecords(prev => ({ ...prev, employees: docs }));
      const todayBirthdays = docs.filter((e: any) => {
        if (!e.birthDate && !e.dob) return false;
        const dob = getDateValue(e.birthDate || e.dob);
        if (!dob) return false;
        return dob.getMonth() === now.getMonth() && dob.getDate() === now.getDate();
      }).length;

      setStats(prev => ({
        ...prev,
        totalEmployees: docs.length,
        activeEmployees: docs.filter((d: any) => d.status === 'Active').length,
        inactiveEmployees: docs.filter((d: any) => d.status === 'Inactive').length,
        totalExecutives: docs.filter((d: any) => d.role === 'executive' || d.designation?.toLowerCase().includes('executive')).length,
        totalTeamLeaders: docs.filter((d: any) => d.role === 'team-leader' || d.designation?.toLowerCase().includes('team leader') || d.designation?.toLowerCase().includes('team lead')).length,
        todayBirthdays,
        onLeaveToday: docs.filter((d: any) => d.status === 'On Leave').length,
      }));
    });
    unsubscribers.push(unsubEmployees);

    const unsubAttendance = listenScopedCollection('attendance', companyIds, (docs) => {
      const todayStr = now.toISOString().split('T')[0];

      const todayRecords = docs.filter((d: any) => {
        const date = d.date;
        if (!date) return false;
        if (typeof date === 'string') return date.startsWith(todayStr);
        const dDate = getDateValue(date);
        return dDate ? isToday(dDate) : false;
      });

      const present = todayRecords.filter((d: any) => d.status === 'Present').length;
      const absent = todayRecords.filter((d: any) => d.status === 'Absent').length;
      const late = todayRecords.filter((d: any) => d.status === 'Late').length;

      setRecords(prev => ({ ...prev, attendanceToday: todayRecords }));
      const missPunchRecords = docs.filter((d: any) =>
        isActiveMissedPunchRecord(d) && isWithinRecentWindow(d, recentMissPunchSinceDate(now))
      );
      setRecords(prev => ({ ...prev, missPunchRecords }));
      // Queue-aligned KPI: counts every record the management queue lists
      // under `status=Miss Punch` (matches the Attendance page's Miss Punch
      // tab and pill) within the active company scope — role-independent.
      const missPunchApprovals = docs.filter((d: any) => d.status === 'Miss Punch').length;
      setStats(prev => ({
        ...prev,
        presentToday: present,
        absentToday: absent,
        lateToday: late,
        missPunchToday: missPunchRecords.length,
        missPunchApprovals,
        approvedAttendanceToday: todayRecords.filter((d: any) => d.status === 'Approved').length,
        attendanceRate: todayRecords.length > 0
          ? Math.round(((present + late) / todayRecords.length) * 100)
          : 0,
      }));
    });
    unsubscribers.push(unsubAttendance);

    const unsubLeaves = listenScopedCollection('leaveRequests', companyIds, (docs) => {
      setRecords(prev => ({ ...prev, leaves: docs }));
      setStats(prev => ({
        ...prev,
        pendingLeaves: docs.filter((d: any) => d.status === 'Pending').length,
        // Queue-aligned KPI: counts every Pending request the Leaves management
        // queue lists under `status=Pending` (matches the Leaves page Pending
        // tab) within the active company scope — role-independent.
        pendingLeaveApprovals: docs.filter((d: any) => d.status === 'Pending').length,
        totalLeaveRequests: docs.length,
        approvedLeaves: docs.filter((d: any) => d.status === 'Approved').length,
        rejectedLeaves: docs.filter((d: any) => d.status === 'Rejected').length,
      }));
    });
    unsubscribers.push(unsubLeaves);

    const unsubSalary = listenScopedCollection('salarySlips', companyIds, (docs) => {
      setStats(prev => ({ ...prev, salaryGenerated: docs.length }));
    });
    unsubscribers.push(unsubSalary);

    const unsubTasks = listenScopedCollection('tasks', companyIds, (docs) => {
      setRecords(prev => ({ ...prev, tasks: docs }));
      setStats(prev => ({
        ...prev,
        pendingTasks: docs.filter((d: any) => d.status === 'Pending').length,
        inProgressTasks: docs.filter((d: any) => d.status === 'In Progress' || d.status === 'inProgress').length,
        completedTasks: docs.filter((d: any) => d.status === 'Completed' || d.status === 'done').length,
      }));
    });
    unsubscribers.push(unsubTasks);

    const unsubHolidays = listenScopedCollection('holidays', companyIds, (docs) => {
      // Match the HolidayCalendar destination (current calendar year) so the
      // card count equals the list it opens.
      const upcoming = docs.filter((d: any) => {
        const date = getDateValue(d.date);
        return date ? date.getFullYear() === now.getFullYear() : false;
      }).length;
      setStats(prev => ({ ...prev, upcomingHolidays: upcoming }));
    });
    unsubscribers.push(unsubHolidays);

    const unsubDepartments = listenScopedCollection('departments', companyIds, (docs) => {
      // Match the Departments destination (shows all departments) so the card
      // count equals the list it opens.
      setStats(prev => ({
        ...prev,
        activeDepartments: docs.length,
      }));
    });
    unsubscribers.push(unsubDepartments);

    const unsubAssets = listenScopedCollection('assets', companyIds, (docs) => {
      setStats(prev => ({ ...prev, totalAssets: docs.length }));
    });
    unsubscribers.push(unsubAssets);

    const unsubRoles = listenScopedCollection('roles', companyIds, (docs) => {
      setStats(prev => ({
        ...prev,
        totalRoles: docs.length,
        activeRoles: docs.filter((d: any) => d.isActive !== false).length,
      }));
    });
    unsubscribers.push(unsubRoles);

    const timeout = setTimeout(() => {
      if (loadedCount.current < expectedListeners.current) {
        console.warn(`[useDashboardStats] ${expectedListeners.current - loadedCount.current} listener(s) never fired after 15s`);
        loadedCount.current = expectedListeners.current;
        setLoading(false);
      }
    }, 15000);

    return () => {
      clearTimeout(timeout);
      unsubscribers.forEach(unsub => { try { unsub() } catch {} });
    };
  }, [companyId]);

  return { ...stats, loading, records };
}
