import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Dimensions, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { getHolidaysByCompany } from '../../services/holidayService';
import { getEmployeesByCompany } from '../../services/employeeService';
import { getLeaveRequestsByCompany } from '../../services/leaveService';
import { getTasksByCompany } from '../../services/taskService';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { HeroBanner, PremiumCard, EmptyStateView, PremiumSearchBar, PremiumModal } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CELL_SIZE = (SCREEN_WIDTH - 32) / 7;

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  type: 'Holiday' | 'Birthday' | 'Leave' | 'Task' | 'Meeting';
  description: string;
  color: string;
  bgColor: string;
  extra?: string;
}

const EVENT_COLORS: Record<string, { color: string; bgColor: string }> = {
  Holiday: { color: '#ea580c', bgColor: '#fff7ed' },
  Birthday: { color: '#db2777', bgColor: '#fdf2f8' },
  Leave: { color: '#2563eb', bgColor: '#eff6ff' },
  Task: { color: '#16a34a', bgColor: '#f0fdf4' },
  Meeting: { color: '#7c3aed', bgColor: '#f5f3ff' },
};

const EVENT_TYPES = ['All', 'Holiday', 'Birthday', 'Leave', 'Task', 'Meeting'];

type ViewMode = 'month' | 'week' | 'day';

export default function CalendarCenterScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const { colors, isDark } = useTheme();

  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [searchTerm, setSearchTerm] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('All');
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [holidays, setHolidays] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);

  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );
  // Single-company context for per-company services; empty in All mode
  const companyId = scopeIds.length === 1 ? scopeIds[0] : '';

  useEffect(() => {
    fetchData();
  }, [companyId, scopeIds]);

  const fetchScoped = async <T,>(fetcher: (id: string) => Promise<T[]>): Promise<T[]> => {
    if (scopeIds.length === 0) return [];
    const results = await Promise.all(scopeIds.map((id) => fetcher(id).catch(() => [] as T[])));
    return results.flat();
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const [h, e, l, t] = await Promise.all([
        companyId ? getHolidaysByCompany(companyId).catch(() => []) : fetchScoped(getHolidaysByCompany),
        companyId ? getEmployeesByCompany(companyId).catch(() => []) : fetchScoped(getEmployeesByCompany),
        companyId ? getLeaveRequestsByCompany(companyId).catch(() => []) : fetchScoped(getLeaveRequestsByCompany),
        companyId ? getTasksByCompany(companyId).catch(() => []) : fetchScoped(getTasksByCompany),
      ]);
      setHolidays(h);
      setEmployees(e);
      setLeaves(l);
      setTasks(t);
    } catch (err) {
      console.error('Calendar fetch error:', err);
    }
    setLoading(false);
  };

  const allEvents: CalendarEvent[] = useMemo(() => {
    const events: CalendarEvent[] = [];
    holidays.forEach((h: any) => {
      const d = h.date?.toDate?.() || new Date(h.date);
      events.push({
        id: `h-${h.id}`, title: h.name, date: d, type: 'Holiday',
        description: h.description || `${h.type} Holiday`,
        color: EVENT_COLORS.Holiday.color, bgColor: EVENT_COLORS.Holiday.bgColor, extra: h.type,
      });
    });
    employees.forEach((e: any) => {
      if (e.birthDate) {
        const dob = e.birthDate?.toDate?.() || new Date(e.birthDate);
        const bday = new Date(currentDate.getFullYear(), dob.getMonth(), dob.getDate());
        events.push({
          id: `b-${e.id}`, title: `${e.name}'s Birthday`, date: bday, type: 'Birthday',
          description: `Birthday celebration for ${e.name}`,
          color: EVENT_COLORS.Birthday.color, bgColor: EVENT_COLORS.Birthday.bgColor, extra: e.department,
        });
      }
    });
    leaves.forEach((l: any) => {
      const start = l.startDate?.toDate?.() || new Date(l.startDate);
      events.push({
        id: `l-${l.id}`, title: `${l.employeeName} - ${l.leaveType}`, date: start, type: 'Leave',
        description: `${l.leaveType} leave: ${l.reason || 'No reason'}`,
        color: EVENT_COLORS.Leave.color, bgColor: EVENT_COLORS.Leave.bgColor, extra: l.status,
      });
    });
    tasks.forEach((t: any) => {
      const due = t.dueDate?.toDate?.() || new Date(t.dueDate);
      events.push({
        id: `t-${t.id}`, title: t.title, date: due, type: 'Task',
        description: `${t.status} - ${t.progress || 0}% complete`,
        color: EVENT_COLORS.Task.color, bgColor: EVENT_COLORS.Task.bgColor, extra: t.priority,
      });
    });
    return events;
  }, [holidays, employees, leaves, tasks, currentDate]);

  const filteredEvents = useMemo(() => {
    let ev = allEvents;
    if (eventTypeFilter !== 'All') ev = ev.filter(e => e.type === eventTypeFilter);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      ev = ev.filter(e => e.title.toLowerCase().includes(s) || e.description.toLowerCase().includes(s));
    }
    return ev;
  }, [allEvents, eventTypeFilter, searchTerm]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Title,Type,Date,Description,Extra'];
      const rows = filteredEvents.map(e => `${e.title.replace(/,/g, ';')},${e.type},${e.date.toDateString()},${e.description.replace(/,/g, ';')},${(e.extra || '').replace(/,/g, ';')}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'calendar_events_export.csv');
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const getEventsForDay = (day: number) => {
    return filteredEvents.filter(e => {
      const ed = new Date(e.date);
      return ed.getDate() === day && ed.getMonth() === month && ed.getFullYear() === year;
    });
  };

  const navigateMonth = (delta: number) => {
    setCurrentDate(new Date(year, month + delta, 1));
  };

  const goToday = () => setCurrentDate(new Date());

  const handleEventPress = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setShowDetail(true);
  };

  const renderCalendarGrid = () => {
    const cells: React.ReactNode[] = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push(<View key={`empty-${i}`} style={styles.cell} />);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dayEvents = getEventsForDay(day);
      const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
      cells.push(
        <TouchableOpacity key={`day-${day}`} style={[styles.cell, isToday && styles.todayCell]}>
          <Text style={[styles.cellDay, isToday && styles.todayText, { color: colors.text }]}>{day}</Text>
          {dayEvents.slice(0, 3).map(e => (
            <TouchableOpacity
              key={e.id}
              style={[styles.eventDot, { backgroundColor: e.color }]}
              onPress={() => handleEventPress(e)}
            />
          ))}
          {dayEvents.length > 3 && (
            <Text style={styles.moreEvents}>+{dayEvents.length - 3}</Text>
          )}
        </TouchableOpacity>
      );
    }
    return cells;
  };

  const renderDayView = () => {
    const dayEvents = filteredEvents.filter(e => {
      const ed = new Date(e.date);
      return ed.getDate() === currentDate.getDate() && ed.getMonth() === month && ed.getFullYear() === year;
    });
    return (
      <ScrollView style={styles.dayView}>
        {dayEvents.length === 0 ? (
          <EmptyStateView icon="calendar-outline" title="No events" subtitle="No events on this day" />
        ) : (
          dayEvents.map(e => (
            <TouchableOpacity
              key={e.id}
              style={[styles.dayEvent, { backgroundColor: e.bgColor, borderLeftColor: e.color }]}
              onPress={() => handleEventPress(e)}
            >
              <Text style={[styles.dayEventTitle, { color: e.color }]}>{e.title}</Text>
              <Text style={styles.dayEventDesc}>{e.description}</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Calendar Center" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="Calendar Center" name={`${MONTHS[month]} ${year} · ${filteredEvents.length} total`}
        stats={[
          { label: 'Events', value: allEvents.filter(e => e.date.getMonth() === month && e.date.getFullYear() === year).length, color: '#FF6600' },
          { label: 'Today', value: allEvents.filter(e => e.date.toDateString() === today.toDateString()).length, color: '#3b82f6' },
        ]}
      />

      <View style={[styles.viewModeBar, { backgroundColor: colors.card }]}>
        {(['month', 'week', 'day'] as ViewMode[]).map(v => (
          <TouchableOpacity
            key={v}
            style={[styles.viewModeBtn, viewMode === v && { backgroundColor: colors.accent }]}
            onPress={() => setViewMode(v)}
          >
            <Text style={[styles.viewModeText, { color: viewMode === v ? '#fff' : colors.textSecondary }]}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.navBar, { backgroundColor: colors.card }]}>
        <TouchableOpacity onPress={() => navigateMonth(-1)} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.accent} />
        </TouchableOpacity>
        <TouchableOpacity onPress={goToday}>
          <Text style={[styles.navTitle, { color: colors.text }]}>{MONTHS[month]} {year}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigateMonth(1)} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={22} color={colors.accent} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchRow}>
        <PremiumSearchBar style={styles.searchBar} value={searchTerm} onChangeText={setSearchTerm} placeholder="Search events..." />
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
        {EVENT_TYPES.map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.filterChip, eventTypeFilter === t && { backgroundColor: colors.accent }]}
            onPress={() => setEventTypeFilter(t)}
          >
            <Text style={[styles.filterChipText, { color: eventTypeFilter === t ? '#fff' : colors.textSecondary }]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {viewMode === 'month' ? (
        <View style={styles.calendar}>
          <View style={styles.weekdayRow}>
            {WEEKDAYS.map(d => (
              <Text key={d} style={[styles.weekday, { color: colors.textSecondary }]}>{d}</Text>
            ))}
          </View>
          <View style={styles.grid}>{renderCalendarGrid()}</View>
        </View>
      ) : viewMode === 'day' ? (
        renderDayView()
      ) : (
        <ScrollView style={styles.weekView}>
          {WEEKDAYS.map((dayName, idx) => {
            const dayDate = new Date(year, month, currentDate.getDate() - currentDate.getDay() + idx);
            const dayEvents = filteredEvents.filter(e => {
              const ed = new Date(e.date);
              return ed.getDate() === dayDate.getDate() && ed.getMonth() === dayDate.getMonth() && ed.getFullYear() === dayDate.getFullYear();
            });
            return (
              <View key={idx} style={styles.weekDayCol}>
                <Text style={[styles.weekDayName, { color: colors.text }]}>{dayName} {dayDate.getDate()}</Text>
                {dayEvents.map(e => (
                  <TouchableOpacity key={e.id} style={[styles.dayEvent, { backgroundColor: e.bgColor, borderLeftColor: e.color }]} onPress={() => handleEventPress(e)}>
                    <Text style={[styles.dayEventTitle, { color: e.color }]}>{e.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
        </ScrollView>
      )}

      <PremiumModal visible={showDetail} onClose={() => setShowDetail(false)} title={selectedEvent?.title || ''}>
        {selectedEvent && (
          <View style={styles.detailContent}>
            <View style={[styles.detailType, { backgroundColor: selectedEvent.bgColor }]}>
              <Text style={[styles.detailTypeText, { color: selectedEvent.color }]}>{selectedEvent.type}</Text>
            </View>
            <Text style={[styles.detailDesc, { color: colors.text }]}>{selectedEvent.description}</Text>
            <Text style={[styles.detailDate, { color: colors.textSecondary }]}>
              {selectedEvent.date.toDateString()}
            </Text>
            {selectedEvent.extra && (
              <Text style={[styles.detailExtra, { color: colors.textSecondary }]}>Extra: {selectedEvent.extra}</Text>
            )}
          </View>
        )}
      </PremiumModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10, gap: 10 },
  searchBar: { flex: 1, marginHorizontal: 0, marginBottom: 0 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  viewModeBar: { flexDirection: 'row', padding: 8, gap: 8, marginHorizontal: 16, borderRadius: 12, marginTop: 8 },
  viewModeBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  viewModeText: { fontSize: 13, fontWeight: '600' },
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, marginHorizontal: 16, borderRadius: 12, marginTop: 8 },
  navBtn: { padding: 8 },
  navTitle: { fontSize: 16, fontWeight: '700' },
  filterRow: { paddingHorizontal: 16, marginVertical: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, backgroundColor: '#F3F4F6' },
  filterChipText: { fontSize: 13, fontWeight: '600', color: '#1F2937' },
  calendar: { marginHorizontal: 16 },
  weekdayRow: { flexDirection: 'row' },
  weekday: { width: CELL_SIZE, textAlign: 'center', fontSize: 12, fontWeight: '600', paddingVertical: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL_SIZE, height: CELL_SIZE * 0.85, padding: 2, borderWidth: 0.3, borderColor: '#e2e8f0' },
  todayCell: { backgroundColor: 'rgba(59,130,246,0.1)' },
  cellDay: { fontSize: 12, fontWeight: '500' },
  todayText: { color: '#3b82f6', fontWeight: '800' },
  eventDot: { width: 6, height: 6, borderRadius: 3, marginTop: 1, marginLeft: 1 },
  moreEvents: { fontSize: 9, color: '#6b7280', marginTop: 1 },
  dayView: { flex: 1, paddingHorizontal: 16 },
  weekView: { flex: 1, paddingHorizontal: 16 },
  weekDayCol: { marginBottom: 12 },
  weekDayName: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  dayEvent: { padding: 10, borderRadius: 8, marginBottom: 6, borderLeftWidth: 3 },
  dayEventTitle: { fontSize: 13, fontWeight: '600' },
  dayEventDesc: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  detailContent: { paddingVertical: 12, gap: 12 },
  detailType: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16 },
  detailTypeText: { fontSize: 13, fontWeight: '600' },
  detailDesc: { fontSize: 15, lineHeight: 22 },
  detailDate: { fontSize: 14 },
  detailExtra: { fontSize: 13 },
});
