import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl,
  TextInput, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useCompany } from '../../context/CompanyContext';
import { Icon } from '../../utils/icons';
import { formatDateSafe } from '../../utils/dateUtils';
import { SalarySlip } from '../../types/user';
import {
  getSalarySlipsByCompany, getSalarySlipsByUser, getAllSalarySlips,
  getSalaryStats, salaryStatsFromSlips, markAsPaid, retryFailedPayslips, getCompanyPayslipOptions,
} from '../../services/salaryService';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { generatePayslipPdf } from '../../utils/payslipPdf';
import { HeroBanner, PremiumCard, ShimmerLoader, SegmentControl, EmptyStateView, StatusBadge } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_COLORS: Record<string, string> = { Paid: '#10b981', Emailed: '#16a34a', Pending: '#f59e0b', Processing: '#3b82f6' };
const EMAIL_STATUS_COLORS: Record<string, string> = { sent: '#16a34a', failed: '#dc2626', retrying: '#b45309', 'not-sent': '#9ca3af' };

const fmt = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const SalarySlipsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors } = useTheme();
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId } = useCompany();
  const companyId = effectiveCompanyId || user?.companyId || '';

  const [slips, setSlips] = useState<SalarySlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSlip, setSelectedSlip] = useState<SalarySlip | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [retryingEmails, setRetryingEmails] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const s = useMemo(() => createStyles(colors), [colors]);

  // ─── Stats ──────────────────────────────────────────────────────────
  const [stats, setStats] = useState({ total: 0, paid: 0, pending: 0, processing: 0, emailed: 0, totalAmount: 0 });
  const emailedCount = slips.filter(sl => sl.emailStatus === 'sent' || sl.payslipEmailStatus === 'sent').length;

  // ─── Data fetching ──────────────────────────────────────────────────
  const fetchData = async () => {
    try {
      let data: SalarySlip[] = [];
      if (user?.role === 'employee') {
        data = await getSalarySlipsByUser(user.id);
      } else {
        // 'global' / 'master-admin' are platform sentinels, not tenants:
        // scoping to them matched a partition that does not exist and the
        // master admin saw zero slips while the API listed them (web parity).
        const ids = scopedCompanyIdsForRole(user?.role, companyId, availableCompanies);
        if (ids.length === 0) {
          data = await getAllSalarySlips();
        } else {
          const results = await Promise.all(
            ids.map((id) => getSalarySlipsByCompany(id).catch(() => [] as SalarySlip[]))
          );
          data = results.flat();
        }
      }
      setSlips(data);

      const isPlatformScope = !companyId || companyId === 'global' || companyId === 'master-admin';
      const st = isPlatformScope
        ? salaryStatsFromSlips(data)
        : await getSalaryStats(companyId || undefined);
      setStats(st);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [companyId, user?.id, user?.role]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  // ─── Filtering ──────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return slips.filter(sl => {
      if (filter !== 'All' && sl.status !== filter) return false;
      if (monthFilter !== 'All' && sl.month !== monthFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!sl.employeeName.toLowerCase().includes(q) && !sl.employeeId.toLowerCase().includes(q) &&
            !`${sl.month} ${sl.year}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [slips, filter, search, monthFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);
  useEffect(() => { setCurrentPage(1); }, [search, filter, monthFilter]);

  // ─── Email log ──────────────────────────────────────────────────────
  const emailLog = (slip: SalarySlip): string => {
    const st = (slip.emailStatus === 'sent' && slip.emailSentAt) ? 'Sent'
      : (slip.emailStatus === 'failed' || slip.payslipEmailStatus === 'failed') ? 'Failed'
      : slip.emailStatus === 'retrying' ? 'Retrying' : 'Not sent';
    const lines = [
      `Salary slip email log — ${slip.employeeName} (${slip.month} ${slip.year})`,
      `Status: ${st}`,
    ];
    if (slip.emailSentAt) lines.push(`Sent on: ${new Date(slip.emailSentAt).toLocaleString()}`);
    if (slip.emailError) lines.push(`Error: ${slip.emailError}`);
    if (st === 'Failed') lines.push('Tip: use "Retry Failed Emails" to re-send.');
    return lines.join('\n');
  };

  // ─── Actions ────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Employee,EmployeeID,Department,Month,Year,Status,Basic,Allowances,Deductions,Net'];
      const rows = filtered.map(sl => `${sl.employeeName.replace(/,/g, ';')},${sl.employeeId},${sl.department},${sl.month},${sl.year},${sl.status},${sl.basicSalary},${sl.allowances},${sl.deductions},${sl.netSalary}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'salary_slips_export.csv');
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) { Alert.alert('Error', err.message || 'Export failed'); }
    finally { setExporting(false); }
  };

  const handleRetryFailedEmails = async () => {
    if (!companyId) return;
    setRetryingEmails(true);
    try {
      const res = await retryFailedPayslips({ companyId });
      Alert.alert(res.success ? 'Retry Finished' : 'Failed', res.message || res.error || 'Done');
      await fetchData();
    } catch { Alert.alert('Error', 'Failed to retry emails.'); }
    finally { setRetryingEmails(false); }
  };

  const handleDownloadPdf = async (slip: SalarySlip) => {
    try {
      const opts = await getCompanyPayslipOptions(slip.companyId);
      await generatePayslipPdf(slip, opts);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to generate PDF');
    }
  };

  const handleMarkPaid = async (slip: SalarySlip) => {
    try { await markAsPaid(slip.id); await fetchData(); }
    catch { Alert.alert('Error', 'Failed to mark as paid.'); }
  };

  const openDetail = (slip: SalarySlip) => { setSelectedSlip(slip); setShowDetail(true); };

  // ─── Month picker ──────────────────────────────────────────────────
  const MonthPicker = () => (
    <Modal visible={showMonthPicker} transparent animationType="fade">
      <TouchableOpacity style={s.pickerOverlay} activeOpacity={1} onPress={() => setShowMonthPicker(false)}>
        <View style={s.pickerContent}>
          <Text style={s.pickerTitle}>Filter by Month</Text>
          <ScrollView style={{ maxHeight: 350 }}>
            <TouchableOpacity style={[s.pickerItem, monthFilter === 'All' && s.pickerItemSelected]}
              onPress={() => { setMonthFilter('All'); setShowMonthPicker(false); }}>
              <Text style={[s.pickerItemText, monthFilter === 'All' && s.pickerItemTextSelected]}>All Months</Text>
            </TouchableOpacity>
            {MONTHS.map(m => (
              <TouchableOpacity key={m} style={[s.pickerItem, monthFilter === m && s.pickerItemSelected]}
                onPress={() => { setMonthFilter(m); setShowMonthPicker(false); }}>
                <Text style={[s.pickerItemText, monthFilter === m && s.pickerItemTextSelected]}>{m}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  if (loading) return <ShimmerLoader count={5} height={90} style={{ padding: 16 }} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Salary Slips" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <HeroBanner greeting="Payroll" name="Salary Slips" subtitle={`${stats.paid} paid, ${stats.emailed} emailed, ${stats.pending} pending`}
          stats={[
            { label: 'Total', value: stats.total, color: '#FF6600' },
            { label: 'Paid', value: stats.paid, color: '#10b981' },
            { label: 'Pending', value: stats.pending, color: '#f59e0b' },
            { label: 'Emails', value: emailedCount, color: '#8b5cf6' },
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

        <Text style={s.count}>{filtered.length} total</Text>

        {/* ── Status filter + Month filter ── */}
        <SegmentControl options={['All', 'Paid', 'Emailed', 'Pending', 'Processing']} selected={filter} onSelect={setFilter} />

        <View style={s.filterRow}>
          <TouchableOpacity style={s.monthFilterBtn} onPress={() => setShowMonthPicker(true)}>
            <Icon name="calendar-outline" size={16} color={colors.textSecondary} />
            <Text style={s.monthFilterText}>{monthFilter === 'All' ? 'All Months' : monthFilter}</Text>
            <Icon name="chevron-down-outline" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* ── Search + Actions ── */}
        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search employee name, ID..." placeholderTextColor={colors.textTertiary}
              value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
          {companyId && (
            <TouchableOpacity style={s.retryBtn} onPress={handleRetryFailedEmails} disabled={retryingEmails}>
              {retryingEmails ? <ActivityIndicator size={14} color="#b45309" /> : <Icon name="mail-outline" size={16} color="#b45309" />}
            </TouchableOpacity>
          )}
        </View>

        {/* ── Slips List ── */}
        {filtered.length === 0
          ? <EmptyStateView icon="wallet-outline" title="No salary slips" subtitle="No slips match this filter" />
          : paginated.map((slip) => {
            const emailSent = slip.emailStatus === 'sent' && slip.emailSentAt;
            const emailFailed = slip.emailStatus === 'failed' || slip.payslipEmailStatus === 'failed';
            const emailState = emailSent ? 'sent' : emailFailed ? 'failed' : '';

            return (
              <PremiumCard key={slip.id} style={{ marginHorizontal: 16, marginBottom: 10, padding: 16 }}
                onPress={() => openDetail(slip)}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{slip.employeeName}</Text>
                    <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                      {slip.employeeId} · {slip.department}
                    </Text>
                    <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>{slip.month} {slip.year}</Text>
                    {emailState && (
                      <Text style={{ fontSize: 11, marginTop: 3, fontWeight: '600', color: EMAIL_STATUS_COLORS[emailState] || '#9ca3af' }}>
                        {emailState === 'failed' ? 'Email failed — retry' : emailState === 'sent' ? 'Email sent' : 'Email pending'}
                      </Text>
                    )}
                  </View>
                  <StatusBadge status={slip.status} color={STATUS_COLORS[slip.status] || '#64748b'} />
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.borderLight }}>
                  <View>
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>Net Salary</Text>
                    <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{fmt(slip.netSalary)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity style={s.actionIconBtn} onPress={() => openDetail(slip)}>
                      <Icon name="eye-outline" size={18} color={colors.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity style={s.actionIconBtn} onPress={() => handleDownloadPdf(slip)}>
                      <Icon name="document-text-outline" size={18} color={colors.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity style={s.actionIconBtn} onPress={() => Alert.alert('Email Log', emailLog(slip))}>
                      <Icon name="mail-outline" size={18} color={colors.accent} />
                    </TouchableOpacity>
                  </View>
                </View>

                {(slip.status === 'Pending' || slip.status === 'Emailed') && user?.role !== 'employee' && user?.role !== 'company-admin' && (
                  <TouchableOpacity style={s.markPaidBtn} onPress={() => handleMarkPaid(slip)}>
                    <Text style={s.markPaidBtnText}>Mark as Paid</Text>
                  </TouchableOpacity>
                )}
              </PremiumCard>
            );
          })}

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
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginLeft: 8 }}>Show:</Text>
            <TouchableOpacity style={s.pageSizeBtn}
              onPress={() => { const sizes = [5, 10, 20, 50]; const idx = sizes.indexOf(pageSize); setPageSize(sizes[(idx + 1) % sizes.length]); }}>
              <Text style={s.pageSizeBtnText}>{pageSize}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>

      {/* ── Detail Bottom Sheet ── */}
      <Modal visible={showDetail} transparent animationType="fade" onRequestClose={() => setShowDetail(false)}>
        <TouchableOpacity style={s.detailOverlay} activeOpacity={1} onPress={() => setShowDetail(false)}>
          <View style={s.detailSheet} onStartShouldSetResponder={() => true}>
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
              {selectedSlip && (
                <>
                  <View style={s.detailHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.detailTitle}>Salary Slip</Text>
                      <Text style={s.detailSubtitle}>{selectedSlip.employeeName} · {selectedSlip.employeeId}</Text>
                    </View>
                    <StatusBadge status={selectedSlip.status} color={STATUS_COLORS[selectedSlip.status] || '#64748b'} />
                  </View>

                  <Text style={s.detailPeriod}>{selectedSlip.month} {selectedSlip.year}</Text>

                  {/* Summary */}
                  <View style={s.detailSection}>
                    <DetailRow label="Employee" value={selectedSlip.employeeName} colors={colors} />
                    <DetailRow label="Employee ID" value={selectedSlip.employeeId} colors={colors} />
                    <DetailRow label="Department" value={selectedSlip.department} colors={colors} />
                    <DetailRow label="Month/Year" value={`${selectedSlip.month} ${selectedSlip.year}`} colors={colors} />
                  </View>

                  {/* Version / Correction (matches web SalarySlips) */}
                  {(selectedSlip.version || selectedSlip.superseded || selectedSlip.correction) && (
                    <>
                      <Text style={s.detailSectionTitle}>Version & Correction</Text>
                      <View style={s.detailSection}>
                        {selectedSlip.version ? (
                          <DetailRow label="Version" value={`v${selectedSlip.version}${selectedSlip.version > 1 ? ' (corrected)' : ''}`} colors={colors} />
                        ) : null}
                        {selectedSlip.superseded ? (
                          <DetailRow
                            label="Superseded"
                            value={`Yes — a corrected version exists${selectedSlip.supersededAt ? ` (${new Date(selectedSlip.supersededAt).toLocaleDateString()})` : ''}`}
                            colors={colors}
                            valueColor="#b45309"
                          />
                        ) : null}
                        {selectedSlip.correction ? (
                          <>
                            <DetailRow label="Correction Reason" value={selectedSlip.correction.reason} colors={colors} valueColor="#b45309" />
                            <DetailRow
                              label="Corrected By"
                              value={`${selectedSlip.correction.correctedByName} (${selectedSlip.correction.correctedAt ? new Date(selectedSlip.correction.correctedAt).toLocaleString() : ''})`}
                              colors={colors}
                            />
                            <DetailRow label="Previous Net" value={fmt(selectedSlip.correction.previous?.netSalary)} colors={colors} />
                            <DetailRow label="Corrected Net" value={fmt(selectedSlip.correction.current?.netSalary)} colors={colors} valueColor="#059669" bold />
                            {selectedSlip.correction.overrideReason ? (
                              <DetailRow label="MA Override Reason" value={selectedSlip.correction.overrideReason} colors={colors} valueColor="#b45309" />
                            ) : null}
                          </>
                        ) : null}
                      </View>
                    </>
                  )}

                  {/* Earnings */}
                  <Text style={s.detailSectionTitle}>Earnings</Text>
                  <View style={s.detailSection}>
                    <DetailRow label="Basic Salary" value={fmt(selectedSlip.basicSalary)} colors={colors} />
                    {selectedSlip.breakdown?.hra ? <DetailRow label="HRA" value={fmt(selectedSlip.breakdown.hra)} colors={colors} /> : null}
                    {selectedSlip.breakdown?.da ? <DetailRow label="DA" value={fmt(selectedSlip.breakdown.da)} colors={colors} /> : null}
                    {selectedSlip.breakdown?.leaveEncashment ? <DetailRow label="Leave Encashment" value={`+${fmt(selectedSlip.breakdown.leaveEncashment)}`} colors={colors} valueColor="#059669" /> : null}
                    {selectedSlip.breakdown?.overtimePay ? <DetailRow label="Overtime Pay" value={`+${fmt(selectedSlip.breakdown.overtimePay)}`} colors={colors} valueColor="#059669" /> : null}
                    <DetailRow label="Allowances" value={fmt(selectedSlip.allowances)} colors={colors} />
                    {/* Gross so the invoice reconciles: gross - deductions = net */}
                    <DetailRow
                      label="Gross Salary"
                      value={fmt(
                        (selectedSlip.basicSalary || 0) + (selectedSlip.allowances || 0) +
                        (selectedSlip.breakdown?.leaveEncashment || 0) + (selectedSlip.breakdown?.overtimePay || 0)
                      )}
                      colors={colors}
                      bold
                    />
                  </View>

                  {/* Deductions */}
                  <Text style={s.detailSectionTitle}>Deductions</Text>
                  <View style={s.detailSection}>
                    {selectedSlip.breakdown?.pf ? <DetailRow label="Provident Fund (PF)" value={fmt(selectedSlip.breakdown.pf)} colors={colors} /> : null}
                    {selectedSlip.breakdown?.tax ? <DetailRow label="Professional Tax" value={fmt(selectedSlip.breakdown.tax)} colors={colors} /> : null}
                    {selectedSlip.breakdown?.absentDeduction ? <DetailRow label="Absent Deduction" value={`-${fmt(selectedSlip.breakdown.absentDeduction)}`} colors={colors} valueColor="#dc2626" /> : null}
                    {selectedSlip.breakdown?.otherDeductions ? <DetailRow label="Other Deductions" value={fmt(selectedSlip.breakdown.otherDeductions)} colors={colors} /> : null}
                    <DetailRow label="Total Deductions" value={fmt(selectedSlip.deductions)} colors={colors} />
                  </View>

                  {/* Net */}
                  <View style={[s.detailSection, { borderTopWidth: 2, borderTopColor: colors.accent, paddingTop: 12, marginTop: 4 }]}>
                    <DetailRow label="Net Salary" value={fmt(selectedSlip.netSalary)} colors={colors} bold valueColor="#10b981" />
                  </View>

                  {/* Email status */}
                  {selectedSlip.emailStatus && selectedSlip.emailStatus !== 'not-sent' && (
                    <View style={s.detailSection}>
                      <DetailRow label="Email Status" value={selectedSlip.emailStatus} colors={colors}
                        valueColor={selectedSlip.emailStatus === 'failed' ? '#dc2626' : '#16a34a'} />
                      {selectedSlip.emailSentAt && <DetailRow label="Sent At" value={new Date(selectedSlip.emailSentAt).toLocaleString()} colors={colors} />}
                      {selectedSlip.emailError && <DetailRow label="Error" value={selectedSlip.emailError} colors={colors} valueColor="#dc2626" />}
                    </View>
                  )}

                  {selectedSlip.paidOn && (
                    <Text style={{ fontSize: 12, color: colors.textTertiary, textAlign: 'center', marginTop: 12 }}>
                      Paid on {formatDateSafe(selectedSlip.paidOn, 'en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </Text>
                  )}

                  {/* Actions */}
                  <View style={s.detailActions}>
                    <TouchableOpacity style={s.detailActionBtn} onPress={() => { setShowDetail(false); handleDownloadPdf(selectedSlip); }}>
                      <Icon name="document-text-outline" size={18} color="#fff" />
                      <Text style={s.detailActionBtnText}>Download PDF</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      <MonthPicker />
    </View>
  );
};

const DetailRow: React.FC<{
  label: string; value: string; colors: ThemeColors; bold?: boolean; valueColor?: string;
}> = ({ label, value, colors, bold, valueColor }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.borderLight }}>
    <Text style={{ fontSize: 13, color: colors.textSecondary }}>{label}</Text>
    <Text style={{ fontSize: 14, fontWeight: bold ? '700' : '600', color: valueColor || colors.text }}>{value}</Text>
  </View>
);

const createStyles = (c: ThemeColors) => StyleSheet.create({
  count: { color: c.textSecondary, fontSize: 13, marginHorizontal: 16, marginBottom: 8, textAlign: 'right' },
  filterSection: { marginHorizontal: 16, marginBottom: 8 },
  filterLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  chipActive: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { fontSize: 13, fontWeight: '500', color: c.text },
  chipTextActive: { color: '#fff' },
  filterRow: { marginHorizontal: 16, marginBottom: 8 },
  monthFilterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card, alignSelf: 'flex-start' },
  monthFilterText: { fontSize: 13, fontWeight: '500', color: c.text },
  searchRow: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  retryBtn: { backgroundColor: '#fef3c7', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  actionIconBtn: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center', justifyContent: 'center' },
  markPaidBtn: { marginTop: 10, backgroundColor: '#10b98115', paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  markPaidBtnText: { color: '#10b981', fontWeight: '600', fontSize: 13 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  // Picker
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 32 },
  pickerContent: { width: '100%', maxWidth: 420, backgroundColor: c.card, borderRadius: 20, padding: 20, maxHeight: '60%' },
  pickerTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12, textAlign: 'center' },
  pickerItem: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10 },
  pickerItemSelected: { backgroundColor: c.accent + '15' },
  pickerItemText: { fontSize: 15, color: c.text },
  pickerItemTextSelected: { color: c.accent, fontWeight: '700' },
  // Detail sheet
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 32 },
  detailSheet: { width: '100%', maxWidth: 480, backgroundColor: c.card, borderRadius: 24, padding: 20, maxHeight: '85%' },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  detailTitle: { fontSize: 20, fontWeight: '700', color: c.text },
  detailSubtitle: { fontSize: 13, color: c.textSecondary, marginTop: 4 },
  detailPeriod: { fontSize: 14, fontWeight: '600', color: c.accent, marginBottom: 16 },
  detailSection: { marginBottom: 16 },
  detailSectionTitle: { fontSize: 15, fontWeight: '700', color: c.accent, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  detailActions: { marginTop: 16, gap: 10 },
  detailActionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: c.accent },
  detailActionBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
