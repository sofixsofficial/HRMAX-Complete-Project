import React, { useState, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity,
  Modal, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { collection, query, where, onSnapshot, getDocs, orderBy, limit } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { dayKey } from '../../utils/attendanceDate';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useDashboardStats } from '../../hooks/useDashboardStats';
import { useCompany } from '../../context/CompanyContext';
import { DashboardSkeleton } from '../../components/SkeletonLoader';
import { Icon } from '../../utils/icons';
import { StatCard } from '../../components/StatCard';
import { StatsGrid } from '../../components/StatsGrid';
import { DashboardHero } from '../../components/DashboardHero';
import { LeaveApprovalsPanel } from '../../components/LeaveApprovalsPanel';
import { createTask } from '../../services/taskService';
import { reviewTierLeaveRequest, getActionableLeaveTier } from '../../services/leaveService';
import type { ApprovalTier } from '../../types/user';

const QUICK_ACTIONS = [
  { key: 'HandledCompanies', label: 'Handled Companies', icon: 'business-outline', color: '#FF6600' },
  { key: 'AttendanceOverview', label: 'Review Attendance', icon: 'clipboard-outline', color: '#06b6d4' },
  { key: 'TaskManagement', label: 'Manage Tasks', icon: 'document-text-outline', color: '#ec4899' },
  { key: 'LeaveManagement', label: 'Leave Status', icon: 'umbrella-outline', color: '#eab308' },
];

const MANAGEMENT_MODULES = [
  { key: 'Companies', label: 'Companies', desc: 'Manage companies', icon: 'business-outline', color: '#FF6600', perm: 'companies.view' },
  { key: 'Executives', label: 'Executives', desc: 'Manage executives', icon: 'briefcase-outline', color: '#3b82f6', perm: 'executives.view' },
  { key: 'Employees', label: 'Employees', desc: 'Manage employees', icon: 'people-outline', color: '#3b82f6', perm: 'employees.view' },
  { key: 'Departments', label: 'Departments', desc: 'Manage departments', icon: 'business-outline', color: '#10b981', perm: 'departments.view' },
  { key: 'LeaveManagement', label: 'Leave Mgmt', desc: 'Approve/reject leaves', icon: 'umbrella-outline', color: '#eab308', perm: 'leave.view' },
  { key: 'AttendanceOverview', label: 'Attendance', desc: "Today's attendance", icon: 'clipboard-outline', color: '#06b6d4', perm: 'attendance.view' },
  { key: 'TaskManagement', label: 'Task Mgmt', desc: 'Create & assign tasks', icon: 'document-text-outline', color: '#ec4899', perm: 'tasks.view' },
  { key: 'HolidayCalendar', label: 'Holidays', desc: 'Manage holidays', icon: 'calendar-outline', color: '#FF6600', perm: 'holidays.view' },
  { key: 'Assets', label: 'Assets', desc: 'Manage assets', icon: 'laptop-outline', color: '#10b981', perm: '' },
];

export const TLOperationalDashboard: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user, hasPermission } = useAuth();
  const { colors } = useTheme();
  const { effectiveCompanyId, selectedCompanyName, availableCompanies, setSelectedCompanyId } = useCompany();
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewAll, setViewAll] = useState(true);
  const [executives, setExecutives] = useState<any[]>([]);
  const [selectedExecId, setSelectedExecId] = useState('');
  // Stats follow the active scope: All → every authorized company · exec selected → their companies · company selected → just it
  const scopedCompanyIds = useMemo(() => {
    if (!viewAll && effectiveCompanyId) return [effectiveCompanyId];
    if (selectedExecId) {
      const e = executives.find((x) => x.id === selectedExecId);
      if (e && (e.assignedCompanyIds || []).length > 0) return e.assignedCompanyIds as string[];
    }
    return availableCompanies.map((c) => c.id);
  }, [viewAll, effectiveCompanyId, selectedExecId, executives, availableCompanies]);
  const { loading, ...stats } = useDashboardStats(scopedCompanyIds, refreshKey);
  const [refreshing, setRefreshing] = useState(false);
  const [peerTLCount, setPeerTLCount] = useState(0);
  const [linkedExecCount, setLinkedExecCount] = useState(0);
  const [contingencyActiveCount, setContingencyActiveCount] = useState(0);
  const [activities, setActivities] = useState<any[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskForm, setTaskForm] = useState({ title: '', description: '', priority: 'Medium' as 'High' | 'Medium' | 'Low', assignedTo: '', assignedToId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [taskAssignees, setTaskAssignees] = useState<{ id: string; name: string }[]>([]);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [toast, setToast] = useState<{ type: 'error' | 'warning' | 'success'; message: string } | null>(null);
  const s = useMemo(() => createStyles(colors), [colors]);

  const showToast = (type: 'error' | 'warning' | 'success', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    // Team-leader peers are filtered down to those sharing this user's linked
    // executives, so no global team-leader count leaks into the dashboard.
    const myLinkedIds = new Set<string>(
      (user as any)?.linkedExecutiveIds || ((user as any)?.reportingExecutiveId ? [(user as any)?.reportingExecutiveId] : [])
    );
    const qTL = query(collection(db, 'users'), where('role', '==', 'team-leader'));
    const unsubTL = onSnapshot(qTL, (snap) => {
      const tls: any[] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const peers = tls.filter(
        (t) => t.id !== user?.id &&
          ((t.linkedExecutiveIds || (t.reportingExecutiveId ? [t.reportingExecutiveId] : []))
            .some((eid: string) => myLinkedIds.has(eid)))
      );
      setPeerTLCount(peers.length);
      setLinkedExecCount(peers.length);
      setContingencyActiveCount(peers.filter((t) => t.contingencyAccess).length);
    }, () => {});
    const qEx = query(collection(db, 'users'), where('role', '==', 'executive'));
    const unsubEx = onSnapshot(qEx, (snap) => {
      const execs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) }));
      setExecutives(execs);
    }, () => {});
    return () => { unsubTL(); unsubEx(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Executives linked to this TL (drives scope + counters) — only these are shown
  const linkedExecutives = useMemo(() => {
    if (!user?.id) return [];
    const tlData = user as any;
    const linkedIds = tlData.linkedExecutiveIds || (tlData.reportingExecutiveId ? [tlData.reportingExecutiveId] : []);
    return executives.filter((e) =>
      linkedIds.includes(e.id) ||
      (e.assignedCompanyIds || []).some((cid: string) => (tlData.assignedCompanyIds || []).includes(cid))
    );
  }, [executives, user]);

  const activeExecCount = linkedExecutives.filter((e) => (e as any).isActive !== false).length;

  // Assignment overview: executives linked to this TL + unique companies across them
  const totalCompanies = useMemo(
    () => new Set(linkedExecutives.flatMap((e) => e.assignedCompanyIds || [])).size,
    [linkedExecutives]
  );

  // Card values follow the active scope
  const scopeTotalCompanies = scopedCompanyIds.length;
  const scopeTotalExecutives = selectedExecId ? 1 : linkedExecutives.length;

  const selectedExec = executives.find((e) => e.id === selectedExecId) || null;

  // Direct navigation: card taps open the corresponding filtered module screen.
  const goTo = (screen: string, params: Record<string, any> = {}) => {
    navigation?.navigate(screen, params);
  };

  // Load employees of the selected company for task assignment
  useEffect(() => {
    if (!showTaskModal || !effectiveCompanyId) {
      setTaskAssignees([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, 'employees'), where('companyId', '==', effectiveCompanyId)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: (d.data() as any).userId || d.id, name: (d.data() as any).name || '' }))
          .filter((e) => e.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        setTaskAssignees(list);
      },
      () => setTaskAssignees([])
    );
    return () => unsub();
  }, [showTaskModal, effectiveCompanyId]);  // Companies for the selected executive (fallback: all available)
  const execCompanies = useMemo(() => {
    if (!selectedExec) return availableCompanies;
    const ids = selectedExec.assignedCompanyIds || [];
    if (ids.length === 0) return availableCompanies;
    return availableCompanies.filter((c) => ids.includes(c.id));
  }, [selectedExec, availableCompanies]);

  const handleSelectExec = (id: string) => {
    setSelectedExecId(id === selectedExecId ? '' : id);
  };

  const handleSelectCompany = (cid: string) => {
    setViewAll(false);
    setSelectedCompanyId(cid === effectiveCompanyId ? '' : cid);
  };

  const handleSelectAllCompanies = () => {
    setViewAll(true);
    setSelectedCompanyId('');
  };

  // Fetch activities feed for the active scope: the selected company, or
  // every authorized company in "All Companies" mode.
  const scopeKey = scopedCompanyIds.join(',');
  useEffect(() => {
    const ids = scopeKey ? scopeKey.split(',') : [];
    if (ids.length === 0) {
      setActivities([]);
      setActivitiesLoading(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setActivitiesLoading(true);
      const created = (d: any) => d?.createdAt?.toDate?.() || d?.appliedOn?.toDate?.() || new Date();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      try {
        const perCompany = await Promise.all(ids.map(async (cid) => {
          const [tasksSnap, leavesSnap, attSnap] = await Promise.all([
            getDocs(query(collection(db, 'tasks'), where('companyId', '==', cid), orderBy('createdAt', 'desc'), limit(15))).catch(() => null),
            getDocs(query(collection(db, 'leaveRequests'), where('companyId', '==', cid), orderBy('appliedOn', 'desc'), limit(15))).catch(() => null),
            getDocs(query(collection(db, 'attendance'), where('companyId', '==', cid), where('date', '>=', dayKey(today)), limit(10))).catch(() => null),
          ]);
          const out: any[] = [];
          tasksSnap?.forEach((d) => {
            const d2 = d.data();
            out.push({ id: `${cid}-${d.id}`, type: 'task', origin: 'Task', title: d2.title, status: d2.status || 'Pending', assignedTo: d2.assignedTo || '', createdAt: created(d2) });
          });
          leavesSnap?.forEach((d) => {
            const d2 = d.data();
            const from = d2.startDate?.toDate?.() || d2.fromDate?.toDate?.() || d2.startDate || d2.fromDate || '';
            const to = d2.endDate?.toDate?.() || d2.toDate?.toDate?.() || d2.endDate || d2.toDate || '';
            out.push({
              id: `${cid}-${d.id}`, type: 'leave', origin: 'Leave',
              title: `${d2.employeeName || d2.userName || 'Unknown'} — ${d2.leaveType || 'Leave'}`,
              status: d2.status || 'Pending',
              userName: d2.employeeName || d2.userName,
              leaveType: d2.leaveType, fromDate: from, toDate: to,
              createdAt: created(d2),
            });
          });
          attSnap?.forEach((d) => {
            const d2 = d.data();
            out.push({
              id: `${cid}-att-${d.id}`, type: 'attendance', origin: 'Attendance',
              title: `${d2.name || 'Unknown'} attendance`, status: d2.status || 'Miss Punch',
              userName: d2.name, checkOut: d2.checkOut, createdAt: created(d2),
            });
          });
          return out;
        }));
        if (cancelled) return;
        const results = perCompany.flat();
        results.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setActivities(results.slice(0, 30));
      } catch (err) {
        console.error('Failed to fetch activities:', err);
      } finally {
        if (!cancelled) setActivitiesLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [scopeKey]);

  const displayedActivities = useMemo(() => {
    if (!searchTerm) return activities;
    const q = searchTerm.toLowerCase();
    return activities.filter((a) =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.userName || '').toLowerCase().includes(q) ||
      (a.assignedTo || '').toLowerCase().includes(q)
    );
  }, [activities, searchTerm]);

  const requireSelection = (): boolean => {
    if (!selectedExecId) {
      showToast('warning', 'Please select an Executive first.');
      return false;
    }
    if (!effectiveCompanyId) {
      showToast('warning', 'Please select a Company first.');
      return false;
    }
    return true;
  };

  const handleCreateTask = async () => {
    if (!requireSelection()) return;
    if (!taskForm.title.trim()) {
      showToast('error', 'Task title is required.');
      return;
    }
    setSubmitting(true);
    try {
      await createTask({
        title: taskForm.title.trim(),
        description: taskForm.description.trim(),
        priority: taskForm.priority,
        assignedTo: taskForm.assignedTo.trim(),
        assignedToId: taskForm.assignedToId,
        companyId: effectiveCompanyId!,
        status: 'Pending',
        progress: 0,
        createdBy: user?.name || '',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      setShowTaskModal(false);
      setTaskForm({ title: '', description: '', priority: 'Medium', assignedTo: '', assignedToId: '' });
      setAssigneeSearch('');
      showToast('success', 'Task created successfully.');
    } catch {
      showToast('error', 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  const getNextPendingTier = (approvalStatus: any): ApprovalTier | null => {
    // Canonical chain (mirrors leaveService.TIER_ORDER / backend TIER_ORDER):
    // Reporting Manager → HR → Company Admin → Executive → Team Leader.
    const TIER_ORDER: ApprovalTier[] = ['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader'];
    for (const tier of TIER_ORDER) {
      if (approvalStatus?.[tier] === 'Pending') return tier;
    }
    return null;
  };

  const handleReviewLeave = async (leave: any, approve: boolean) => {
    if (!requireSelection()) return;
    // Web parity (isMyLeaveAction): act ONLY on the TL's own actionable tier.
    // The old code acted on the chain's NATURAL next tier — whenever that step
    // belonged to RM/CA/Exec the CF rejected it ("Not authorized"), which looked
    // like "multi-tier verification is broken" on Android.
    const tier = getActionableLeaveTier(leave, user?.id || '', user?.role);
    if (!tier) {
      showToast('warning', 'Not your turn — this leave is routed to another approver for its current tier.');
      return;
    }
    setSubmitting(true);
    try {
      await reviewTierLeaveRequest(
        leave.id,
        tier,
        approve ? 'Approved' : 'Rejected',
        user?.id || '',
        user?.name || '',
        approve ? '' : 'Rejected from TL dashboard'
      );
      setActivities((prev) => prev.map((a) => (a.id === leave.id ? { ...a, status: approve ? 'Approved' : 'Rejected' } : a)));
      showToast(approve ? 'success' : 'warning', approve ? 'Leave approved' : 'Leave rejected');
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to review leave');
    } finally {
      setSubmitting(false);
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'Approved':
      case 'Completed':
      case 'Present':
      case 'Resolved': return '#16a34a';
      case 'Pending': return '#f59e0b';
      case 'Rejected':
      case 'Absent': return '#ef4444';
      case 'Late': return '#d97706';
      case 'On Leave': return '#6b7280';
      case 'In Progress':
      case 'Open': return '#2563eb';
      default: return '#6b7280';
    }
  };

  const statusBg = (status: string) => {
    switch (status) {
      case 'Approved':
      case 'Completed':
      case 'Present':
      case 'Resolved': return '#dcfce7';
      case 'Pending': return '#fef3c7';
      case 'Rejected':
      case 'Absent': return '#fee2e2';
      case 'Late': return '#fef3c7';
      case 'In Progress':
      case 'Open': return '#eff6ff';
      default: return '#f3f4f6';
    }
  };

  const formatDate = (d: any) => {
    if (!d) return '';
    const date = d.toDate ? d.toDate() : d instanceof Date ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  const onRefresh = () => { setRefreshing(true); setRefreshKey((k) => k + 1); };

  useEffect(() => {
    if (!loading) setRefreshing(false);
  }, [loading]);

  if (loading && !refreshing) return <DashboardSkeleton />;

  if (availableCompanies.length === 0) {
    return (
      <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <DashboardHero
          name={user?.name || 'Team Leader'}
          roleLabel="Team Leader"
          subtitle="You don't have any companies assigned to your account."
          stats={[]}
        />
        <View style={s.zeroState}>
          <Icon name="business-outline" size={40} color={colors.textTertiary} />
          <Text style={s.zeroTitle}>No Company Assigned</Text>
          <Text style={s.zeroText}>You don't have any companies assigned yet. You can create and manage companies yourself below.</Text>
        </View>
        <View style={s.sectionHeader}>
          <Icon name="grid-outline" size={16} color={colors.accent} />
          <Text style={s.sectionTitle}>Management</Text>
        </View>
        <View style={s.moduleGrid}>
          {MANAGEMENT_MODULES.filter((mod) => !mod.perm || hasPermission(mod.perm)).map((mod) => (
            <TouchableOpacity key={mod.key} style={s.moduleCard} onPress={() => navigation?.navigate(mod.key)}>
              <View style={[s.moduleIconWrap, { backgroundColor: `${mod.color}15` }]}>
                <Icon name={mod.icon} size={20} color={mod.color} />
              </View>
              <View style={s.moduleInfo}>
                <Text style={s.moduleLabel}>{mod.label}</Text>
                <Text style={s.moduleDesc}>{mod.desc}</Text>
              </View>
              <Icon name="chevron-forward-outline" size={16} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ height: 24 }} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
      <DashboardHero
        name={user?.name || 'Team Leader'}
        roleLabel="Team Leader"
        subtitle="Here's your team's activity for today."
        stats={[
          { label: 'Present', value: stats.presentToday, color: '#10b981' },
          { label: 'Absent', value: stats.absentToday, color: '#ef4444' },
          { label: 'Leaves', value: stats.pendingLeaves, color: '#f59e0b' },
          { label: 'Tasks', value: stats.pendingTasks, color: '#ec4899' },
        ]}
      />

      <View style={s.sectionHeader}>
        <Icon name="people-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Team Leader Overview</Text>
      </View>
      <StatsGrid>
        <StatCard label="Total Executives" value={scopeTotalExecutives} icon="briefcase-outline" color="#3b82f6" onClick={() => goTo('Executives')} />
        <StatCard label="Total Companies" value={scopeTotalCompanies} icon="business-outline" color="#FF6600" onClick={() => goTo('Companies')} />
        <StatCard label="Total Team Leaders" value={peerTLCount} icon="people-outline" color="#FF6600" onClick={() => goTo('HandledCompanies')} />
        <StatCard label="Active Executives" value={activeExecCount} icon="briefcase-outline" color="#3b82f6" onClick={() => goTo('Executives')} />
        <StatCard label="Linked to Executive" value={linkedExecCount} icon="git-network-outline" color="#8b5cf6" onClick={() => goTo('HandledCompanies')} />
        <StatCard label="Contingency Active" value={contingencyActiveCount} icon="flash-outline" color="#ef4444" onClick={() => goTo('HandledCompanies')} />
      </StatsGrid>

      <View style={s.sectionHeader}>
        <Icon name="funnel-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Operations Scope</Text>
      </View>
      <View style={s.filterBlock}>
        <Text style={s.filterLabel}>Step 1 · Executive</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {linkedExecutives.length === 0 ? (
            <Text style={s.filterEmpty}>No executives mapped to your oversight.</Text>
          ) : (
            linkedExecutives.map((e) => (
              <TouchableOpacity
                key={e.id}
                onPress={() => handleSelectExec(e.id)}
                style={[s.chip, { backgroundColor: e.id === selectedExecId ? colors.accent : '#F3F4F6' }]}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: e.id === selectedExecId ? '#fff' : '#1F2937' }}>{e.name}</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        <Text style={s.filterLabel}>Step 2 · Company</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <TouchableOpacity
            onPress={handleSelectAllCompanies}
            style={[s.chip, { backgroundColor: viewAll ? colors.accent : '#F3F4F6' }]}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: viewAll ? '#fff' : '#1F2937' }}>All Companies</Text>
          </TouchableOpacity>
          {execCompanies.map((c) => (
            <TouchableOpacity
              key={c.id}
              onPress={() => handleSelectCompany(c.id)}
              style={[s.chip, { backgroundColor: !viewAll && c.id === effectiveCompanyId ? colors.accent : '#F3F4F6' }]}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', color: !viewAll && c.id === effectiveCompanyId ? '#fff' : '#1F2937' }}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {toast && (
        <View style={[s.toast, { backgroundColor: toast.type === 'error' ? '#fee2e2' : toast.type === 'success' ? '#dcfce7' : '#fef3c7', borderColor: toast.type === 'error' ? '#fecaca' : toast.type === 'success' ? '#bbf7d0' : '#fde68a' }]}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: toast.type === 'error' ? '#b91c1c' : toast.type === 'success' ? '#16a34a' : '#92400e', flex: 1 }}>{toast.message}</Text>
          <TouchableOpacity onPress={() => setToast(null)}><Text style={{ fontSize: 16, color: '#666' }}>×</Text></TouchableOpacity>
        </View>
      )}

      {/* Leave queue: Eye view + Approve/Reject at this role's tier (matches web) */}
      <LeaveApprovalsPanel />

      <View style={s.sectionHeader}>
        <Icon name="clipboard-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Active Tasks & Pending Approvals</Text>
        <TouchableOpacity style={s.newTaskBtn} onPress={() => { if (requireSelection()) setShowTaskModal(true); }}>
          <Icon name="add-outline" size={16} color="#fff" />
          <Text style={s.newTaskText}>New Task</Text>
        </TouchableOpacity>
      </View>
      <View style={s.searchBox}>
        <Icon name="search-outline" size={16} color={colors.textTertiary} />
        <TextInput
          placeholder="Search activities..."
          placeholderTextColor={colors.textTertiary}
          value={searchTerm}
          onChangeText={setSearchTerm}
          style={[s.searchInput, { color: colors.text }]}
        />
        {displayedActivities.length > 0 && <Text style={s.countText}>{displayedActivities.length} item{displayedActivities.length !== 1 ? 's' : ''}</Text>}
      </View>
      {activitiesLoading ? (
        <View style={s.feedLoading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={s.feedLoadingText}>Loading activities...</Text>
        </View>
      ) : displayedActivities.length === 0 ? (
        <View style={s.feedEmpty}>
          <Icon name="clipboard-outline" size={28} color={colors.textTertiary} />
          <Text style={s.feedEmptyText}>No activities found for this scope yet.</Text>
        </View>
      ) : (
        <View style={s.feedList}>
          {displayedActivities.map((a) => (
            <View key={a.id} style={s.feedItem}>
              <View style={s.feedItemTop}>
                <View style={[s.typeBadge, { backgroundColor: a.type === 'task' ? '#eff6ff' : a.type === 'leave' ? '#ffedd5' : '#f3f4f6' }]}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: a.type === 'task' ? '#2563eb' : a.type === 'leave' ? '#d97706' : '#6b7280' }}>
                    {a.type === 'task' ? 'TASK' : a.type === 'leave' ? 'LEAVE' : 'ATTENDANCE'}
                  </Text>
                </View>
                <View style={[s.statusPill, { backgroundColor: statusBg(a.status) }]}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: statusColor(a.status) }}>{a.status}</Text>
                </View>
              </View>
              <Text style={s.feedTitle} numberOfLines={1}>{a.title}</Text>
              {a.type === 'leave' && a.fromDate && (
                <Text style={s.feedSub}>{a.leaveType} · {formatDate(a.fromDate)} → {formatDate(a.toDate)}</Text>
              )}
              {a.type === 'task' && a.assignedTo && <Text style={s.feedSub}>Assigned to: {a.assignedTo}</Text>}
              {a.type === 'attendance' && a.userName && <Text style={s.feedSub}>{a.userName}</Text>}
              <View style={s.feedActions}>
                {a.type === 'leave' && a.status === 'Pending' &&
                  getActionableLeaveTier(a, user?.id || '', user?.role) && (
                  <>
                    <TouchableOpacity style={[s.actionBtn, s.approveBtn]} onPress={() => handleReviewLeave(a, true)} disabled={submitting}>
                      <Icon name="checkmark-outline" size={14} color="#fff" />
                      <Text style={s.actionBtnText}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.actionBtn, s.rejectBtn]} onPress={() => handleReviewLeave(a, false)} disabled={submitting}>
                      <Icon name="close-outline" size={14} color="#fff" />
                      <Text style={s.actionBtnText}>Reject</Text>
                    </TouchableOpacity>
                  </>
                )}
                {a.type === 'attendance' && !a.checkOut && (
                  <TouchableOpacity style={[s.actionBtn, s.viewBtn]} onPress={() => navigation?.navigate('AttendanceOverview')}>
                    <Text style={s.actionBtnText}>Review</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={s.sectionHeader}>
        <Icon name="flash-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Quick Actions</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.quickRow}>
        {QUICK_ACTIONS.map((q) => (
          <TouchableOpacity key={q.key} style={[s.quickCard, { backgroundColor: `${q.color}10` }]} onPress={() => navigation?.navigate(q.key)}>
            <Icon name={q.icon} size={20} color={q.color} />
            <Text style={[s.quickLabel, { color: q.color }]}>{q.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.sectionHeader}>
        <Icon name="stats-chart-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Overview</Text>
      </View>
      <StatsGrid>
        <StatCard label="Present" value={stats.presentToday} icon="checkmark-circle-outline" color="#10b981" onClick={() => goTo('AttendanceOverview', { status: 'Present' })} />
        <StatCard label="Absent" value={stats.absentToday} icon="close-circle-outline" color="#dc2626" onClick={() => goTo('AttendanceOverview', { status: 'Absent' })} />
        <StatCard label="Late" value={stats.lateToday} icon="time-outline" color="#eab308" onClick={() => goTo('AttendanceOverview', { status: 'Late' })} />
        <StatCard label="On Leave" value={stats.onLeaveToday} icon="umbrella-outline" color="#3b82f6" onClick={() => goTo('Employees', { status: 'On Leave' })} />
        <StatCard label="Miss Punch" value={stats.missPunchToday} icon="alert-circle-outline" color="#8b5cf6" onClick={() => goTo('AttendanceOverview', { status: 'Miss Punch' })} />
        <StatCard label="Approved Att." value={stats.approvedAttendanceToday} icon="checkmark-done-outline" color="#10b981" onClick={() => goTo('AttendanceOverview', { status: 'Approved' })} />
        <StatCard label="Pending Leaves" value={stats.pendingLeaves} icon="umbrella-outline" color="#eab308" onClick={() => goTo('LeaveManagement', { status: 'Pending' })} />
        <StatCard label="Total Leaves" value={stats.totalLeaveRequests} icon="document-text-outline" color="#3b82f6" onClick={() => goTo('LeaveManagement', { status: 'All' })} />
        <StatCard label="Approved Leaves" value={stats.approvedLeaves} icon="checkmark-circle-outline" color="#10b981" onClick={() => goTo('LeaveManagement', { status: 'Approved' })} />
        <StatCard label="Rejected Leaves" value={stats.rejectedLeaves} icon="close-circle-outline" color="#dc2626" onClick={() => goTo('LeaveManagement', { status: 'Rejected' })} />
        <StatCard label="Pending Tasks" value={stats.pendingTasks} icon="checkmark-circle-outline" color="#ec4899" onClick={() => goTo('TaskManagement', { status: 'Pending' })} />
      </StatsGrid>

      <View style={s.sectionHeader}>
        <Icon name="clipboard-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Summary</Text>
      </View>
      <StatsGrid>
        <StatCard label="Employees" value={stats.totalEmployees} icon="people-outline" color="#3b82f6" onClick={() => goTo('Employees')} />
        <StatCard label="Late Today" value={stats.lateToday} icon="time-outline" color="#eab308" onClick={() => goTo('AttendanceOverview', { status: 'Late' })} />
        <StatCard label="Depts" value={stats.activeDepartments} icon="business-outline" color="#06b6d4" onClick={() => goTo('Departments')} />
        <StatCard label="Upcoming Holidays" value={stats.upcomingHolidays} icon="calendar-outline" color="#FF6600" onClick={() => goTo('HolidayCalendar')} />
        <StatCard label="Announcements" value={stats.totalAnnouncements} icon="megaphone-outline" color="#8b5cf6" onClick={() => goTo('Notifications')} />
      </StatsGrid>

      <View style={s.sectionHeader}>
        <Icon name="grid-outline" size={16} color={colors.accent} />
        <Text style={s.sectionTitle}>Management</Text>
      </View>
      <View style={s.moduleGrid}>
        {MANAGEMENT_MODULES.filter((mod) => !mod.perm || hasPermission(mod.perm)).map((mod) => (
          <TouchableOpacity key={mod.key} style={s.moduleCard} onPress={() => navigation?.navigate(mod.key)}>
            <View style={[s.moduleIconWrap, { backgroundColor: `${mod.color}15` }]}>
              <Icon name={mod.icon} size={20} color={mod.color} />
            </View>
            <View style={s.moduleInfo}>
              <Text style={s.moduleLabel}>{mod.label}</Text>
              <Text style={s.moduleDesc}>{mod.desc}</Text>
            </View>
            <Icon name="chevron-forward-outline" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ height: 24 }} />

      <Modal visible={showTaskModal} transparent animationType="fade" onRequestClose={() => setShowTaskModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { backgroundColor: colors.card }]}>
            <View style={s.modalHeader}>
              <Text style={[s.modalTitle, { color: colors.text }]}>Create Task</Text>
              <TouchableOpacity onPress={() => setShowTaskModal(false)}><Icon name="close-outline" size={20} color={colors.textSecondary} /></TouchableOpacity>
            </View>

            <Text style={[s.inputLabel, { color: colors.textSecondary }]}>Title *</Text>
            <TextInput
              placeholder="Task summary"
              placeholderTextColor={colors.textTertiary}
              value={taskForm.title}
              onChangeText={(t) => setTaskForm((p) => ({ ...p, title: t }))}
              style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            />

            <Text style={[s.inputLabel, { color: colors.textSecondary }]}>Description</Text>
            <TextInput
              placeholder="Details..."
              placeholderTextColor={colors.textTertiary}
              value={taskForm.description}
              onChangeText={(t) => setTaskForm((p) => ({ ...p, description: t }))}
              multiline
              style={[s.input, s.inputMultiline, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
            />

            <View style={s.modalRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={[s.inputLabel, { color: colors.textSecondary }]}>Priority</Text>
                {(['Low', 'Medium', 'High'] as const).map((p) => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => setTaskForm((prev) => ({ ...prev, priority: p }))}
                    style={[s.priorityChip, taskForm.priority === p && s.priorityChipActive]}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: taskForm.priority === p ? '#fff' : colors.textSecondary }}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={[s.inputLabel, { color: colors.textSecondary }]}>Assigned To</Text>
                <TextInput
                  placeholder="Search employee..."
                  placeholderTextColor={colors.textTertiary}
                  value={assigneeSearch}
                  onChangeText={setAssigneeSearch}
                  style={[s.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                />
                <ScrollView style={{ maxHeight: 130, marginTop: 6 }} nestedScrollEnabled>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => { setTaskForm((p) => ({ ...p, assignedTo: '', assignedToId: '' })); }}
                      style={[s.priorityChip, !taskForm.assignedToId && s.priorityChipActive]}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '600', color: !taskForm.assignedToId ? '#fff' : colors.textSecondary }}>Unassigned</Text>
                    </TouchableOpacity>
                    {taskAssignees
                      .filter((e) => !assigneeSearch || e.name.toLowerCase().includes(assigneeSearch.toLowerCase()))
                      .map((e) => (
                        <TouchableOpacity
                          key={e.id}
                          onPress={() => setTaskForm((p) => ({ ...p, assignedTo: e.name, assignedToId: e.id }))}
                          style={[s.priorityChip, taskForm.assignedToId === e.id && s.priorityChipActive]}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '600', color: taskForm.assignedToId === e.id ? '#fff' : colors.textSecondary }}>{e.name}</Text>
                        </TouchableOpacity>
                      ))}
                    {taskAssignees.length === 0 ? (
                      <Text style={{ fontSize: 12, color: colors.textTertiary, paddingVertical: 4 }}>No employees found for this company.</Text>
                    ) : null}
                  </View>
                </ScrollView>
              </View>
            </View>

            {effectiveCompanyId && (
              <View style={[s.modalContext, { backgroundColor: colors.accentBg }]}>
                <Icon name="business-outline" size={14} color={colors.accent} />
                <Text style={{ fontSize: 12, color: colors.accent, flex: 1 }}>
                  Auto-tagged to: {selectedCompanyName || 'Selected company'}
                  {selectedExec ? ` · Exec: ${selectedExec.name}` : ''}
                </Text>
              </View>
            )}

            <View style={s.modalFooter}>
              <TouchableOpacity style={[s.btn, { backgroundColor: colors.surface }]} onPress={() => setShowTaskModal(false)}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btn, { backgroundColor: '#FF6600' }]} onPress={handleCreateTask} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>Create Task</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  zeroState: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 32, gap: 10 },
  zeroTitle: { fontSize: 17, fontWeight: '700' as const, color: c.text },
  zeroText: { fontSize: 13, color: c.textSecondary, textAlign: 'center', lineHeight: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  filterBlock: { paddingHorizontal: 16, gap: 6 },
  filterLabel: { fontSize: 11, fontWeight: '600' as const, color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 8 },
  filterEmpty: { fontSize: 12, color: c.textTertiary, paddingVertical: 6 },
  toast: {
    marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 10,
    borderWidth: 1, flexDirection: 'row' as const, alignItems: 'center', gap: 8,
  },
  newTaskBtn: {
    marginLeft: 'auto', flexDirection: 'row' as const, alignItems: 'center', gap: 4,
    backgroundColor: '#FF6600', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
  },
  newTaskText: { color: '#fff', fontSize: 12, fontWeight: '700' as const },
  searchBox: {
    marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 8,
    flexDirection: 'row' as const, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, backgroundColor: c.card,
  },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 0 },
  countText: { fontSize: 11, color: c.textTertiary },
  feedLoading: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  feedLoadingText: { fontSize: 13, color: c.textSecondary },
  feedEmpty: { alignItems: 'center', paddingVertical: 28, gap: 8, paddingHorizontal: 20 },
  feedEmptyText: { fontSize: 13, color: c.textTertiary, textAlign: 'center' },
  feedList: { paddingHorizontal: 16, gap: 10 },
  feedItem: {
    backgroundColor: c.card, padding: 12, borderRadius: 14,
    borderWidth: 1, borderColor: c.borderLight,
  },
  feedItemTop: { flexDirection: 'row' as const, alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  feedTitle: { fontSize: 14, fontWeight: '600' as const, color: c.text },
  feedSub: { fontSize: 12, color: c.textSecondary, marginTop: 3 },
  feedActions: { flexDirection: 'row' as const, gap: 8, marginTop: 10 },
  actionBtn: { flexDirection: 'row' as const, alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  approveBtn: { backgroundColor: '#16a34a' },
  rejectBtn: { backgroundColor: '#ef4444' },
  viewBtn: { backgroundColor: '#2563eb' },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' as const },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 480, alignSelf: 'center', borderRadius: 16, padding: 18 },
  modalHeader: { flexDirection: 'row' as const, alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  modalTitle: { fontSize: 17, fontWeight: '700' as const },
  inputLabel: { fontSize: 12, fontWeight: '600' as const, marginBottom: 5, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' as const },
  modalRow: { flexDirection: 'row' as const, marginTop: 4 },
  priorityChip: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, marginBottom: 6,
    borderWidth: 1, borderColor: c.border, alignItems: 'center',
  },
  priorityChipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  modalContext: {
    flexDirection: 'row' as const, alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, marginTop: 12,
  },
  modalFooter: { flexDirection: 'row' as const, gap: 10, marginTop: 18 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10 },
  sectionHeader: {
    flexDirection: 'row' as const, alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600' as const, color: c.text, flexShrink: 1 },
  quickRow: { paddingLeft: 20, marginBottom: 4 },
  quickCard: {
    paddingHorizontal: 16, paddingVertical: 10, marginRight: 10,
    flexDirection: 'row' as const, alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: c.borderLight, borderRadius: 14,
  },
  quickLabel: { fontSize: 13, fontWeight: '600' as const },
  statsGrid: { paddingHorizontal: 16, gap: 12 },
  moduleGrid: { paddingHorizontal: 16, gap: 8 },
  moduleCard: {
    flexDirection: 'row' as const, alignItems: 'center',
    backgroundColor: c.card, padding: 14,
    borderWidth: 1, borderColor: c.borderLight, borderRadius: 14,
  },
  moduleIconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  moduleInfo: { flex: 1, marginLeft: 12 },
  moduleLabel: { fontSize: 14, fontWeight: '600' as const, color: c.text },
  moduleDesc: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
});
