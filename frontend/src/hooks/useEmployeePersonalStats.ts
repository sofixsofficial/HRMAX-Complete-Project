import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from '../aws/firestore-compat';
import { db } from '../aws/clients';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import type { AttendanceRecord, Holiday, LeaveRequest, Task } from '../types/user';

export interface EmployeePersonalStats {
  todayRecord: AttendanceRecord | null;
  checkedIn: boolean;
  monthStats: { present: number; late: number; absent: number; onLeave: number; total: number };
  monthRecords: AttendanceRecord[];
  attendanceRate: number;
  pendingLeaves: number;
  leaveUsage: Record<string, number>;
  activeTasks: number;
  completedTasks: number;
  totalTasks: number;
  upcomingHolidays: Holiday[];
  salarySlips: number;
  loading: boolean;
}

const initialStats: EmployeePersonalStats = {
  todayRecord: null,
  checkedIn: false,
  monthStats: { present: 0, late: 0, absent: 0, onLeave: 0, total: 0 },
  monthRecords: [],
  attendanceRate: 0,
  pendingLeaves: 0,
  leaveUsage: {},
  activeTasks: 0,
  completedTasks: 0,
  totalTasks: 0,
  upcomingHolidays: [],
  salarySlips: 0,
  loading: true,
};

const getDate = (value: any): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value?.toDate) return value.toDate();
  if (typeof value === 'string') return new Date(value);
  return null;
};

const isWithinNext30Days = (date: Date) => {
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return date >= now && date <= thirtyDays;
};

export function useEmployeePersonalStats(): EmployeePersonalStats {
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const firstCompanyId = availableCompanies?.[0]?.id || '';
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
    // All-Companies mode (`global` placeholder) → first assigned company so
    // holiday/policy lookups resolve for Executive/Team-Leader personal views.
    const companyId = [effectiveCompanyId, firstCompanyId, user.companyId]
      .map(v => String(v ?? ''))
      .find(v => v && v !== 'global') ?? '';
    const totalExpected = companyId ? 6 : 5;
    setExpected(totalExpected);
    setReady(0);

    const markReady = () => setReady((r) => r + 1);

    const unsubscribers: (() => void)[] = [];

    const unsubToday = onSnapshot(
      query(collection(db, 'attendance'), where('userId', '==', userId), where('date', '>=', today), where('date', '<', tomorrow)),
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
      query(collection(db, 'attendance'), where('userId', '==', userId), where('date', '>=', monthStart), where('date', '<', tomorrow)),
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AttendanceRecord[];
        // Early Checkout / Half Day are ATTENDED days (in-punch on record) —
        // bucketing them out of Present made a month of real punches read
        // "0 Present 0 Late 0 Absent" on the self-attendance card.
        const attended = (r: AttendanceRecord) =>
          r.status === 'Present' || r.status === 'Early Checkout' || r.status === 'Half Day';
        const present = docs.filter(attended).length;
        const late = docs.filter((r) => r.status === 'Late').length;
        const absent = docs.filter((r) => r.status === 'Absent').length;
        const onLeave = docs.filter((r) => r.status === 'On Leave').length;
        const total = docs.length;
        const attendanceRate = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
        const monthRecords = [...docs].sort(
          (a, b) => (getDate(b.date)?.getTime() || 0) - (getDate(a.date)?.getTime() || 0)
        );
        setStats((prev) => ({ ...prev, monthStats: { present, late, absent, onLeave, total }, monthRecords, attendanceRate }));
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

    return () => {
      unsubscribers.forEach((unsub) => {
        try { unsub(); } catch {}
      });
      setReady(0);
    };
  }, [user?.id, user?.companyId, effectiveCompanyId, firstCompanyId]);

  return { ...stats, loading: ready < expected };
}
