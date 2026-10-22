import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity,
  RefreshControl, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { SalarySlip } from '../../types/user';
import { getSalarySlipsByUser, getCompanyPayslipOptions } from '../../services/salaryService';
import { generatePayslipPdf } from '../../utils/payslipPdf';
import { formatDateSafe } from '../../utils/dateUtils';
import { HeroBanner, PremiumCard, EmptyStateView, StatusBadge } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const STATUS_COLORS: Record<string, string> = { Paid: '#10b981', Pending: '#f59e0b', Processing: '#3b82f6' };
const fmt = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const PayrollScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors } = useTheme();
  const [payslips, setPayslips] = useState<SalarySlip[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const [selectedSlip, setSelectedSlip] = useState<SalarySlip | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);

  const fetchPayslips = async () => {
    if (!user) return;
    try {
      const data = await getSalarySlipsByUser(user.id);
      setPayslips(data);
    } catch (err) {
      console.error('Failed to fetch payslips:', err);
    }
  };

  useEffect(() => { fetchPayslips(); }, []);
  const onRefresh = async () => { setRefreshing(true); await fetchPayslips(); setRefreshing(false); };

  const filtered = useMemo(() => {
    return payslips.filter(slip => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (slip.month || '').toLowerCase().includes(q) ||
        `${slip.month || ''} ${slip.year || ''}`.toLowerCase().includes(q) ||
        (slip.status || '').toLowerCase().includes(q);
    });
  }, [payslips, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);
  useEffect(() => { setCurrentPage(1); }, [search]);

  // Stats
  const totalNet = payslips.reduce((s, p) => s + (p.netSalary || 0), 0);
  const paidCount = payslips.filter(p => p.status === 'Paid').length;

  const handleDownload = async (slip: SalarySlip) => {
    setDownloading(slip.id);
    try {
      const opts = await getCompanyPayslipOptions(slip.companyId);
      await generatePayslipPdf(slip, opts);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to generate PDF');
    } finally { setDownloading(null); }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Month,Year,Basic,Allowances,Deductions,Net,Status'];
      const rows = filtered.map(s => `${s.month || ''},${s.year || ''},${s.basicSalary || 0},${s.allowances || 0},${s.deductions || 0},${s.netSalary || 0},${s.status || ''}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'my_payroll_export.csv');
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) { Alert.alert('Error', err.message || 'Export failed'); }
    finally { setExporting(false); }
  };

  const openDetail = (slip: SalarySlip) => { setSelectedSlip(slip); setShowDetail(true); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Payroll" />
      <ScrollView
        style={s.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <HeroBanner greeting="My" name="Payroll" subtitle={`${payslips.length} salary slips · ${paidCount} paid`}
          stats={[
            { label: 'Total Net', value: fmt(totalNet), color: '#10b981' },
            { label: 'Slips', value: payslips.length, color: '#FF6600' },
            { label: 'Paid', value: paidCount, color: '#10b981' },
          ]}
        />

        <View style={s.searchRow}>
          <View style={s.searchInputWrap}>
            <Icon name="search-outline" size={18} color={colors.textTertiary} />
            <TextInput style={s.searchInput} placeholder="Search payroll records..." placeholderTextColor={colors.textTertiary}
              value={search} onChangeText={setSearch} />
            {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        <View style={s.list}>
          {filtered.length === 0
            ? <EmptyStateView icon="wallet-outline" title="No payroll records" subtitle={search ? 'No records match your search.' : 'Your salary slips will appear here'} />
            : paginated.map((slip) => (
              <PremiumCard key={slip.id} style={{ marginBottom: 12, padding: 16 }} onPress={() => openDetail(slip)}>
                <View style={s.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.period}>{slip.month} {slip.year}</Text>
                    {slip.department && <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>{slip.department}</Text>}
                  </View>
                  <StatusBadge status={slip.status} color={STATUS_COLORS[slip.status] || '#64748b'} />
                </View>

                <View style={s.row}>
                  <Text style={s.label}>Basic Salary</Text>
                  <Text style={s.value}>{fmt(slip.basicSalary || 0)}</Text>
                </View>
                <View style={s.row}>
                  <Text style={s.label}>Allowances</Text>
                  <Text style={[s.value, { color: '#10b981' }]}>+{fmt(slip.allowances || 0)}</Text>
                </View>
                <View style={s.row}>
                  <Text style={s.label}>Deductions</Text>
                  <Text style={[s.value, { color: '#ef4444' }]}>-{fmt(slip.deductions || 0)}</Text>
                </View>
                <View style={[s.row, s.totalRow]}>
                  <Text style={s.totalLabel}>Net Salary</Text>
                  <Text style={s.totalValue}>{fmt(slip.netSalary || 0)}</Text>
                </View>

                <View style={s.actionRow}>
                  <TouchableOpacity style={s.downloadBtn} onPress={() => handleDownload(slip)} disabled={downloading === slip.id}>
                    {downloading === slip.id ? (
                      <ActivityIndicator size={14} color="#fff" />
                    ) : (
                      <Icon name="document-text-outline" size={14} color="#fff" />
                    )}
                    <Text style={s.downloadBtnText}>{downloading === slip.id ? 'Generating...' : 'Download Payslip'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.viewBtn} onPress={() => openDetail(slip)}>
                    <Icon name="eye-outline" size={16} color={colors.accent} />
                  </TouchableOpacity>
                </View>
              </PremiumCard>
            ))}
        </View>

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
      </ScrollView>

      {/* ── Detail Sheet ── */}
      <Modal visible={showDetail} transparent animationType="fade" onRequestClose={() => setShowDetail(false)}>
        <TouchableOpacity style={s.detailOverlay} activeOpacity={1} onPress={() => setShowDetail(false)}>
          <View style={s.detailSheet} onStartShouldSetResponder={() => true}>
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
              {selectedSlip && (
                <>
                  <View style={s.detailHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.detailTitle}>Payslip</Text>
                      <Text style={s.detailSubtitle}>{selectedSlip.month} {selectedSlip.year}</Text>
                    </View>
                    <StatusBadge status={selectedSlip.status} color={STATUS_COLORS[selectedSlip.status] || '#64748b'} />
                  </View>

                  {/* Summary */}
                  <View style={s.detailSection}>
                    <DetailRow label="Employee" value={selectedSlip.employeeName} colors={colors} />
                    {selectedSlip.employeeId && <DetailRow label="Employee ID" value={selectedSlip.employeeId} colors={colors} />}
                    {selectedSlip.department && <DetailRow label="Department" value={selectedSlip.department} colors={colors} />}
                    <DetailRow label="Pay Period" value={`${selectedSlip.month} ${selectedSlip.year}`} colors={colors} />
                  </View>

                  {/* Earnings */}
                  <Text style={s.detailSectionTitle}>Earnings</Text>
                  <View style={s.detailSection}>
                    <DetailRow label="Basic Salary" value={fmt(selectedSlip.basicSalary)} colors={colors} />
                    {selectedSlip.breakdown?.hra ? <DetailRow label="House Rent Allowance (HRA)" value={fmt(selectedSlip.breakdown.hra)} colors={colors} /> : null}
                    {selectedSlip.breakdown?.da ? <DetailRow label="Dearness Allowance (DA)" value={fmt(selectedSlip.breakdown.da)} colors={colors} /> : null}
                    {selectedSlip.breakdown?.leaveEncashment ? <DetailRow label="Leave Encashment" value={`+${fmt(selectedSlip.breakdown.leaveEncashment)}`} colors={colors} valueColor="#059669" /> : null}
                    <DetailRow label="Total Allowances" value={fmt(selectedSlip.allowances)} colors={colors} />
                  </View>

                  {/* Deductions */}
                  <Text style={s.detailSectionTitle}>Deductions</Text>
                  <View style={s.detailSection}>
                    {selectedSlip.breakdown?.pf ? <DetailRow label="Provident Fund (PF)" value={fmt(selectedSlip.breakdown.pf)} colors={colors} /> : null}
                    {selectedSlip.breakdown?.tax ? <DetailRow label="Professional Tax" value={fmt(selectedSlip.breakdown.tax)} colors={colors} /> : null}
                    {selectedSlip.breakdown?.absentDeduction ? <DetailRow label="Absent Deduction" value={`-${fmt(selectedSlip.breakdown.absentDeduction)}`} colors={colors} valueColor="#dc2626" /> : null}
                    {selectedSlip.breakdown?.otherDeductions ? <DetailRow label="Other Deductions" value={fmt(selectedSlip.breakdown.otherDeductions)} colors={colors} /> : null}
                  </View>

                  {/* Net */}
                  <View style={[s.detailSection, { borderTopWidth: 2, borderTopColor: colors.accent, paddingTop: 12, marginTop: 4 }]}>
                    <DetailRow label="Net Salary" value={fmt(selectedSlip.netSalary)} colors={colors} bold valueColor="#10b981" />
                  </View>

                  {selectedSlip.paidOn && (
                    <Text style={{ fontSize: 12, color: colors.textTertiary, textAlign: 'center', marginTop: 12 }}>
                      Paid on {formatDateSafe(selectedSlip.paidOn, 'en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </Text>
                  )}

                  {/* Download button */}
                  <TouchableOpacity style={s.detailDownloadBtn}
                    onPress={() => { setShowDetail(false); handleDownload(selectedSlip); }}
                    disabled={downloading === selectedSlip.id}>
                    {downloading === selectedSlip.id
                      ? <ActivityIndicator size={16} color="#fff" />
                      : <Icon name="document-text-outline" size={18} color="#fff" />}
                    <Text style={s.detailDownloadBtnText}>
                      {downloading === selectedSlip.id ? 'Generating...' : 'Download Payslip PDF'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
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
  container: { flex: 1, backgroundColor: c.background },
  searchRow: { marginHorizontal: 16, marginBottom: 12, marginTop: 4, flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  list: { paddingHorizontal: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  period: { color: c.text, fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { color: c.textSecondary, fontSize: 14 },
  value: { color: c.text, fontSize: 14, fontWeight: '500' },
  totalRow: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: 8, marginTop: 4 },
  totalLabel: { color: c.text, fontSize: 16, fontWeight: 'bold' },
  totalValue: { color: '#FF6600', fontSize: 16, fontWeight: 'bold' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12, alignItems: 'center' },
  downloadBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FF6600', borderRadius: 8, paddingVertical: 10 },
  downloadBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  viewBtn: { width: 40, height: 40, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center', justifyContent: 'center' },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  // Detail sheet
  detailOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 32 },
  detailSheet: { width: '100%', maxWidth: 480, backgroundColor: c.card, borderRadius: 24, padding: 20, maxHeight: '85%' },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  detailTitle: { fontSize: 22, fontWeight: '700', color: c.text },
  detailSubtitle: { fontSize: 14, color: c.accent, marginTop: 4 },
  detailSection: { marginBottom: 16 },
  detailSectionTitle: { fontSize: 15, fontWeight: '700', color: c.accent, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.3 },
  detailDownloadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: c.accent, marginTop: 16 },
  detailDownloadBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
