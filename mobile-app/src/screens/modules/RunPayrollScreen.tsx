import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl,
  Alert, TextInput, ActivityIndicator, Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useCompany } from '../../context/CompanyContext';
import { Icon } from '../../utils/icons';
import { PayrollRun, PayrollItem, Employee } from '../../types/user';
import {
  getPayrollRunsByCompany, previewBulkPayroll, generateBulkPayroll,
  deletePayrollRun, updatePayrollRun, disbursePayrollRun,
} from '../../services/payrollService';
import { getSalarySlipsByCompany, getAllSalarySlips, deleteSalarySlip } from '../../services/salaryService';
import { getEmployeesByCompany } from '../../services/employeeService';
import { logAudit } from '../../services/auditLogService';
import { HeroBanner, PremiumCard, ShimmerLoader, EmptyStateView, StatusBadge } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_COLORS: Record<string, string> = {
  Draft: '#64748b', Calculated: '#3b82f6', Approved: '#f59e0b',
  Disbursed: '#10b981', Generated: '#10b981', Emailed: '#8b5cf6',
};
const STATUS_ORDER = ['Draft', 'Calculated', 'Approved', 'Disbursed'];
const EMAILED_OR_LOCKED = ['Emailed', 'Submitted', 'Approved', 'Disbursed', 'Locked', 'Reviewed', 'Generated', 'Corrected'];

const fmt = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const RunPayrollScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user, hasPermission } = useAuth();
  const { colors } = useTheme();
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId } = useCompany();
  const companyId = effectiveCompanyId || user?.companyId || '';
  const s = useMemo(() => createStyles(colors), [colors]);

  const now = new Date();
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());

  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());

  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{
    items: PayrollItem[]; workingDays: number; totalNet: number; employeeCount: number;
  } | null>(null);

  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);

  // ─── Data fetching ──────────────────────────────────────────────────
  const fetchRuns = async () => {
    if (!companyId) { setRuns([]); setLoading(false); return; }
    try { setRuns(await getPayrollRunsByCompany(companyId)); }
    catch { setRuns([]); }
    setLoading(false);
  };

  useEffect(() => { fetchRuns(); }, [companyId]);

  useEffect(() => {
    if (!companyId) { setEmployees([]); setSelectedEmployeeIds(new Set()); return; }
    getEmployeesByCompany(companyId)
      .then(emps => {
        const active = emps.filter(e => e.status === 'Active' || e.status === 'On Leave');
        setEmployees(active as any);
        setSelectedEmployeeIds(new Set(active.map(e => e.userId || e.id).filter(Boolean)));
      })
      .catch(() => { setEmployees([]); setSelectedEmployeeIds(new Set()); });
  }, [companyId]);

  const onRefresh = async () => { setRefreshing(true); await fetchRuns(); setRefreshing(false); };

  // ─── Existing run detection ─────────────────────────────────────────
  const existingRun = runs.find(r => r.monthIndex === monthIndex && r.year === year);
  const existingRunFinal = existingRun ? EMAILED_OR_LOCKED.includes(existingRun.status) : false;

  // ─── Employee selection ─────────────────────────────────────────────
  const visibleEmployees = employees;
  const selectedCount = selectedEmployeeIds.size;

  const toggleSelectEmployee = (empId: string) => {
    setSelectedEmployeeIds(prev => {
      const next = new Set(prev);
      if (next.has(empId)) next.delete(empId); else next.add(empId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const keys = visibleEmployees.map(e => e.userId || e.id).filter(Boolean);
    if (selectedEmployeeIds.size === keys.length && keys.length > 0) setSelectedEmployeeIds(new Set());
    else setSelectedEmployeeIds(new Set(keys));
  };

  // ─── Preview (mandatory step — no writes) ──────────────────────────
  const handlePreview = async () => {
    if (!companyId) { Alert.alert('No company selected'); return; }
    if (selectedCount === 0) { Alert.alert('No employees selected', 'Please select at least one employee.'); return; }
    if (existingRun && EMAILED_OR_LOCKED.includes(existingRun.status)) {
      Alert.alert('Payroll finalized', `Payroll for ${MONTHS[monthIndex]} ${year} is already finalized (${existingRun.status}).`);
      return;
    }
    setPreviewing(true);
    try {
      const result = await previewBulkPayroll({ companyId, monthIndex, year, selectedEmployeeIds: Array.from(selectedEmployeeIds) });
      if (!result.success) { Alert.alert('Preview failed', result.error || 'Failed to preview payroll.'); return; }
      setPreview({ items: result.items ?? [], workingDays: result.workingDays ?? 0, totalNet: result.totalNet ?? 0, employeeCount: result.employeeCount ?? 0 });
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to preview payroll.');
    } finally { setPreviewing(false); }
  };

  // ─── Confirm generate (writes salary slips) ────────────────────────
  const handleConfirmGenerate = async () => {
    if (!preview || !companyId) return;
    if (selectedCount === 0) { Alert.alert('No employees selected'); return; }
    const existing = runs.find(r => r.monthIndex === monthIndex && r.year === year);
    if (existing && EMAILED_OR_LOCKED.includes(existing.status)) {
      Alert.alert('Payroll finalized', `Payroll for ${MONTHS[monthIndex]} ${year} is already finalized (${existing.status}).`);
      setPreview(null); return;
    }
    if (existing) {
      // Prompt user before overwriting a non-finalised run
      Alert.alert(
        'Re-generate Payroll?',
        `A payroll for ${MONTHS[monthIndex]} ${year} already exists (status: ${existing.status}). Generating again will replace it with a fresh calculation (previous run and slips are removed). Continue?`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setPreview(null) },
          { text: 'Continue', style: 'destructive', onPress: () => doGenerate(existing) },
        ],
      );
      return;
    }
    await doGenerate();
  };

  const doGenerate = async (existingRun?: PayrollRun) => {
    setGenerating(true);
    try {
      // Remove old non-final run + its salary slips so the period stays unique.
      if (existingRun) {
        try {
          // 'global'/'master-admin' is the platform scope, not a tenant:
          // scoping to it found no slips, so the old run's slips were never
          // removed and the period stayed "already generated".
          const slips = (companyId === 'global' || companyId === 'master-admin' || !companyId)
            ? await getAllSalarySlips()
            : await getSalarySlipsByCompany(companyId);
          const runSlips = slips.filter(s => (s.payrollRunId === existingRun.id) || ((s as any).runId === existingRun.id));
          for (const s of runSlips) {
            try { await deleteSalarySlip(s.id); } catch { /* ignore */ }
          }
        } catch { /* ignore slip deletion errors */ }
        try { await deletePayrollRun(existingRun.id); } catch { /* ignore */ }
      }

      const result = await generateBulkPayroll({ companyId, monthIndex, year, selectedEmployeeIds: Array.from(selectedEmployeeIds) });
      if (!result.success) { Alert.alert('Generation failed', result.error || 'Failed to generate payroll.'); return; }

      // Audit log
      logAudit({
        userId: user?.id || '',
        userName: user?.name || 'Admin',
        userRole: user?.role || 'admin',
        action: 'Generated payroll',
        actionType: 'create',
        module: 'Payroll',
        targetEntity: `${monthIndex + 1}/${year} - ${selectedEmployeeIds.size} employees`,
        status: 'success',
      }).catch(() => {});

      await fetchRuns();
      setPreview(null);

      // Navigate to Email Center after generation
      Alert.alert(
        'Payroll Generated!',
        `Successfully generated payroll for ${result.employeeCount ?? 0} employees.\n\nSend salary slips via Email Center?`,
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Open Email Center', onPress: () => (navigation as any).navigate('EmailCenter') },
        ]
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to generate payroll.');
    } finally { setGenerating(false); }
  };

  const busy = previewing || generating;

  // ─── Permission gate ──────────────────────────────────────────────
  // Web parity (canPerform('create','payroll')): company-admin is strictly
  // view-only (their hasPermission only passes *.view), while Team Leader /
  // Executive pass via their permission matrix — the old hard-coded list both
  // over-privileged CA and locked TL out of payroll generation.
  const canGeneratePayroll = hasPermission('payroll.create');

  // ─── Run actions ────────────────────────────────────────────────────
  const handleStatusUpdate = async (id: string, status: PayrollRun['status']) => {
    try { await updatePayrollRun(id, { status }); await fetchRuns(); }
    catch { Alert.alert('Error', 'Failed to update status.'); }
  };

  const handleDisburse = async (run: PayrollRun) => {
    Alert.alert('Disburse', `Generate salary slips for ${run.totalEmployees} employees?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disburse', onPress: async () => {
        try {
          await disbursePayrollRun(run);
          Alert.alert('Success', `Salary slips generated for ${run.month} ${run.year}.`);
          await fetchRuns();
        } catch (err: any) { Alert.alert('Error', err?.message || 'Failed to disburse.'); }
      }},
    ]);
  };

  const handleDelete = (id: string) => {
    Alert.alert('Delete', 'Delete this payroll run?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deletePayrollRun(id); await fetchRuns(); }
        catch { Alert.alert('Error', 'Failed to delete.'); }
      }},
    ]);
  };

  // ─── Export ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return runs.filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return `${r.month || ''} ${r.year || ''}`.toLowerCase().includes(q) || (r.status || '').toLowerCase().includes(q);
    });
  }, [runs, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);
  useEffect(() => { setCurrentPage(1); }, [search]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Month,Year,Status,Employees,WorkingDays,NetTotal'];
      const rows = filtered.map(r => `${r.month || ''},${r.year || ''},${r.status || ''},${r.totalEmployees || 0},${r.workingDays || 0},${r.totalNet || 0}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'payroll_runs_export.csv');
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) { Alert.alert('Error', err.message || 'Export failed'); }
    finally { setExporting(false); }
  };

  const statusIndex = (status: string) => STATUS_ORDER.indexOf(status);

  // ─── Month/Year pickers ────────────────────────────────────────────
  const MonthPicker = () => (
    <Modal visible={showMonthPicker} transparent animationType="fade">
      <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setShowMonthPicker(false)}>
        <View style={s.pickerContent}>
          <Text style={s.pickerTitle}>Select Month</Text>
          <ScrollView style={{ maxHeight: 300 }}>
            {MONTHS.map((m, i) => (
              <TouchableOpacity key={m} style={[s.pickerItem, monthIndex === i && s.pickerItemSelected]}
                onPress={() => { setMonthIndex(i); setShowMonthPicker(false); }}>
                <Text style={[s.pickerItemText, monthIndex === i && s.pickerItemTextSelected]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  const YearPicker = () => (
    <Modal visible={showYearPicker} transparent animationType="fade">
      <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setShowYearPicker(false)}>
        <View style={s.pickerContent}>
          <Text style={s.pickerTitle}>Select Year</Text>
          <ScrollView style={{ maxHeight: 300 }}>
            {[year - 1, year, year + 1].map(y => (
              <TouchableOpacity key={y} style={[s.pickerItem, year === y && s.pickerItemSelected]}
                onPress={() => { setYear(y); setShowYearPicker(false); }}>
                <Text style={[s.pickerItemText, year === y && s.pickerItemTextSelected]}>{y}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  // ─── Preview modal ─────────────────────────────────────────────────
  const PreviewModal = () => (
    <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => { if (!generating) setPreview(null); }}>
      <View style={s.previewBackdrop}>
        <View style={s.modalContainer}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>Preview Payroll — {MONTHS[monthIndex]} {year}</Text>
          <Text style={s.modalSubtitle}>{preview?.employeeCount ?? 0} employees · Working Days: {preview?.workingDays ?? 0}</Text>
        </View>

        <ScrollView style={s.modalScroll} contentContainerStyle={{ paddingBottom: 20 }}>
          <Text style={s.modalInfo}>
            Review this mandatory preview — nothing is saved until you confirm. Salary slips will be saved as drafts into Payroll History.
          </Text>

          {preview?.items.map((item) => {
            const allowances = (item.hra || 0) + (item.da || 0) + (item.conveyance || 0) + (item.medical || 0) + (item.specialAllowance || 0) + (item.overtimePay || 0) + (item.leaveEncashment || 0);
            const pfpt = (item.pf || 0) + (item.professionalTax || 0);
            return (
              <View key={item.userId || item.employeeId} style={s.previewCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.previewEmpName}>{item.employeeName}</Text>
                    <Text style={s.previewEmpDept}>{item.department} · {item.employeeId}</Text>
                  </View>
                  <Text style={s.previewNet}>{fmt(item.netSalary)}</Text>
                </View>
                <View style={s.previewGrid}>
                  <PreviewRow label="WD" value={`${item.workingDays}`} />
                  <PreviewRow label="Present" value={`${item.presentDays}`} />
                  <PreviewRow label="Paid Lv" value={`${item.paidLeaveDays}`} />
                  <PreviewRow label="Unpaid Lv" value={`${item.unpaidLeaveDays}`} />
                  <PreviewRow label="Absent" value={`${item.absentDays}`} />
                  <PreviewRow label="OT Hrs" value={`${item.overtimeHours}`} />
                  <PreviewRow label="Basic" value={fmt(item.basicSalary)} />
                  <PreviewRow label="Allow." value={fmt(allowances)} />
                  <PreviewRow label="Leave Ded." value={fmt(item.otherDeductions || 0)} />
                  <PreviewRow label="PF+PT" value={fmt(pfpt)} />
                  <PreviewRow label="Earnings" value={fmt(item.totalEarnings)} />
                  <PreviewRow label="Deductions" value={fmt(item.totalDeductions)} />
                </View>
              </View>
            );
          })}

          {preview && preview.items.length > 0 && (
            <View style={s.previewTotal}>
              <Text style={s.previewTotalLabel}>Total ({preview.employeeCount} employees)</Text>
              <View style={{ flexDirection: 'row', gap: 20 }}>
                <Text style={s.previewTotalText}>Earnings: {fmt(preview.items.reduce((s, i) => s + (i.totalEarnings || 0), 0))}</Text>
                <Text style={s.previewTotalText}>Deductions: {fmt(preview.items.reduce((s, i) => s + (i.totalDeductions || 0), 0))}</Text>
                <Text style={[s.previewTotalText, { color: '#FF6600', fontWeight: '800' }]}>Net: {fmt(preview.totalNet)}</Text>
              </View>
            </View>
          )}
        </ScrollView>

        <View style={s.modalFooter}>
          <TouchableOpacity style={s.modalCancelBtn} onPress={() => setPreview(null)} disabled={generating}>
            <Text style={s.modalCancelBtnText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.modalConfirmBtn, busy && { opacity: 0.6 }]}
            onPress={handleConfirmGenerate} disabled={generating}>
            {generating ? <ActivityIndicator size={16} color="#fff" /> : <Icon name="checkmark-circle-outline" size={18} color="#fff" />}
            <Text style={s.modalConfirmBtnText}>{generating ? 'Generating...' : 'Confirm & Generate'}</Text>
          </TouchableOpacity>
        </View>
        </View>
      </View>
    </Modal>
  );

  if (loading) return <ShimmerLoader count={4} height={100} style={{ padding: 16 }} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Run Payroll" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <HeroBanner greeting="Payroll Management" name="Run Payroll" subtitle={`${runs.length} total runs`}
          stats={[
            { label: 'Draft', value: runs.filter(r => r.status === 'Draft').length, color: '#64748b' },
            { label: 'Calculated', value: runs.filter(r => r.status === 'Calculated').length, color: '#3b82f6' },
            { label: 'Disbursed', value: runs.filter(r => r.status === 'Disbursed').length, color: '#10b981' },
          ]}
        />

        {/* ── Company Selector ── */}
        {availableCompanies.length > 1 && (
          <View style={s.filterSection}>
            <Text style={s.filterLabel}>Company</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
              {canAccessAllCompanies && (
                <TouchableOpacity style={[s.chip, !companyId && s.chipActive]}
                  onPress={() => setSelectedCompanyId('')}>
                  <Text style={[s.chipText, !companyId && s.chipTextActive]}>All</Text>
                </TouchableOpacity>
              )}
              {availableCompanies.map(c => (
                <TouchableOpacity key={c.id} style={[s.chip, companyId === c.id && s.chipActive]}
                  onPress={() => setSelectedCompanyId(c.id)}>
                  <Text style={[s.chipText, companyId === c.id && s.chipTextActive]}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Month / Year selectors ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
          <TouchableOpacity style={s.filterSelect} onPress={() => setShowMonthPicker(true)}>
            <Text style={s.filterSelectText}>{MONTHS[monthIndex]}</Text>
            <Icon name="chevron-down-outline" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={s.filterSelect} onPress={() => setShowYearPicker(true)}>
            <Text style={s.filterSelectText}>{year}</Text>
            <Icon name="chevron-down-outline" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={[s.previewBtn, { backgroundColor: colors.accent }, (busy || !canGeneratePayroll) && { opacity: 0.6 }]}
            onPress={handlePreview} disabled={busy || !canGeneratePayroll}>
            {previewing ? <ActivityIndicator size={16} color="#fff" /> : <Icon name="eye-outline" size={18} color="#fff" />}
            <Text style={s.previewBtnText}>{previewing ? 'Calculating...' : 'Preview & Generate'}</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* ── Existing run warning ── */}
        {existingRun && (
          <View style={[s.warningBox, existingRunFinal ? s.warningBoxDanger : s.warningBoxInfo]}>
            <Icon name="alert-circle-outline" size={18} color={existingRunFinal ? '#b91c1c' : '#f59e0b'} />
            <Text style={[s.warningText, { color: existingRunFinal ? '#b91c1c' : '#92400e' }]}>
              Salary slips for <Text style={{ fontWeight: '700' }}>{existingRun.month} {existingRun.year}</Text> already exist — status: {existingRun.status}.
              {existingRunFinal ? ' Finalized — generating again is blocked.' : ' Not finalized — generating will replace it.'}
            </Text>
          </View>
        )}

        {/* ── Employee selection ── */}
        {companyId && (
          <View style={s.employeeSection}>
            <View style={s.employeeHeader}>
              <Text style={s.employeeTitle}>Employees ({visibleEmployees.length} active)</Text>
              <Text style={s.employeeCount}>{selectedCount} of {visibleEmployees.length} selected</Text>
            </View>
            <View style={s.employeeActions}>
              <TouchableOpacity style={s.selectBtn} onPress={toggleSelectAll} disabled={visibleEmployees.length === 0}>
                <Icon name="checkmark-done-outline" size={14} color={colors.accent} />
                <Text style={s.selectBtnText}>Select All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.selectBtn} onPress={() => setSelectedEmployeeIds(new Set())} disabled={selectedCount === 0}>
                <Icon name="close-outline" size={14} color={colors.textSecondary} />
                <Text style={[s.selectBtnText, { color: colors.textSecondary }]}>Clear</Text>
              </TouchableOpacity>
            </View>
            <View style={s.chipContainer}>
              {visibleEmployees.map(e => {
                const key = e.userId || e.id;
                const on = selectedEmployeeIds.has(key);
                return (
                  <TouchableOpacity key={key} style={[s.empChip, on && s.empChipActive]}
                    onPress={() => toggleSelectEmployee(key)}>
                    {on ? <Icon name="checkmark" size={12} color="#fff" /> : null}
                    <Text style={[s.empChipText, on && s.empChipTextActive]} numberOfLines={1}>{e.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Search + Export ── */}
        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search payroll runs..." placeholderTextColor={colors.textTertiary}
              value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        {/* ── Payroll Runs List ── */}
        {filtered.length === 0
          ? <EmptyStateView icon="wallet-outline" title="No payroll runs" subtitle={search ? 'No runs match your search.' : 'Select a month and generate payroll to get started'} />
          : paginated.map((run) => (
            <PremiumCard key={run.id} style={{ marginHorizontal: 16, marginBottom: 10, padding: 16 }}
              onPress={() => setExpandedId(expandedId === run.id ? null : run.id)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{run.month} {run.year}</Text>
                  <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 1 }}>
                    {run.totalEmployees} employees · {run.workingDays} working days
                  </Text>
                </View>
                <StatusBadge status={run.status} color={STATUS_COLORS[run.status] || '#64748b'} />
              </View>

              {/* Status steps */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
                {STATUS_ORDER.map((st, i) => (
                  <React.Fragment key={st}>
                    <View style={[s.step, statusIndex(run.status) >= i && { backgroundColor: STATUS_COLORS[st] }]}>
                      <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{i + 1}</Text>
                    </View>
                    {i < STATUS_ORDER.length - 1 && <View style={[s.stepLine, statusIndex(run.status) > i && { backgroundColor: STATUS_COLORS[st] }]} />}
                  </React.Fragment>
                ))}
              </View>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: colors.accent, marginTop: 8 }}>{fmt(run.totalNet)}</Text>

              {/* Expanded details */}
              {expandedId === run.id && (
                <View style={{ borderTopWidth: 1, borderTopColor: colors.borderLight, marginTop: 10, paddingTop: 10 }}>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    {run.status === 'Calculated' && (
                      <TouchableOpacity style={s.actionBtn} onPress={() => handleStatusUpdate(run.id, 'Approved')}>
                        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Approve</Text>
                      </TouchableOpacity>
                    )}
                    {run.status === 'Approved' && (
                      <TouchableOpacity style={[s.actionBtn, { backgroundColor: '#10b981' }]} onPress={() => handleDisburse(run)}>
                        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Disburse</Text>
                      </TouchableOpacity>
                    )}
                    {(run.status === 'Draft' || run.status === 'Calculated') && (
                      <TouchableOpacity style={[s.actionBtn, { backgroundColor: colors.danger }]} onPress={() => handleDelete(run.id)}>
                        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                    Employees
                  </Text>
                  {run.items.map((item) => (
                    <View key={item.userId} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.borderLight }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{item.employeeName}</Text>
                        <Text style={{ fontSize: 11, color: colors.textTertiary }}>{item.department} · {item.presentDays}/{item.workingDays}d</Text>
                      </View>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{fmt(item.netSalary)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </PremiumCard>
          ))}

        {/* Pagination */}
        {filtered.length > pageSize && (
          <View style={s.paginationRow}>
            <TouchableOpacity style={[s.pageBtn, currentPage === 1 && s.pageBtnDisabled]} disabled={currentPage === 1}
              onPress={() => setCurrentPage(p => Math.max(1, p - 1))}>
              <Icon name="chevron-back-outline" size={16} color={currentPage === 1 ? colors.textTertiary : colors.text} />
            </TouchableOpacity>
            <Text style={s.pageInfo}>{currentPage} / {totalPages}</Text>
            <TouchableOpacity style={[s.pageBtn, currentPage === totalPages && s.pageBtnDisabled]} disabled={currentPage === totalPages}
              onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
              <Icon name="chevron-forward-outline" size={16} color={currentPage === totalPages ? colors.textTertiary : colors.text} />
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {MonthPicker()}
      {YearPicker()}
      {PreviewModal()}
    </View>
  );
};

const PreviewRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
    <Text style={{ fontSize: 12, color: '#6b7280' }}>{label}</Text>
    <Text style={{ fontSize: 12, fontWeight: '600', color: '#111827' }}>{value}</Text>
  </View>
);

const createStyles = (c: ThemeColors) => StyleSheet.create({
  filterSection: { marginHorizontal: 16, marginBottom: 8 },
  filterLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  chipActive: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { fontSize: 13, fontWeight: '500', color: c.text },
  chipTextActive: { color: '#fff' },
  filterRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, gap: 8, alignItems: 'center' },
  filterSelect: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card, minWidth: 110 },
  filterSelectText: { fontSize: 14, fontWeight: '500', color: c.text },
  previewBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  previewBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  warningBox: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 12, gap: 8, alignItems: 'flex-start' },
  warningBoxInfo: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb' },
  warningBoxDanger: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  warningText: { flex: 1, fontSize: 13, lineHeight: 18 },
  employeeSection: { marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  employeeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  employeeTitle: { fontSize: 14, fontWeight: '600', color: c.text },
  employeeCount: { fontSize: 12, color: c.textSecondary },
  employeeActions: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  selectBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight },
  selectBtnText: { fontSize: 12, fontWeight: '500', color: c.accent },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, maxHeight: 120 },
  empChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.background },
  empChipActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  empChipText: { fontSize: 12, fontWeight: '500', color: c.text, maxWidth: 100 },
  empChipTextActive: { color: '#fff' },
  searchRow: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  step: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  stepLine: { height: 2, flex: 1, backgroundColor: '#e5e7eb' },
  actionBtn: { flex: 1, backgroundColor: c.accent, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  // Picker
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 32 },
  pickerContent: { width: '100%', maxWidth: 420, backgroundColor: c.card, borderRadius: 20, padding: 20, maxHeight: '60%' },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12, textAlign: 'center' },
  pickerItem: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  pickerItemSelected: { backgroundColor: c.accent + '15' },
  pickerItemText: { fontSize: 15, color: c.text },
  pickerItemTextSelected: { color: c.accent, fontWeight: '700' },
  // Modal
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  modalContainer: { width: '100%', maxWidth: 640, maxHeight: '92%', backgroundColor: c.background, borderRadius: 20, overflow: 'hidden' },
  modalHeader: { padding: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.borderLight },
  modalTitle: { fontSize: 20, fontWeight: '700', color: c.text },
  modalSubtitle: { fontSize: 13, color: c.textSecondary, marginTop: 4 },
  modalScroll: { flex: 1, padding: 16 },
  modalInfo: { fontSize: 13, color: c.textSecondary, marginBottom: 16, lineHeight: 18 },
  previewCard: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: c.borderLight },
  previewEmpName: { fontSize: 15, fontWeight: '700', color: c.text },
  previewEmpDept: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  previewNet: { fontSize: 16, fontWeight: '800', color: '#FF6600' },
  previewGrid: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.borderLight },
  previewTotal: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginTop: 4, borderWidth: 1, borderColor: c.borderLight },
  previewTotalLabel: { fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 8 },
  previewTotalText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
  modalFooter: { flexDirection: 'row', padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: c.borderLight },
  modalCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center' },
  modalCancelBtnText: { fontSize: 14, fontWeight: '600', color: c.text },
  modalConfirmBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: c.accent },
  modalConfirmBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
