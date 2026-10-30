import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert, ScrollView, StyleSheet } from 'react-native';
import { collection, query, where, onSnapshot } from '../aws/firestore-compat';
import { db } from '../aws/clients';
import { useAuth } from '../context/AuthContext';
import { useCompany } from '../context/CompanyContext';
import { useTheme } from '../context/ThemeContext';
import { Icon } from '../utils/icons';
import { scopedCompanyIdsForRole } from '../utils/companyScope';
import {
  TIER_LABELS,
  getEffectiveTiers,
  getLiveTiers,
  getActionableLeaveTier,
  reviewTierLeaveRequest,
  reviewMasterAdminLeaveRequest,
} from '../services/leaveService';
import {
  getRecordEffectiveMissedPunchTiers,
  computeMissedPunchProgress,
  computeMissedPunchTotalTiers,
  MISSED_PUNCH_TIER_LABELS,
  MISSED_PUNCH_MASTER_ADMIN_LABEL,
  reviewMasterAdminMissedPunch,
} from '../services/attendanceApi';
import { logAudit } from '../services/auditLogService';
import type { ApprovalTier } from '../types/user';

const toDate = (v: any): Date | null => {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const fmtDate = (v: any): string => {
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '--';
};

// Handles Firestore Timestamp (web-written rectifications), ISO strings and
// Date alike — `new Date(Timestamp)` would render "Invalid Date".
const fmtTime = (v: any): string => {
  const d = toDate(v);
  return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '--';
};

const CHAIN_CONF: Record<string, { bg: string; tc: string }> = {
  Approved: { bg: '#dcfce7', tc: '#16a34a' },
  Rejected: { bg: '#fee2e2', tc: '#ef4444' },
  Pending: { bg: '#fef3c7', tc: '#b45309' },
};

interface PanelItem {
  kind: 'leave' | 'punch';
  id: string;
  name: string;
  detail: string;
  sub?: string;
  payload: any;
  requestedAt: Date;
}

interface LeaveApprovalsPanelProps {
  /**
   * 'tiers' (default) — leave requests routed to the signed-in user at the
   * next pending tier (Employee RM→HR→CA / RM HR→CA / HR CA / Executive
   * TL / Team-Leader no-chain resolved by getEffectiveTiers + approver stamp).
   * 'masterAdmin' — final-gate items (leaves + missed punches) awaiting the
   * Master Admin, with a mandatory remark (matches web's
   * MasterAdminApprovalsPanel).
   */
  mode?: 'tiers' | 'masterAdmin';
  title?: string;
}

/**
 * Mobile port of the web's LeaveApprovalsPanel / MasterAdminApprovalsPanel:
 * pending leave (and, in masterAdmin mode, missed-punch) queues with an Eye
 * view of the full verification chain, dynamic x/y progress, and Approve /
 * Reject actions gated to the currently authorized approver. Reads the same
 * Firestore collections as the website (shared backend).
 */
export const LeaveApprovalsPanel: React.FC<LeaveApprovalsPanelProps> = ({ mode = 'tiers', title }) => {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();

  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );
  const scopeKey = scopeIds.filter(Boolean).join(',');

  const [leaves, setLeaves] = useState<any[]>([]);
  const [punches, setPunches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [closed, setClosed] = useState(false);
  const [view, setView] = useState<PanelItem | null>(null);
  const [review, setReview] = useState<(PanelItem & { action: 'Approved' | 'Rejected'; tier?: ApprovalTier | null }) | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── Data: same queries the website runs ──
  useEffect(() => {
    if (mode !== 'tiers') return;
    const ids = scopeKey ? scopeKey.split(',') : [];
    if (ids.length === 0) { setLeaves([]); setLoading(false); return; }
    setLoading(true);
    const slices: Record<string, any[]> = {};
    const unsubs = ids.map((cid) =>
      onSnapshot(
        query(collection(db, 'leaveRequests'), where('companyId', '==', cid), where('status', '==', 'Pending')),
        (snap) => {
          slices[cid] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setLeaves(Object.values(slices).flat());
          setLoading(false);
        },
        () => {
          slices[cid] = [];
          setLeaves(Object.values(slices).flat());
          setLoading(false);
        }
      )
    );
    return () => { unsubs.forEach((u) => { try { u(); } catch {} }); };
  }, [mode, scopeKey]);

  useEffect(() => {
    if (mode !== 'masterAdmin') return;
    setLoading(true);
    const inScope = (cid?: string) => scopeIds.length === 0 || !cid || scopeIds.includes(cid);
    const leaveRows: any[] = [];
    const punchRows: any[] = [];
    let leaveDone = false;
    let punchDone = false;
    const emit = () => {
      if (!leaveDone || !punchDone) return;
      setLeaves(leaveRows);
      setPunches(punchRows);
      setLoading(false);
    };
    const unsubLeaves = onSnapshot(
      query(collection(db, 'leaveRequests'), where('masterAdminRequired', '==', true)),
      (snap) => {
        leaveRows.length = 0;
        snap.docs.forEach((d) => {
          const data = d.data();
          const maStatus = data.masterAdminApproveStatus;
          if (maStatus && maStatus !== 'Pending') return;
          if (data.status === 'Approved' || data.status === 'Rejected' || data.status === 'Cancelled') return;
          if (!inScope(data.companyId)) return;
          const approvalStatus = data.approvalStatus || {};
          const tiers = getEffectiveTiers(data.applicantRole);
          if (tiers.length > 0 && !tiers.every((t) => approvalStatus[t] === 'Approved')) return;
          leaveRows.push({ id: d.id, ...data });
        });
        leaveDone = true;
        emit();
      },
      () => { leaveDone = true; emit(); }
    );
    const unsubPunches = onSnapshot(
      query(collection(db, 'attendance'), where('missedPunchRectification.masterAdminRequired', '==', true)),
      (snap) => {
        punchRows.length = 0;
        snap.docs.forEach((d) => {
          const data = d.data();
          const mp = data.missedPunchRectification || {};
          if (!mp.masterAdminRequired) return;
          const maStatus = mp.masterAdminApproveStatus;
          if (maStatus && maStatus !== 'Pending') return;
          if (!inScope(data.companyId)) return;
          const approvalStatus = mp.approvalStatus || {};
          const tiers = getRecordEffectiveMissedPunchTiers(mp);
          if (tiers.length > 0 && !tiers.every((t: any) => approvalStatus[t] === 'Approved')) return;
          punchRows.push({ id: d.id, ...data });
        });
        punchDone = true;
        emit();
      },
      () => { punchDone = true; emit(); }
    );
    return () => { try { unsubLeaves(); } catch {} try { unsubPunches(); } catch {} };
  }, [mode, scopeKey]);

  // ── Rows ──
  const rows: PanelItem[] = useMemo(() => {
    if (mode === 'masterAdmin') {
      const leaveItems: PanelItem[] = leaves.map((l) => ({
        kind: 'leave' as const,
        id: l.id,
        name: l.employeeName || l.userName || 'Unknown',
        detail: `${l.leaveType || l.type || 'Leave'} · ${fmtDate(l.startDate)} → ${fmtDate(l.endDate)} (${l.totalDays || 0}d)`,
        sub: 'All tiers approved — awaiting Master Admin',
        payload: l,
        requestedAt: toDate(l.appliedOn) || new Date(0),
      }));
      const punchItems: PanelItem[] = punches.map((p) => {
        const mp = p.missedPunchRectification || {};
        const tiers = getRecordEffectiveMissedPunchTiers(mp);
        return {
          kind: 'punch' as const,
          id: p.id,
          name: p.name || p.userName || 'Unknown',
          detail: `Missed Punch · ${fmtDate(p.date)}`,
          sub: `${mp.correctedCheckOut ? `Corrected check-out ${fmtTime(mp.correctedCheckOut)} · ` : ''}${tiers.length === 0 ? 'All tiers auto-completed' : `${tiers.map((t: any) => (MISSED_PUNCH_TIER_LABELS as Record<string, string>)[t]).join(' + ')} approved`} — awaiting Master Admin`,
          payload: p,
          requestedAt: toDate(mp.requestedAt) || toDate(p.date) || new Date(0),
        };
      });
      return [...leaveItems, ...punchItems].sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
    }
    return leaves
      .map((l) => ({ l, tier: getActionableLeaveTier(l, user?.id || '', user?.role, scopeIds.length > 0 ? scopeIds : undefined) }))
      .filter((x): x is { l: any; tier: ApprovalTier } => !!x.tier)
      .sort((a, b) => (toDate(b.l.appliedOn)?.getTime() || 0) - (toDate(a.l.appliedOn)?.getTime() || 0))
      .map(({ l, tier }) => ({
        kind: 'leave' as const,
        id: l.id,
        name: l.employeeName || l.userName || 'Unknown',
        detail: `${l.leaveType || l.type || 'Leave'} · ${fmtDate(l.startDate)} → ${fmtDate(l.endDate)} (${l.totalDays || 0}d)`,
        sub: TIER_LABELS[tier],
        payload: l,
        requestedAt: toDate(l.appliedOn) || new Date(0),
        tier,
      }));
  }, [mode, leaves, punches, user?.id, user?.role, scopeKey]);

  const rowsWithTier = rows as Array<PanelItem & { tier?: ApprovalTier }>;

  // x/y progress for a leave chain — live tiers only (skipped tiers have no
  // approver; counting them left the counter stuck below 100% forever)
  const leaveProgress = (l: any) => {
    const effective = getLiveTiers(l);
    const maStep = l.masterAdminRequired ? 1 : 0;
    const total = effective.length + maStep;
    const resolved = effective.filter((t: ApprovalTier) => l.approvalStatus?.[t] === 'Approved').length;
    const done = resolved + (l.masterAdminRequired && l.masterAdminApproveStatus && l.masterAdminApproveStatus !== 'Pending' ? 1 : 0);
    if (total === 0) return { total: 1, done: 1 }; // every tier skipped → auto-approved
    return { total, done };
  };

  const startReview = (item: PanelItem & { tier?: ApprovalTier }, action: 'Approved' | 'Rejected') => {
    setNote('');
    setReview({ ...item, action, tier: item.tier ?? null });
  };

  const confirmReview = async () => {
    if (!review || !user) return;
    const needNote = true; // Web LeaveReviewModal: a remark is required for EVERY decision (Approve too).
    if (needNote && !note.trim()) {
      Alert.alert('Remark required', 'A remark is required for this review.');
      return;
    }
    setSubmitting(true);
    try {
      if (review.kind === 'leave') {
        if (mode === 'tiers' && review.tier) {
          await reviewTierLeaveRequest(review.id, review.tier, review.action, user.id, user.name || 'User', note.trim());
        } else {
          await reviewMasterAdminLeaveRequest(review.id, review.action, user.id, user.name || 'User', note.trim());
        }
      } else {
        await reviewMasterAdminMissedPunch(review.id, review.action, user.id, user.name || 'User', note.trim());
      }
      await logAudit({
        userId: user.id,
        userName: user.name || 'User',
        userRole: user.role || '',
        action:
          review.kind === 'leave'
            ? `${review.action} leave at ${mode === 'tiers' && review.tier ? TIER_LABELS[review.tier] : 'Master Admin'} tier`
            : `${review.action} missed punch at Master Admin tier`,
        actionType: review.action === 'Approved' ? 'approve' : 'reject',
        module: 'Dashboard',
        targetEntity: review.name,
        status: 'success',
      }).catch(() => {});
      setLeaves((prev) => prev.filter((l) => l.id !== review!.id));
      setPunches((prev) => prev.filter((p) => p.id !== review!.id));
      setReview(null);
      setNote('');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to review request');
    } finally {
      setSubmitting(false);
    }
  };

  const panelTitle = title || (mode === 'masterAdmin' ? 'Master Admin Verification' : 'Leave Approvals');
  const countLabel =
    mode === 'masterAdmin'
      ? `${rows.length} awaiting Master Admin`
      : `${rows.length} awaiting your verification`;
  const tint = mode === 'masterAdmin' ? '#c2410c' : '#8b5cf6';

  return (
    <View style={{ marginBottom: 12 }}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={[styles.headerIcon, { backgroundColor: `${tint}14` }]}>
          <Icon
            name={mode === 'masterAdmin' ? 'shield-checkmark-outline' : 'checkmark-done-outline'}
            size={15}
            color={tint}
          />
        </View>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{panelTitle}</Text>
        {/* Count is always shown — an empty header looked unfinished, and the
            number is the whole point of a verification queue. */}
        <View style={[styles.countPill, { backgroundColor: `${tint}15` }]}>
          <Text style={[styles.countPillText, { color: tint }]}>{countLabel}</Text>
        </View>
        <TouchableOpacity
          style={[styles.collapseBtn, { borderColor: colors.border }]}
          onPress={() => setClosed((c) => !c)}
        >
          <Icon name={closed ? 'chevron-down-outline' : 'chevron-up-outline'} size={14} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {!closed && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderLight || colors.border }]}>
          {loading ? (
            <View style={styles.emptyWrap}>
              <ActivityIndicator size="small" color="#8b5cf6" />
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>Loading leave requests...</Text>
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.emptyBlock}>
              <View style={[styles.emptyIcon, { backgroundColor: `${tint}14` }]}>
                <Icon name="checkmark-done-outline" size={20} color={tint} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>All caught up</Text>
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                {mode === 'masterAdmin'
                  ? 'No leave requests or missed-punch corrections are awaiting Master Admin verification.'
                  : 'No leave requests are awaiting your verification.'}
              </Text>
            </View>
          ) : (
            rowsWithTier.map((item) => {
              const isLeave = item.kind === 'leave';
              const prog = isLeave ? leaveProgress(item.payload) : null;
              const mpTotal = !isLeave ? computeMissedPunchTotalTiers(item.payload.missedPunchRectification) : 0;
              const mpDone = !isLeave ? computeMissedPunchProgress(item.payload.missedPunchRectification) : 0;
              const done = prog ? prog.done : mpDone;
              const total = prog ? prog.total : mpTotal;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <View key={`${item.kind}-${item.id}`} style={[styles.row, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[styles.rowDetail, { color: colors.textSecondary }]} numberOfLines={2}>{item.detail}</Text>
                    {!!item.sub && (
                      <View style={[styles.tierPill, { backgroundColor: mode === 'masterAdmin' ? '#fff7ed' : '#f3e8ff' }]}>
                        <Text style={[styles.tierPillText, { color: mode === 'masterAdmin' ? '#c2410c' : '#9333ea' }]}>
                          {mode === 'masterAdmin' ? 'Awaiting Master Admin' : `Next: ${item.sub}`}
                        </Text>
                      </View>
                    )}
                    {/* Dynamic progress (e.g. 1/4, 2/3, 1/2, 1/1) */}
                    <View style={{ marginTop: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                        <Text style={[styles.progressLabel, { color: colors.textTertiary }]}>Verification Progress</Text>
                        <Text style={[styles.progressLabel, { color: '#9333ea', fontWeight: '700' }]}>{Math.min(done, total)}/{total}</Text>
                      </View>
                      <View style={[styles.progressTrack, { backgroundColor: '#e9d5ff' }]}>
                        <View style={[styles.progressFill, { width: `${pct}%` }]} />
                      </View>
                    </View>
                  </View>

                  {/* Actions: Eye view + Approve / Reject */}
                  <View style={styles.actionsCol}>
                    <TouchableOpacity
                      style={[styles.actionBtn, { borderColor: colors.border }]}
                      onPress={() => setView(item)}
                    >
                      <Icon name="eye-outline" size={14} color={colors.textSecondary} />
                      <Text style={[styles.actionText, { color: colors.textSecondary }]}>View</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' }]}
                      onPress={() => startReview(item, 'Approved')}
                    >
                      <Icon name="checkmark-circle-outline" size={14} color="#16a34a" />
                      <Text style={[styles.actionText, { color: '#16a34a' }]}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#fee2e2', borderColor: '#fecaca' }]}
                      onPress={() => startReview(item, 'Rejected')}
                    >
                      <Icon name="close-circle-outline" size={14} color="#ef4444" />
                      <Text style={[styles.actionText, { color: '#ef4444' }]}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>
      )}

      {/* ── VIEW MODAL (Eye) — read-only chain inspection ── */}
      <Modal visible={!!view} transparent animationType="fade" onRequestClose={() => setView(null)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setView(null)}>
          <ScrollView>
            <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setView(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close-outline" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
              {view && (() => {
                const isLeave = view.kind === 'leave';
                const payload = view.payload;
                const leaveChains = isLeave ? getEffectiveTiers(payload.applicantRole) : [];
                const punchChains = !isLeave ? getRecordEffectiveMissedPunchTiers(payload.missedPunchRectification || {}) : [];
                const approvalStatus = isLeave ? payload.approvalStatus || {} : (payload.missedPunchRectification || {}).approvalStatus || {};
                const maRequired = isLeave ? !!payload.masterAdminRequired : !!(payload.missedPunchRectification || {}).masterAdminRequired;
                const maStatus = isLeave ? payload.masterAdminApproveStatus : (payload.missedPunchRectification || {}).masterAdminApproveStatus;
                const prog = isLeave ? leaveProgress(payload) : null;
                const total = prog ? prog.total : computeMissedPunchTotalTiers(payload.missedPunchRectification);
                const done = prog ? prog.done : computeMissedPunchProgress(payload.missedPunchRectification);
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                const overall = isLeave ? payload.status : ((payload.missedPunchRectification || {}).status || (payload.missedPunchRectification?.resolved ? 'Approved' : 'Pending'));
                const log = isLeave ? payload.approvalLog || [] : [];
                return (
                  <>
                    <Text style={[styles.modalTitle, { color: colors.text }]}>{view.name}</Text>
                    <Text style={[styles.modalDetail, { color: colors.textSecondary }]}>{view.detail}</Text>
                    {isLeave && !!payload.reason && (
                      <Text style={[styles.reason, { color: colors.textSecondary }]}>Reason: {payload.reason}</Text>
                    )}

                    <View style={styles.chainBox}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={styles.chainLabel}>Verification Progress</Text>
                        <Text style={styles.chainCount}>{Math.min(done, total)}/{total}</Text>
                      </View>
                      <View style={[styles.progressTrack, { backgroundColor: '#e9d5ff', marginBottom: 10 }]}>
                        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: overall === 'Rejected' ? '#ef4444' : '#9333ea' }]} />
                      </View>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {(isLeave ? leaveChains : punchChains).map((t: any) => {
                          const st = approvalStatus[t] || 'Pending';
                          const c = CHAIN_CONF[st] || CHAIN_CONF.Pending;
                          const label = isLeave ? (TIER_LABELS as Record<string, string>)[t] : (MISSED_PUNCH_TIER_LABELS as Record<string, string>)[t];
                          return (
                            <View key={t} style={{ backgroundColor: c.bg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                              <Text style={{ fontSize: 10, fontWeight: '600', color: c.tc }}>{label}: {st}</Text>
                            </View>
                          );
                        })}
                        {maRequired && (
                          <View style={{ backgroundColor: maStatus === 'Approved' ? '#dcfce7' : maStatus === 'Rejected' ? '#fee2e2' : '#fff7ed', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ fontSize: 10, fontWeight: '600', color: maStatus === 'Approved' ? '#16a34a' : maStatus === 'Rejected' ? '#ef4444' : '#9a3412' }}>
                              {isLeave ? 'Master Admin' : MISSED_PUNCH_MASTER_ADMIN_LABEL}: {maStatus || 'Pending'}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {log.length > 0 && (
                      <View style={{ marginTop: 12 }}>
                        <Text style={[styles.chainLabel, { marginBottom: 6 }]}>Approval Log</Text>
                        {log.map((entry: any, idx: number) => (
                          <View key={idx} style={[styles.logRow, { borderBottomColor: colors.border }]}>
                            <Text style={[styles.logTier, { color: colors.text }]}>{(TIER_LABELS as Record<string, string>)[entry.tier] || entry.tier}</Text>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: entry.status === 'Approved' ? '#16a34a' : '#ef4444' }}>{entry.status}</Text>
                            <Text style={[styles.logMeta, { color: colors.textTertiary }]}>
                              {entry.approvedByName || ''} · {toDate(entry.approvedOn) ? new Date(toDate(entry.approvedOn)!).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
                            </Text>
                            {!!entry.note && <Text style={[styles.logNote, { color: colors.textSecondary }]} numberOfLines={2}>“{entry.note}”</Text>}
                          </View>
                        ))}
                      </View>
                    )}

                    <TouchableOpacity style={[styles.closeModalBtn, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }]} onPress={() => setView(null)}>
                      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>Close</Text>
                    </TouchableOpacity>
                  </>
                );
              })()}
            </View>
          </ScrollView>
        </TouchableOpacity>
      </Modal>

      {/* ── REVIEW MODAL (Approve / Reject with remark) ── */}
      <Modal visible={!!review} transparent animationType="slide" onRequestClose={() => !submitting && setReview(null)}>
        <View style={styles.overlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {review?.action === 'Approved' ? 'Approve' : 'Reject'} {review?.kind === 'leave' ? 'Leave' : 'Missed Punch'}
            </Text>
            <Text style={[styles.modalDetail, { color: colors.textSecondary }]}>
              {review?.name}{review?.detail ? ` · ${review.detail}` : ''}
            </Text>
            {mode === 'tiers' && review?.tier ? (
              <Text style={{ fontSize: 13, color: '#9333ea', fontWeight: '600', marginTop: 6 }}>
                Acting at tier: {TIER_LABELS[review.tier]}
              </Text>
            ) : (
              <Text style={{ fontSize: 13, color: '#c2410c', fontWeight: '600', marginTop: 6 }}>
                Master Admin final verification
              </Text>
            )}

            <Text style={[styles.inputLabel, { color: colors.text }]}>
              Remark <Text style={{ color: '#ef4444' }}>*</Text>
            </Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
              placeholder="Add a remark for the audit trail..."
              placeholderTextColor={colors.textTertiary}
              value={note}
              onChangeText={setNote}
              multiline
            />

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity
                style={[styles.modalAction, { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, flex: 1 }]}
                disabled={submitting}
                onPress={() => { setReview(null); setNote(''); }}
              >
                <Text style={{ color: colors.text, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalAction, {
                  flex: 1,
                  backgroundColor:
                    submitting ? '#d1d5db' : review?.action === 'Approved' ? '#16a34a' : '#ef4444',
                }]}
                disabled={submitting}
                onPress={confirmReview}
              >
                {submitting ? <ActivityIndicator size="small" color="#fff" /> : (
                  <Text style={{ color: '#fff', fontWeight: '700' }}>
                    {review?.action === 'Approved' ? 'Approve' : 'Reject'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, paddingHorizontal: 2 },
  headerIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  countPill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  countPillText: { fontSize: 10, fontWeight: '700' },
  collapseBtn: { marginLeft: 'auto', borderWidth: 1, borderRadius: 8, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  emptyWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18 },
  emptyBlock: { alignItems: 'center', paddingVertical: 22, paddingHorizontal: 18, gap: 6 },
  emptyIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  emptyTitle: { fontSize: 14, fontWeight: '700' },
  emptyText: { fontSize: 13, textAlign: 'center', paddingHorizontal: 16 },
  row: { flexDirection: 'row', gap: 10, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
  rowName: { fontSize: 14, fontWeight: '700' },
  rowDetail: { fontSize: 12, marginTop: 2 },
  tierPill: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  tierPillText: { fontSize: 10, fontWeight: '700' },
  progressLabel: { fontSize: 10, fontWeight: '600' },
  progressTrack: { height: 5, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#9333ea', borderRadius: 3 },
  actionsCol: { gap: 6, alignItems: 'stretch', minWidth: 92 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8 },
  actionText: { fontSize: 11, fontWeight: '700' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 18 },
  modalCard: { width: '100%', maxWidth: 480, alignSelf: 'center', borderRadius: 16, padding: 18, maxHeight: '85%' },
  closeBtn: { position: 'absolute', top: 12, right: 12, zIndex: 2 },
  modalTitle: { fontSize: 17, fontWeight: '800', paddingRight: 28 },
  modalDetail: { fontSize: 13, marginTop: 4 },
  reason: { fontSize: 13, marginTop: 10 },
  chainBox: { marginTop: 14, padding: 12, backgroundColor: '#faf5ff', borderRadius: 10, borderWidth: 1, borderColor: '#e9d5ff' },
  chainLabel: { fontSize: 11, fontWeight: '700', color: '#6b21a8' },
  chainCount: { fontSize: 11, fontWeight: '800', color: '#6b21a8' },
  logRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  logTier: { fontSize: 11, fontWeight: '700' },
  logMeta: { fontSize: 10 },
  logNote: { fontSize: 11, width: '100%' },
  closeModalBtn: { marginTop: 16, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  inputLabel: { fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14, minHeight: 72, textAlignVertical: 'top' },
  modalAction: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
});
