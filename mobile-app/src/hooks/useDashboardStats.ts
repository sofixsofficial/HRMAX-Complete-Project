import { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot, doc } from '../aws/firestore-compat';
import { db } from '../aws/clients';
import { useAuth } from '../context/AuthContext';
import { isActiveMissedPunchRecord, isWithinRecentWindow, recentMissPunchSinceDate } from '../utils/attendanceStatus';

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
  attendanceRate: number | null;
  pendingLeaves: number;
  totalLeaveRequests: number;
  approvedLeaves: number;
  rejectedLeaves: number;
  approvedAttendanceToday: number;
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
  totalAnnouncements: number;
  missPunchToday: number;
}

const initialStats: DashboardStats = {
  totalCompanies: 0, activeCompanies: 0,
  totalEmployees: 0, activeEmployees: 0, inactiveEmployees: 0,
  totalExecutives: 0, totalTeamLeaders: 0,
  presentToday: 0, absentToday: 0, lateToday: 0, onLeaveToday: 0,
  attendanceRate: null, pendingLeaves: 0,
  totalLeaveRequests: 0, approvedLeaves: 0, rejectedLeaves: 0,
  approvedAttendanceToday: 0, salaryGenerated: 0,
  pendingTasks: 0, completedTasks: 0, inProgressTasks: 0,
  upcomingHolidays: 0, todayBirthdays: 0,
  activeDepartments: 0,
  totalAssets: 0, totalRoles: 0, activeRoles: 0,
  totalAnnouncements: 0, missPunchToday: 0,
};

export interface DashboardRecords {
  companies: any[];
  employees: any[];
  attendanceToday: any[];
  missPunchRecords: any[];
  leaves: any[];
  tasks: any[];
}

const emptyRecords: DashboardRecords = {
  companies: [],
  employees: [],
  attendanceToday: [],
  missPunchRecords: [],
  leaves: [],
  tasks: [],
};

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

function getDateValue(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate) return value.toDate();
  if (typeof value === 'string') return new Date(value);
  return null;
}

export function useDashboardStats(companyId?: string | string[] | null, refreshKey?: number): DashboardStats & { loading: boolean; records: DashboardRecords } {
  const [stats, setStats] = useState<DashboardStats>(initialStats);
  const [records, setRecords] = useState<DashboardRecords>(emptyRecords);
  const [loading, setLoading] = useState(true);
  const loadedCount = useRef(0);
  const expectedListeners = useRef(0);
  const { user } = useAuth();

  const markLoaded = () => {
    loadedCount.current += 1;
    if (expectedListeners.current > 0 && loadedCount.current >= expectedListeners.current) {
      setLoading(false);
    }
  };

  // Depend on the SCOPE BY VALUE, not the argument identity: callers legitimately
  // pass freshly-built arrays (e.g. availableCompanies.map(...)), and array
  // identity in deps re-ran this effect on EVERY render — re-subscribing every
  // listener, whose snapshots setState → render → new array → … triggering
  // React's "Maximum update depth exceeded" infinite loop.
  const scopeKey = Array.isArray(companyId)
    ? companyId.join(',')
    : companyId
      ? String(companyId)
      : '';

  useEffect(() => {
    if (!user) {
      setLoading(true);
      return;
    }

    loadedCount.current = 0;
    expectedListeners.current = 0;
    setRecords(emptyRecords);
    const now = new Date();

    const companyIds = scopeKey ? scopeKey.split(',') : [];

    const listen = (ref: any, onNext: (snap: any) => void) => {
      expectedListeners.current += 1;
      let completed = false;
      const done = () => {
        if (!completed) {
          completed = true;
          markLoaded();
        }
      };
      return onSnapshot(
        ref,
        (snap: any) => {
          done();
          onNext(snap);
        },
        () => {
          done();
        }
      );
    };

    const chunkArray = (arr: string[], size = 10) => {
      const out: string[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    // Listen to a collection across any number of company ids (Firestore caps
    // `in` at 10 values, so split into chunked queries and merge the results).
    const listenCollection = (
      collectionName: string,
      ids: string[],
      onDocs: (docs: any[]) => void
    ) => {
      expectedListeners.current += 1;
      const colRef = collection(db, collectionName);
      const chunks = ids.length === 0 ? [[]] : chunkArray(ids);
      const cache: any[][] = chunks.map(() => []);
      let reported = false;
      const report = () => {
        if (!reported) {
          reported = true;
          markLoaded();
        }
        onDocs(cache.flat());
      };
      const unsubs = chunks.map((chunk, idx) => {
        const snapHandler = (snap: any) => {
          cache[idx] = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          report();
        };
        if (chunk.length === 0) {
          return onSnapshot(colRef, snapHandler, () => report());
        }
        return onSnapshot(
          query(colRef, where('companyId', 'in', chunk)),
          snapHandler,
          () => report()
        );
      });
      return () => unsubs.forEach((u) => { try { u(); } catch {} });
    };

    // Companies are keyed by their document id. A `where('__name__','in',...)`
    // list query is denied by the Firestore rules for scoped roles, so when an
    // explicit id list is given we attach one per-document listener (a
    // `get`-style read allowed via canReadCompany) for each id. When there is no
    // id constraint (unrestricted roles only) we use a collection list query.
    const listenCompanies = (ids: string[], onDocs: (docs: any[]) => void) => {
      expectedListeners.current += 1;
      if (ids.length === 0) {
        // Scoped roles must NOT attempt a global companies list query (the
        // rules deny it and it surfaces as a permissions error). Report empty
        // unless the role can globally list companies (master/company-admin
        // only — exec/TL are always assignment-scoped on mobile).
        const canListAll = user?.role === 'master-admin' || user?.role === 'company-admin';
        if (!canListAll) {
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
          () => { markLoaded(); onDocs([]); }
        );
        return unsub;
      }
      const uniqueIds = [...new Set(ids)];
      const cache: Record<string, boolean> = {};
      const docMap: Record<string, any> = {};
      let reported = false;
      const report = () => {
        if (uniqueIds.every((id) => cache[id])) {
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
            report();
          },
          () => { cache[id] = true; delete docMap[id]; report(); }
        )
      );
      return () => unsubs.forEach((u) => { try { u(); } catch {} });
    };

    const unsubscribers: (() => void)[] = [];

    // Companies
    const unsubCompanies = listenCompanies(companyIds, (docs) => {
      setRecords((prev) => ({ ...prev, companies: docs }));
      setStats((prev) => ({
        ...prev,
        totalCompanies: docs.length,
        activeCompanies: docs.filter((d: any) => d.status === 'Active').length,
      }));
    });
    unsubscribers.push(unsubCompanies);

    // Employees
    const unsubEmployees = listenCollection('employees', companyIds, (docs) => {
      setRecords((prev) => ({ ...prev, employees: docs }));
      const todayBirthdays = docs.filter((e: any) => {
        const dob = getDateValue(e.birthDate || e.dob);
        if (!dob) return false;
        return dob.getMonth() === now.getMonth() && dob.getDate() === now.getDate();
      }).length;

      setStats((prev) => ({
        ...prev,
        totalEmployees: docs.length,
        activeEmployees: docs.filter((d: any) => d.status === 'Active').length,
        inactiveEmployees: docs.filter((d: any) => d.status === 'Inactive').length,
        onLeaveToday: docs.filter((d: any) => d.status === 'On Leave').length,
        todayBirthdays,
      }));
    });
    unsubscribers.push(unsubEmployees);

    // Attendance
    const unsubAttendance = listenCollection('attendance', companyIds, (docs) => {
      const todayStr = now.toISOString().split('T')[0];

      const todayRecords = docs.filter((d: any) => {
        const date = d.date;
        if (!date) return false;
        if (typeof date === 'string') return date.startsWith(todayStr);
        const dDate = getDateValue(date);
        return dDate ? isToday(dDate) : false;
      });

      setRecords((prev) => ({ ...prev, attendanceToday: todayRecords }));

      const missPunchRecords = docs.filter((d: any) =>
        isActiveMissedPunchRecord(d) && isWithinRecentWindow(d, recentMissPunchSinceDate(now))
      );
      setRecords((prev) => ({ ...prev, missPunchRecords }));

      const present = todayRecords.filter((d: any) => d.status === 'Present').length;
      const absent = todayRecords.filter((d: any) => d.status === 'Absent').length;
      const late = todayRecords.filter((d: any) => d.status === 'Late').length;
      const missPunch = missPunchRecords.length;

      setStats((prev) => ({
        ...prev,
        presentToday: present,
        absentToday: absent,
        lateToday: late,
        missPunchToday: missPunch,
        approvedAttendanceToday: todayRecords.filter((d: any) => d.status === 'Approved').length,
        attendanceRate:
          todayRecords.length > 0
            ? Math.round(((present + late) / todayRecords.length) * 100)
            : null,
      }));
    });
    unsubscribers.push(unsubAttendance);

    // Leave Requests
    const unsubLeaves = listenCollection('leaveRequests', companyIds, (docs) => {
      setRecords((prev) => ({ ...prev, leaves: docs }));
      setStats((prev) => ({
        ...prev,
        pendingLeaves: docs.filter((d: any) => d.status === 'Pending').length,
        totalLeaveRequests: docs.length,
        approvedLeaves: docs.filter((d: any) => d.status === 'Approved').length,
        rejectedLeaves: docs.filter((d: any) => d.status === 'Rejected').length,
      }));
    });
    unsubscribers.push(unsubLeaves);

    // Salary Slips
    const unsubSalary = listenCollection('salarySlips', companyIds, (docs) => {
      setStats((prev) => ({ ...prev, salaryGenerated: docs.length }));
    });
    unsubscribers.push(unsubSalary);

    // Tasks
    const unsubTasks = listenCollection('tasks', companyIds, (docs) => {
      setRecords((prev) => ({ ...prev, tasks: docs }));
      setStats((prev) => ({
        ...prev,
        pendingTasks: docs.filter((d: any) => d.status === 'Pending').length,
        inProgressTasks: docs.filter((d: any) => d.status === 'In Progress' || d.status === 'inProgress').length,
        completedTasks: docs.filter((d: any) => d.status === 'Completed' || d.status === 'done').length,
      }));
    });
    unsubscribers.push(unsubTasks);

    // Holidays
    const unsubHolidays = listenCollection('holidays', companyIds, (docs) => {
      // Match the HolidayCalendar destination (current calendar year) so the
      // card count equals the list it opens.
      const upcoming = docs.filter((d: any) => {
        const date = getDateValue(d.date);
        return date ? date.getFullYear() === now.getFullYear() : false;
      }).length;
      setStats((prev) => ({ ...prev, upcomingHolidays: upcoming }));
    });
    unsubscribers.push(unsubHolidays);

    // Departments
    const unsubDepartments = listenCollection('departments', companyIds, (docs) => {
      // Match the Departments destination (shows all departments) so the card
      // count equals the list it opens.
      setStats((prev) => ({
        ...prev,
        activeDepartments: docs.length,
      }));
    });
    unsubscribers.push(unsubDepartments);

    // Assets
    const unsubAssets = listenCollection('assets', companyIds, (docs) => {
      setStats((prev) => ({ ...prev, totalAssets: docs.length }));
    });
    unsubscribers.push(unsubAssets);

    // Announcements
    const unsubAnnouncements = listenCollection('announcements', companyIds, (docs) => {
      setStats((prev) => ({ ...prev, totalAnnouncements: docs.length }));
    });
    unsubscribers.push(unsubAnnouncements);

    // Users (executives / team leaders are counted from the role field)
    const unsubUsers = listenCollection('users', companyIds, (docs) => {
      const active = docs.filter((u: any) => u.isActive !== false);
      setStats((prev) => ({
        ...prev,
        totalExecutives: active.filter((u: any) => u.role === 'executive').length,
        totalTeamLeaders: active.filter((u: any) => u.role === 'team-leader').length,
      }));
    });
    unsubscribers.push(unsubUsers);

    // Roles (custom roles collection)
    const unsubRoles = listen(collection(db, 'roles'), (snap: any) => {
      setStats((prev) => ({ ...prev, totalRoles: snap.size, activeRoles: snap.size }));
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
      unsubscribers.forEach((unsub) => {
        try { unsub(); } catch {}
      });
    };
  }, [scopeKey, refreshKey]);

  return { ...stats, loading, records };
}
