import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from '../aws/firestore-compat';
import { db } from '../aws/clients';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import type { AttendanceRecord, Employee, Holiday, LeaveRequest, Task } from '../types/user';

export interface EmployeePersonalStats {
  todayRecord: AttendanceRecord | null;
  checkedIn: boolean;
  monthStats: { present: number; late: number; absent: number; onLeave: number; total: number };
  monthRecords: AttendanceRecord[];
  pendingLeaves: number;
  leaveUsage: Record<string, number>;
  activeTasks: number;
  completedTasks: number;
  totalTasks: number;
  salarySlips: number;
  attendanceRate: number | null;
  upcomingHolidays: Holiday[];
  todayBirthdays: Employee[];
  loading: boolean;
}

const initialStats: EmployeePersonalStats = {
  todayRecord: null,
  checkedIn: false,
  monthStats: { present: 0, late: 0, absent: 0, onLeave: 0, total: 0 },
  monthRecords: [],
  pendingLeaves: 0,
  leaveUsage: {},
  activeTasks: 0,
  completedTasks: 0,
  totalTasks: 0,
  salarySlips: 0,
  attendanceRate: null,
  upcomingHolidays: [],
  todayBirthdays: [],
  loading: true,
};

const getDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate) return value.toDate();
  if (typeof value === 'string') return new Date(value);
  return null;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * Range filters must use the SAME representation the server writes.
 *
 * The API stores `date` as 'YYYY-MM-DD' (attendance.ts todayKey) while some
 * older rows hold a full instant — both compare correctly as strings, whereas
 * a JS Date serialises to '2026-10-26T00:00:00.000Z', which never satisfies
 * '2026-10-26' >= date. That made today's own punch invisible on the dashboard.
 */
const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isWithinNext30Days = (date: Date) => {
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return date >= now && date <= thirtyDays;
};

export function useEmployeePersonalStats(refreshKey?: number): EmployeePersonalStats {
  const { user } = useAuth();
  const { effectiveCompanyId } = useCompany();
  const [stats, setStats] = useState<EmployeePersonalStats>(initialStats);
  const [ready, setReady] = useState(0);
  const [expected, setExpected] = useState(6);

  useEffect(() => {
    if (!user?.id) {
      setStats(initialStats);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const userId = user.id;
    const companyId = effectiveCompanyId || user.companyId;
    const totalExpected = companyId ? 7 : 5;
    setExpected(totalExpected);
    setReady(0);

    const markReady = () => setReady((r) => r + 1);

    const unsubscribers: (() => void)[] = [];

    const unsubToday = onSnapshot(
      query(collection(db, 'attendance'), where('userId', '==', userId), where('date', '>=', dayKey(today)), where('date', '<', dayKey(tomorrow))),
      (snap) => {
        const rec = snap.docs.length > 0 ? ({ id: snap.docs[0].id, ...snap.docs[0].data() } as AttendanceRecord) : null;
        setStats((prev) => ({
          ...prev,
          todayRecord: rec,
          checkedIn: !!rec?.checkIn && !rec?.checkOut,
        }));
        markReady();
      },
      markReady
    );
    unsubscribers.push(unsubToday);

    const unsubMonth = onSnapshot(
      query(collection(db, 'attendance'), where('userId', '==', userId), where('date', '>=', dayKey(monthStart)), where('date', '<', dayKey(tomorrow))),
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AttendanceRecord);
        const present = docs.filter((r) => r.status === 'Present').length;
        const late = docs.filter((r) => r.status === 'Late').length;
        const absent = docs.filter((r) => r.status === 'Absent').length;
        const onLeave = docs.filter((r) => r.status === 'On Leave').length;
        setStats((prev) => ({
          ...prev,
          monthRecords: docs,
          monthStats: { present, late, absent, onLeave, total: docs.length },
          attendanceRate: docs.length > 0 ? Math.round(((present + late) / docs.length) * 100) : null,
        }));
        markReady();
      },
      markReady
    );
    unsubscribers.push(unsubMonth);

    const unsubLeaves = onSnapshot(
      query(collection(db, 'leaveRequests'), where('userId', '==', userId)),
      (snap) => {
        const docs = snap.docs.map((d) => d.data()) as LeaveRequest[];
        const pending = docs.filter((r) => r.status === 'Pending').length;
        const usage: Record<string, number> = {};
        docs.forEach((r) => {
          const key = r.leaveType || 'Other';
          usage[key] = (usage[key] || 0) + (r.totalDays || 1);
        });
        setStats((prev) => ({ ...prev, pendingLeaves: pending, leaveUsage: usage }));
        markReady();
      },
      markReady
    );
    unsubscribers.push(unsubLeaves);

    const unsubTasks = onSnapshot(
      query(collection(db, 'tasks'), where('assignedToId', '==', userId)),
      (snap) => {
        const docs = snap.docs.map((d) => d.data()) as Task[];
        const active = docs.filter((t) => t.status === 'Pending' || t.status === 'In Progress').length;
        const completed = docs.filter((t) => t.status === 'Completed').length;
        setStats((prev) => ({ ...prev, activeTasks: active, completedTasks: completed, totalTasks: docs.length }));
        markReady();
      },
      markReady
    );
    unsubscribers.push(unsubTasks);

    const unsubSalary = onSnapshot(
      query(collection(db, 'salarySlips'), where('userId', '==', userId)),
      (snap) => {
        setStats((prev) => ({ ...prev, salarySlips: snap.size }));
        markReady();
      },
      markReady
    );
    unsubscribers.push(unsubSalary);

    let unsubHolidays: (() => void) | null = null;
    if (companyId) {
      unsubHolidays = onSnapshot(
        query(collection(db, 'holidays'), where('companyId', '==', companyId)),
        (snap) => {
          const holidays = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Holiday)
            .filter((h) => {
              const date = getDate(h.date);
              return date ? isWithinNext30Days(date) : false;
            })
            .sort((a, b) => (getDate(a.date)?.getTime() || 0) - (getDate(b.date)?.getTime() || 0));
          setStats((prev) => ({ ...prev, upcomingHolidays: holidays }));
          markReady();
        },
        markReady
      );
      unsubscribers.push(unsubHolidays);
    }

    let unsubBirthdays: (() => void) | null = null;
    if (companyId) {
      unsubBirthdays = onSnapshot(
        query(collection(db, 'employees'), where('companyId', '==', companyId)),
        (snap) => {
          const birthdays = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Employee)
            .filter((e) => {
              const dob = e.birthDate ? getDate(e.birthDate) : null;
              return dob ? isSameDay(dob, new Date()) : false;
            });
          setStats((prev) => ({ ...prev, todayBirthdays: birthdays }));
          markReady();
        },
        markReady
      );
      unsubscribers.push(unsubBirthdays);
    }

    return () => {
      unsubscribers.forEach((unsub) => {
        try { unsub(); } catch {}
      });
      setReady(0);
    };
  }, [user?.id, user?.companyId, effectiveCompanyId, refreshKey]);

  return { ...stats, loading: ready < expected };
}
