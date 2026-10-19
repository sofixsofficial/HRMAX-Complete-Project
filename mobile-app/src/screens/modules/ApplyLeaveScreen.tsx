import React, { useState, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Alert, Platform } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { createLeaveRequest, calcLeaveDays, isLeaveTypePaid, getEffectiveTiers, TIER_LABELS, requiresMasterAdminGate } from '../../services/leaveService';
import { logAudit } from '../../services/auditLogService';
import type { LeaveType } from '../../types/user';
import { ScreenHeader } from '../../components/ScreenHeader';

const LEAVE_TYPES: LeaveType[] = ['Casual', 'Sick', 'Earned', 'Unpaid', 'Maternity', 'Paternity'];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const DatePicker = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => {
  const { colors } = useTheme();
  const [show, setShow] = useState(false);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  const handleSelect = (day: number) => {
    const m = `${month + 1}`.padStart(2, '0');
    const d = `${day}`.padStart(2, '0');
    onChange(`${year}-${m}-${d}`);
    setShow(false);
  };

  return (
    <View>
      <TouchableOpacity onPress={() => setShow(!show)} style={{ backgroundColor: colors.card, borderRadius: 10, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: colors.border }}>
        <Text style={value ? { color: colors.textPrimary, fontSize: 15 } : { color: colors.textTertiary, fontSize: 15 }}>
          {value || `Select ${label}`}
        </Text>
        <Icon name="calendar-outline" size={16} color={colors.textSecondary} />
      </TouchableOpacity>
      {show && (
        <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: 12, marginTop: 4, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <TouchableOpacity onPress={() => { if (month === 0) { setYear(year - 1); setMonth(11); } else { setMonth(month - 1); } }}>
              <Text style={{ color: '#FF6600', fontSize: 16, padding: 4 }}>◀</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{MONTHS[month]} {year}</Text>
            <TouchableOpacity onPress={() => { if (month === 11) { setYear(year + 1); setMonth(0); } else { setMonth(month + 1); } }}>
              <Text style={{ color: '#FF6600', fontSize: 16, padding: 4 }}>▶</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d) => (
              <Text key={d} style={{ width: '14.28%', textAlign: 'center', color: colors.textTertiary, fontSize: 12, paddingVertical: 4 }}>{d}</Text>
            ))}
            {Array.from({ length: firstDay }, (_, i) => <View key={`e${i}`} style={{ width: '14.28%', alignItems: 'center', paddingVertical: 4 }} />)}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const val = `${year}-${(month+1).toString().padStart(2,'0')}-${day.toString().padStart(2,'0')}`;
              const sel = val === value;
              return (
                <TouchableOpacity key={day} style={[sel ? { backgroundColor: '#FF6600', borderRadius: 20 } : {}, { width: '14.28%', alignItems: 'center', paddingVertical: 4 }]} onPress={() => handleSelect(day)}>
                  <Text style={[sel ? { color: '#fff', fontWeight: 'bold' } : { color: colors.textPrimary, fontSize: 13 }]}>{day}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
};

export const ApplyLeaveScreen: React.FC = ({ navigation, route }: any) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const params = route?.params as { reSubmit?: boolean; leaveType?: string; startDate?: string; endDate?: string; reason?: string; totalDays?: number } | undefined;
  const [leaveType, setLeaveType] = useState<LeaveType>((params?.leaveType as LeaveType) || 'Casual');
  const [startDate, setStartDate] = useState(params?.startDate || '');
  const [endDate, setEndDate] = useState(params?.endDate || '');
  const [reason, setReason] = useState(params?.reason || '');
  const [halfDay, setHalfDay] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);

  const totalDays = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const s = new Date(startDate), e = new Date(endDate);
    if (e < s) return 0;
    return Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  }, [startDate, endDate]);

  const isPaid = isLeaveTypePaid(leaveType);

  // ── Tiers Verification preview (same role-aware chain createLeaveRequest
  //    will route to on submit: Employee 4-tier, RM/HR 3-tier, Exec 2-tier,
  //    TL 1-tier — all gated by the Master Admin where applicable) ──
  const tierSteps = useMemo(() => {
    const steps: { key: string; label: string }[] = getEffectiveTiers(user?.role).map((t) => ({
      key: t as string,
      label: TIER_LABELS[t],
    }));
    if (requiresMasterAdminGate(user?.role)) steps.push({ key: 'masterAdmin', label: 'Master Admin' });
    return steps;
  }, [user?.role]);

  const handleSubmit = async () => {
    if (!startDate || !endDate || !reason.trim()) {
      Alert.alert('Error', 'Please fill all required fields');
      return;
    }
    if (!user) return;
    if (!user.companyId) {
      Alert.alert('Error', 'Company not found. Please contact your administrator.');
      return;
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) {
      Alert.alert('Error', 'End date cannot be before start date');
      return;
    }
    if (totalDays <= 0) {
      Alert.alert('Error', 'End date must be on or after start date');
      return;
    }

    setSubmitting(true);
    try {
      await createLeaveRequest({
        userId: user.id,
        employeeName: user.name,
        companyId: user.companyId,
        leaveType,
        startDate: start,
        endDate: end,
        totalDays: halfDay ? 0.5 : totalDays,
        reason: reason.trim(),
        isPaid,
      });
      Alert.alert('Success', 'Leave request submitted', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
      logAudit({
        userId: user.id,
        userName: user.name || 'Employee',
        userRole: user.role || 'employee',
        action: 'Applied for leave',
        actionType: 'create',
        module: 'Leave',
        targetEntity: `${leaveType} (${startDate} to ${endDate})`,
        status: 'success',
      }).catch(() => {});
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to submit leave request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Apply Leave" onBack={() => navigation.goBack()} />
      <ScrollView style={s.container} keyboardShouldPersistTaps="handled">
      <View style={s.form}>
        <Text style={s.formTitle}>{params?.reSubmit ? 'Re-submit Leave' : 'Apply for Leave'}</Text>
        <Text style={s.formSubtitle}>
          {params?.reSubmit
            ? 'Re-submitting your previously rejected leave through the standard approval workflow.'
            : `Submitting your ${leaveType} leave through the standard approval workflow.`}
        </Text>

        <Text style={s.label}>Leave Type *</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.typeRow}>
          {LEAVE_TYPES.map((t) => {
            const paid = isLeaveTypePaid(t);
            return (
              <TouchableOpacity key={t} style={[s.typeChip, leaveType === t && s.typeChipActive]}
                onPress={() => setLeaveType(t)}>
                <Text style={[s.typeChipText, leaveType === t && s.typeChipTextActive]}>
                  {t}{paid ? ' (Paid)' : ' (Unpaid)'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={s.label}>Start Date *</Text>
        <DatePicker label="Start Date" value={startDate} onChange={setStartDate} />

        <Text style={s.label}>End Date *</Text>
        <DatePicker label="End Date" value={endDate} onChange={setEndDate} />

        {/* Total Days Display */}
        {totalDays > 0 && (
          <View style={s.daysDisplay}>
            <Text style={s.daysLabelText}>Total Days: </Text>
            <Text style={s.daysValue}>{totalDays}</Text>
          </View>
        )}

        <TouchableOpacity style={s.halfDayRow} onPress={() => setHalfDay(!halfDay)}>
          <View style={[s.checkbox, halfDay && s.checkboxActive]}>
            {halfDay && <Text style={s.checkmark}>✓</Text>}
          </View>
          <Text style={s.halfDayLabel}>Half Day</Text>
        </TouchableOpacity>

        <Text style={s.label}>Reason *</Text>
        <TextInput style={[s.input, s.textArea]} value={reason} onChangeText={setReason} multiline numberOfLines={4} placeholder="Reason for leave..." placeholderTextColor={colors.textTertiary} />

        {/* Error if no reason */}
        {!reason.trim() && (
          <View style={s.errorRow}>
            <Icon name="alert-circle-outline" size={14} color="#ef4444" />
            <Text style={s.errorText}>Reason is required</Text>
          </View>
        )}

        {/* ── Tiers Verification (same chain as approvals) ── */}
        <View style={s.tierSection}>
          <View style={s.tierHeaderRow}>
            <Text style={s.tierTitle}>Approval Workflow</Text>
            <Text style={s.tierProgress}>Verification <Text style={s.tierProgressBold}>0</Text>/{tierSteps.length}</Text>
          </View>
          {tierSteps.map((t) => (
            <View key={t.key} style={s.stepRow}>
              <Text style={s.stepLabel}>{t.label}</Text>
              <View style={[s.stepDot, { backgroundColor: '#f59e0b' }]} />
              <Text style={s.stepStatus}>Pending</Text>
            </View>
          ))}
        </View>

        <View style={s.buttonRow}>
          <TouchableOpacity style={s.cancelBtn} onPress={() => navigation.goBack()}>
            <Text style={s.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.submitBtn, (submitting || totalDays <= 0) && s.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={submitting || totalDays <= 0}
          >
            <Text style={s.submitText}>{submitting ? 'Submitting...' : 'Submit Request'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  form: { padding: 20, gap: 16 },
  formTitle: { fontSize: 22, fontWeight: 'bold', color: c.text },
  formSubtitle: { fontSize: 13, color: c.textSecondary, marginTop: -8 },
  label: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
  typeRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  typeChip: { backgroundColor: c.card, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1, borderColor: c.border },
  typeChipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  typeChipText: { color: c.textSecondary, fontSize: 14 },
  typeChipTextActive: { color: '#fff', fontWeight: '600' },

  // ── Days Display (matches web's styled box) ──
  daysDisplay: { backgroundColor: '#f9fafb', borderRadius: 8, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#f0f2f5' },
  daysLabelText: { fontSize: 14, color: c.textSecondary },
  daysValue: { fontSize: 18, fontWeight: 'bold', color: c.text },

  halfDayRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: c.border, justifyContent: 'center', alignItems: 'center' },
  checkboxActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  halfDayLabel: { color: c.textPrimary, fontSize: 15 },
  input: { backgroundColor: c.card, borderRadius: 10, padding: 14, color: c.textPrimary, fontSize: 15, borderWidth: 1, borderColor: c.border },
  textArea: { minHeight: 100, textAlignVertical: 'top' },

  // ── Error ──
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { fontSize: 12, color: '#ef4444' },

  // ── Tiers Verification (Approval Workflow) ──
  tierSection: { backgroundColor: c.card, borderRadius: 10, borderWidth: 1, borderColor: c.border, padding: 12, gap: 6 },
  tierHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  tierTitle: { fontSize: 14, fontWeight: '700', color: c.textPrimary },
  tierProgress: { fontSize: 12, color: c.textSecondary },
  tierProgressBold: { fontWeight: '700', color: c.textPrimary },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f9fafb', borderRadius: 8, padding: 10 },
  stepLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: c.textPrimary },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  stepStatus: { fontSize: 12, fontWeight: '600', color: '#b45309' },

  // ── Buttons (matches web modal-footer pattern) ──
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
  cancelBtnText: { color: c.textSecondary, fontSize: 15, fontWeight: '600' },
  submitBtn: { flex: 1, backgroundColor: '#FF6600', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});
