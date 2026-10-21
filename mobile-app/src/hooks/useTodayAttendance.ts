import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../context/AuthContext';
import type { AttendanceRecord } from '../types/user';

/**
 * Server-confirmed attendance state for the signed-in user's *today* record.
 *
 * This is the single source of truth behind the dashboard hero's Working
 * Mode: `checkIn && !checkOut` on this record means an active session —
 * nothing is ever inferred client-side. One lightweight listener (the AWS
 * shim polls under the hood) plus:
 *  - `refresh()` — force re-subscribe now (used after a successful punch so
 *    the confirmed record lands immediately instead of waiting the poll),
 *  - an AppState listener that refreshes when the app returns to the
 *    foreground, so closing/reopening the app restores verified state.
 */
export interface TodayAttendance {
  todayRecord: AttendanceRecord | null;
  loading: boolean;
  refresh: () => void;
}

export function useTodayAttendance(): TodayAttendance {
  const { user } = useAuth();
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Restore verified state whenever the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!user?.id) {
      setTodayRecord(null);
      setLoading(false);
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const unsub = onSnapshot(
      query(
        collection(db, 'attendance'),
        where('userId', '==', user.id),
        where('date', '>=', today),
        where('date', '<', tomorrow),
      ),
      (snap) => {
        const rec =
          snap.docs.length > 0
            ? ({ id: snap.docs[0].id, ...snap.docs[0].data() } as AttendanceRecord)
            : null;
        setTodayRecord(rec);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [user?.id, version]);

  return { todayRecord, loading, refresh };
}
