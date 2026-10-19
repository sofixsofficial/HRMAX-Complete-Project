import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, FlatList, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { subscribeEmails, subscribeEmailsScoped, saveEmail, sendAndDeliverEmail, updateEmail, deleteEmail, archiveEmail, toggleStar, markAsRead } from '../../services/emailService';
import { subscribeEmployees, subscribeEmployeesScoped } from '../../services/employeeService';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { HeroBanner, PremiumCard, PremiumSearchBar, StatusBadge, EmptyStateView, FloatingActionButton, PremiumBottomSheet, PremiumModal } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Icon } from '../../utils/icons';
import { getSalarySlipsByCompany, dispatchPayslips, retryFailedPayslips, DispatchPayslipsResult } from '../../services/salaryService';
import { SalarySlip } from '../../types/user';

interface Email {
  id: string; from: string; fromEmail: string; to: string; toEmail: string;
  cc?: string; bcc?: string; subject: string; body: string; date: string;
  type: string; status: string; read: boolean; starred: boolean;
  attachments?: any[]; templateId?: string; scheduledFor?: string;
  recipientGroup?: string; companyId: string; replyToId?: string;
  forwardOfId?: string; threadId?: string; sentAt?: string;
  deliveredAt?: string; openedAt?: string; clickedAt?: string;
  tracking?: { sent?: boolean; delivered?: boolean; opened?: boolean; clicked?: boolean };
}

type EmailTab = 'inbox' | 'sent' | 'drafts' | 'scheduled' | 'trash' | 'payroll';
const TABS: { key: EmailTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'inbox', label: 'Inbox', icon: 'mail-outline' },
  { key: 'sent', label: 'Sent', icon: 'send-outline' },
  { key: 'drafts', label: 'Drafts', icon: 'document-text-outline' },
  { key: 'scheduled', label: 'Scheduled', icon: 'calendar-outline' },
  { key: 'trash', label: 'Trash', icon: 'trash-outline' },
  { key: 'payroll', label: 'Payroll', icon: 'wallet-outline' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const STATUS_COLORS: Record<string, string> = {
  Sent: '#3b82f6', Delivered: '#22c55e', Opened: '#8b5cf6', Failed: '#ef4444',
  Draft: '#6b7280', Scheduled: '#f59e0b', Archived: '#6b7280', Deleted: '#ef4444',
};

const EMAIL_TEMPLATES = [
  { id: 'welcome', name: 'Welcome Message', subject: 'Welcome to HR MAX!', body: 'Dear Employee,\n\nWelcome to our team! We are excited to have you on board.\n\nBest regards,\nHR Team' },
  { id: 'holiday', name: 'Holiday Announcement', subject: 'Holiday Announcement', body: 'Dear Team,\n\nPlease be informed that the office will remain closed on [DATE] on account of [HOLIDAY].\n\nBest regards,\nHR Team' },
  { id: 'payroll', name: 'Salary Slip', subject: 'Your Salary Slip', body: 'Dear Employee,\n\nPlease find attached your salary slip for [MONTH] [YEAR].\n\nBest regards,\nHR Team' },
  { id: 'meeting', name: 'Meeting Notice', subject: 'Meeting Notice', body: 'Dear Team,\n\nThis is to inform you that a meeting has been scheduled on [DATE] at [TIME] in [VENUE].\n\nAgenda:\n1. [TOPIC]\n\nPlease make it convenient to attend.\n\nBest regards,\nHR Team' },
  { id: 'birthday', name: 'Birthday Wish', subject: 'Happy Birthday!', body: 'Dear [NAME],\n\nWishing you a very Happy Birthday! May this special day bring you joy, happiness, and success.\n\nBest regards,\nHR Team' },
  { id: 'appraisal', name: 'Appraisal Reminder', subject: 'Performance Appraisal', body: 'Dear Employee,\n\nThis is a reminder that your performance appraisal is scheduled for [DATE]. Please prepare your self-assessment.\n\nBest regards,\nHR Team' },
];

const RECIPIENT_GROUPS = [
  { id: 'all-employees', name: 'All Employees', description: 'Every active employee in the company' },
  { id: 'all-admins', name: 'All Admins', description: 'Company Admins and Master Admins' },
  { id: 'all-team-leaders', name: 'All Team Leaders', description: 'All team leaders across departments' },
  { id: 'all-executives', name: 'All Executives', description: 'All executives' },
  { id: 'department', name: 'By Department', description: 'Employees with a department assigned' },
  { id: 'new-joiners', name: 'New Joiners', description: 'Employees who joined in the last 30 days' },
];

const PAYROLL_EMAIL_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  Sent: { label: 'Sent', color: '#059669', bg: '#ecfdf5' },
  Failed: { label: 'Failed', color: '#dc2626', bg: '#fef2f2' },
  Retrying: { label: 'Retrying…', color: '#b45309', bg: '#fffbeb' },
  'Not sent': { label: 'Not sent', color: '#6b7280', bg: '#f3f4f6' },
};

const formatDate = (v: any): string => {
  if (!v) return '';
  try {
    const d = typeof v === 'string' ? new Date(v) : v?.toDate ? v.toDate() : v?.seconds ? new Date(v.seconds * 1000) : null;
    if (!d || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function EmailCenterScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const { colors, isDark } = useTheme();

  const [activeTab, setActiveTab] = useState<EmailTab>('inbox');
  const [emails, setEmails] = useState<Email[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [showViewer, setShowViewer] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeBcc, setComposeBcc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeScheduled, setComposeScheduled] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  // ─── Bulk selection state ───────────────────────────────────────────
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set());
  const [bulkOperating, setBulkOperating] = useState(false);

  // ─── Payroll distribution state ─────────────────────────────────────
  const [payrollCompanyId, setPayrollCompanyId] = useState(effectiveCompanyId || '');
  const [payrollMonth, setPayrollMonth] = useState(new Date().getMonth());
  const [payrollYear, setPayrollYear] = useState(new Date().getFullYear());
  const [salarySlips, setSalarySlips] = useState<SalarySlip[]>([]);
  const [selectedSlipIds, setSelectedSlipIds] = useState<Set<string>>(new Set());
  const [loadingSlips, setLoadingSlips] = useState(false);
  const [sendingPayroll, setSendingPayroll] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );

  useEffect(() => {
    if (scopeIds.length === 0) {
      if (isRestrictedScope) { setEmails([]); setLoading(false); return; }
      const unsubAll = subscribeEmails(null, (data) => {
        setEmails(data);
        setLoading(false);
      });
      return unsubAll;
    }
    const unsub = subscribeEmailsScoped(scopeIds, (data) => {
      setEmails(data);
      setLoading(false);
    });
    return unsub;
  }, [scopeIds, isRestrictedScope]);

  useEffect(() => {
    if (!showCompose) return;
    if (scopeIds.length === 0) {
      if (isRestrictedScope) { setEmployees([]); return; }
      const unsubAll = subscribeEmployees(null, (emps) => setEmployees(emps));
      return unsubAll;
    }
    const unsub = subscribeEmployeesScoped(scopeIds, (emps) => setEmployees(emps));
    return unsub;
  }, [showCompose, scopeIds, isRestrictedScope]);

  const filtered = emails.filter(e => {
    const matchesTab = activeTab === 'inbox' ? !['Draft', 'Scheduled', 'Deleted'].includes(e.status)
      : activeTab === 'sent' ? ['Sent', 'Delivered', 'Opened', 'Clicked', 'Failed'].includes(e.status)
      : activeTab === 'drafts' ? e.status === 'Draft'
      : activeTab === 'scheduled' ? e.status === 'Scheduled'
      : e.status === 'Deleted';
    if (!searchTerm) return matchesTab;
    const s = searchTerm.toLowerCase();
    return matchesTab && (
      e.subject?.toLowerCase().includes(s) ||
      e.from?.toLowerCase().includes(s) ||
      e.to?.toLowerCase().includes(s)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, activeTab]);

  // ─── Bulk selection helpers ──────────────────────────────────────────
  const isAllSelected = paginated.length > 0 && paginated.every(e => selectedEmailIds.has(e.id));
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedEmailIds(new Set());
    } else {
      setSelectedEmailIds(new Set(paginated.map(e => e.id)));
    }
  };
  const toggleSelectEmail = (id: string) => {
    setSelectedEmailIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedEmailIds(new Set());

  const handleBulkMarkRead = async () => {
    if (selectedEmailIds.size === 0) return;
    setBulkOperating(true);
    try {
      for (const id of selectedEmailIds) {
        await markAsRead(id).catch(() => {});
      }
      clearSelection();
    } catch { /* partial success is ok */ }
    setBulkOperating(false);
  };

  const handleBulkArchive = async () => {
    if (selectedEmailIds.size === 0) return;
    setBulkOperating(true);
    try {
      for (const id of selectedEmailIds) {
        await archiveEmail(id).catch(() => {});
      }
      clearSelection();
    } catch { /* partial success is ok */ }
    setBulkOperating(false);
  };

  const handleBulkDelete = () => {
    if (selectedEmailIds.size === 0) return;
    Alert.alert('Delete', `Move ${selectedEmailIds.size} email(s) to trash?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setBulkOperating(true);
          try {
            for (const id of selectedEmailIds) {
              await deleteEmail(id).catch(() => {});
            }
            clearSelection();
          } catch { /* partial success is ok */ }
          setBulkOperating(false);
        }
      },
    ]);
  };

  // ─── Payroll helpers ────────────────────────────────────────────────
  const slipEmailStatus = (slip: SalarySlip): 'Sent' | 'Failed' | 'Retrying' | 'Not sent' => {
    if (slip.emailSentAt && (slip.emailStatus === 'sent' || slip.payslipEmailStatus === 'sent')) return 'Sent';
    if (slip.emailStatus === 'failed' || slip.payslipEmailStatus === 'failed') return 'Failed';
    if (slip.emailStatus === 'retrying') return 'Retrying';
    return 'Not sent';
  };

  const fetchPayrollSlips = async () => {
    if (!payrollCompanyId) {
      Alert.alert('Select Company', 'Please select a company first.');
      return;
    }
    setLoadingSlips(true);
    try {
      const all = await getSalarySlipsByCompany(payrollCompanyId);
      const monthName = MONTHS[payrollMonth] || '';
      const slips = all.filter(s => s.month === monthName && s.year === payrollYear);
      setSalarySlips(slips);
      // Auto-select all non-sent slips
      const toSelect = new Set(slips.filter(s => slipEmailStatus(s) !== 'Sent').map(s => s.id));
      setSelectedSlipIds(toSelect);
    } catch (err) {
      console.error('Error loading payroll slips:', err);
      Alert.alert('Error', 'Failed to load salary slips.');
    } finally {
      setLoadingSlips(false);
    }
  };

  const handleSendPayrollEmails = async () => {
    if (selectedSlipIds.size === 0) {
      Alert.alert('No Selection', 'Select at least one salary slip to send.');
      return;
    }
    const selected = salarySlips.filter(s => selectedSlipIds.has(s.id));
    const employeeIds = selected.map(s => s.userId).filter(Boolean);
    if (employeeIds.length === 0) {
      Alert.alert('No Valid Employees', 'Selected slips have no valid employee IDs.');
      return;
    }
    setSendingPayroll(true);
    try {
      const result: DispatchPayslipsResult = await dispatchPayslips({
        companyId: payrollCompanyId,
        monthIndex: payrollMonth,
        year: payrollYear,
        payStatus: 'all',
        employeeIds,
        slipIds: selectedSlipIds.size < salarySlips.length ? Array.from(selectedSlipIds) : undefined,
      });
      if (result.success) {
        Alert.alert(
          'Done',
          result.message || `Dispatched ${result.dispatched || 0} salary slip(s).${(result.failed ?? 0) > 0 ? ` ${result.failed} failed.` : ''}`
        );
      } else {
        Alert.alert('Error', result.error || 'Failed to send payroll emails');
      }
      await fetchPayrollSlips(); // Refresh
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to send payroll emails');
    } finally {
      setSendingPayroll(false);
    }
  };

  const handleRetryFailedSlips = async () => {
    const failedSlips = salarySlips.filter(s => slipEmailStatus(s) === 'Failed');
    if (failedSlips.length === 0) {
      Alert.alert('No Failed', 'There are no failed emails to retry.');
      return;
    }
    setRetryingFailed(true);
    try {
      const result = await retryFailedPayslips({
        companyId: payrollCompanyId,
        monthIndex: payrollMonth,
        year: payrollYear,
        slipIds: failedSlips.map(s => s.id),
      });
      Alert.alert(
        result.success ? 'Retry Done' : 'Retry Failed',
        result.message || result.error || `Retried ${failedSlips.length} failed email(s).`
      );
      await fetchPayrollSlips();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to retry failed emails.');
    } finally {
      setRetryingFailed(false);
    }
  };

  const toggleSlipSelection = (id: string) => {
    setSelectedSlipIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllSlips = () => {
    if (selectedSlipIds.size === salarySlips.length && salarySlips.length > 0) {
      setSelectedSlipIds(new Set());
    } else {
      setSelectedSlipIds(new Set(salarySlips.map(s => s.id)));
    }
  };

  // Payroll stats
  const payrollStats = useMemo(() => {
    const total = salarySlips.length;
    const sent = salarySlips.filter(s => slipEmailStatus(s) === 'Sent').length;
    const failed = salarySlips.filter(s => slipEmailStatus(s) === 'Failed').length;
    const pending = total - sent - failed;
    return { total, sent, failed, pending };
  }, [salarySlips]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['From,To,Subject,Status,Date'];
      const rows = filtered.map(e => `${(e.from || e.fromEmail || '').replace(/,/g, ';')},${(e.to || e.toEmail || '').replace(/,/g, ';')},${(e.subject || '').replace(/,/g, ';')},${(e.status || '').replace(/,/g, ';')},${(e.date || '').replace(/,/g, ';')}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'emails_export.csv');
      file.create({ overwrite: true });
      file.write(csv);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const renderPagination = () => {
    if (filtered.length <= pageSize) return null;
    return (
      <View style={styles.paginationRow}>
        <TouchableOpacity style={[styles.pageBtn, { borderColor: colors.borderLight, backgroundColor: colors.card }, currentPage === 1 && styles.pageBtnDisabled]} disabled={currentPage === 1} onPress={() => setCurrentPage(p => Math.max(1, p - 1))}>
          <Icon name="chevron-back-outline" size={16} color={currentPage === 1 ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={[styles.pageInfo, { color: colors.text }]}>{currentPage} / {totalPages}</Text>
        <TouchableOpacity style={[styles.pageBtn, { borderColor: colors.borderLight, backgroundColor: colors.card }, currentPage === totalPages && styles.pageBtnDisabled]} disabled={currentPage === totalPages} onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
          <Icon name="chevron-forward-outline" size={16} color={currentPage === totalPages ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={[styles.pageSizeText, { color: colors.textSecondary }]}>Show:</Text>
        <TouchableOpacity style={[styles.pageSizeBtn, { borderColor: colors.borderLight, backgroundColor: colors.card }]} onPress={() => { const sizes = [5, 10, 20, 50]; const idx = sizes.indexOf(pageSize); setPageSize(sizes[(idx + 1) % sizes.length]); }}>
          <Text style={[styles.pageSizeBtnText, { color: colors.text }]}>{pageSize}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const handleSend = async () => {
    if (!composeTo.trim() || !composeSubject.trim()) {
      Alert.alert('Required', 'Recipient and subject are required');
      return;
    }
    setSending(true);
    try {
      const payload = {
        from: user?.name || '', fromEmail: user?.email || '',
        to: composeTo, toEmail: composeTo,
        cc: composeCc || '', bcc: composeBcc || '',
        subject: composeSubject, body: composeBody,
        date: new Date().toISOString(),
        type: 'Employee',
        status: composeScheduled ? 'Scheduled' : 'Sent',
        read: false, starred: false,
        companyId: effectiveCompanyId || '',
        recipientGroup: 'Individual Employee',
        scheduledFor: composeScheduled || undefined,
      };
      if (composeScheduled) {
        // Scheduled = save the record only (matches web — no immediate SMTP).
        await saveEmail(payload);
      } else {
        await sendAndDeliverEmail(payload);
      }
      setShowCompose(false);
      resetCompose();
    } catch (err) {
      Alert.alert('Error', 'Failed to send email');
    }
    setSending(false);
  };

  const handleSaveDraft = async () => {
    if (!composeSubject.trim() && !composeBody.trim()) {
      Alert.alert('Nothing to save', 'Write a subject or message first');
      return;
    }
    setSending(true);
    try {
      await saveEmail({
        from: user?.name || '', fromEmail: user?.email || '',
        to: composeTo, toEmail: composeTo,
        cc: composeCc || '', bcc: composeBcc || '',
        subject: composeSubject, body: composeBody,
        date: new Date().toISOString(),
        type: 'Employee', status: 'Draft',
        read: false, starred: false,
        companyId: effectiveCompanyId || '',
        recipientGroup: 'Individual Employee',
      });
      setShowCompose(false);
      resetCompose();
    } catch (err) {
      Alert.alert('Error', 'Failed to save draft');
    }
    setSending(false);
  };

  const resetCompose = () => {
    setComposeTo(''); setComposeCc(''); setComposeBcc('');
    setComposeSubject(''); setComposeBody(''); setComposeScheduled('');
    setSelectedTemplate(null); setSelectedGroup(null); setActiveFormats(new Set());
  };

  const applyTemplate = (templateId: string) => {
    const template = EMAIL_TEMPLATES.find(t => t.id === templateId);
    if (template) {
      setComposeSubject(template.subject);
      setComposeBody(template.body);
      setSelectedTemplate(templateId);
    }
  };

  const toggleFormat = (format: string) => {
    setActiveFormats(prev => {
      const next = new Set(prev);
      if (next.has(format)) next.delete(format);
      else next.add(format);
      return next;
    });
  };

  const insertFormat = (marker: string) => {
    setComposeBody(prev => prev + marker);
  };

  const resolveGroup = async (groupId: string) => {
    if (!effectiveCompanyId) return;
    const usersRef = collection(db, 'users');
    let q;
    switch (groupId) {
      case 'all-employees':
        q = query(usersRef, where('companyId', '==', effectiveCompanyId), where('status', '==', 'Active'));
        break;
      case 'all-admins':
        q = query(usersRef, where('companyId', '==', effectiveCompanyId), where('role', 'in', ['master-admin', 'company-admin']));
        break;
      case 'all-team-leaders':
        q = query(usersRef, where('companyId', '==', effectiveCompanyId), where('role', '==', 'team-leader'));
        break;
      case 'all-executives':
        q = query(usersRef, where('companyId', '==', effectiveCompanyId), where('role', '==', 'executive'));
        break;
      case 'new-joiners':
        q = query(usersRef, where('companyId', '==', effectiveCompanyId), where('status', '==', 'Active'));
        break;
      case 'department':
        q = query(usersRef, where('companyId', '==', effectiveCompanyId), where('status', '==', 'Active'));
        break;
      default:
        return;
    }
    try {
      const snap = await getDocs(q);
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const emails = snap.docs
        .map(d => {
          const docData = d.data();
          if (groupId === 'new-joiners' || groupId === 'department') {
            const joined = docData.joinDate?.toDate ? docData.joinDate.toDate() : docData.joinDate ? new Date(docData.joinDate) : null;
            if (groupId === 'new-joiners') {
              if (!joined || joined.getTime() < cutoff) return '';
            } else if (groupId === 'department' && !docData.departmentId) {
              return '';
            }
          }
          return docData.email || '';
        })
        .filter(Boolean);
      setComposeTo(emails.join(', '));
    } catch (err) {
      console.warn('Failed to resolve recipient group:', err);
    }
  };

  const openEmail = (email: Email) => {
    setSelectedEmail(email);
    setShowViewer(true);
    if (!email.read) markAsRead(email.id).catch(() => {});
  };

  const handleStar = (email: Email) => {
    toggleStar(email.id, email.starred).catch(() => {});
  };

  const handleArchive = (email: Email) => {
    archiveEmail(email.id).catch(() => {});
  };

  const handleDelete = (email: Email) => {
    Alert.alert('Delete', 'Move this email to trash?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteEmail(email.id).catch(() => {}) },
    ]);
  };

  const unreadCount = emails.filter(e =>
    !['Draft', 'Scheduled', 'Deleted'].includes(e.status) && !e.read
  ).length;

  const tabBadges: Record<string, number> = {
    inbox: unreadCount,
    drafts: emails.filter(e => e.status === 'Draft').length,
    scheduled: emails.filter(e => e.status === 'Scheduled').length,
  };

  const showBulkBar = selectedEmailIds.size > 0 && (activeTab === 'inbox' || activeTab === 'sent' || activeTab === 'drafts');

  const renderEmailItem = ({ item }: { item: Email }) => {
    const isSelected = selectedEmailIds.has(item.id);
    return (
      <TouchableOpacity
        style={[styles.emailItem, !item.read && styles.unreadItem, isSelected && { backgroundColor: isDark ? 'rgba(59,130,246,0.12)' : 'rgba(59,130,246,0.08)' }]}
        onPress={() => openEmail(item)}
      >
        <TouchableOpacity
          onPress={() => toggleSelectEmail(item.id)}
          style={styles.checkboxBtn}
        >
          <Ionicons
            name={isSelected ? 'checkbox' : 'square-outline'}
            size={20}
            color={isSelected ? colors.accent : colors.textSecondary}
          />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleStar(item)} style={styles.starBtn}>
          <Ionicons name={item.starred ? 'star' : 'star-outline'} size={18} color={item.starred ? '#f59e0b' : colors.textSecondary} />
        </TouchableOpacity>
        <View style={styles.emailContent}>
          <View style={styles.emailHeader}>
            <Text style={[styles.emailFrom, !item.read && styles.unreadText, { color: colors.text }]} numberOfLines={1}>
              {item.from || item.fromEmail}
            </Text>
            <Text style={[styles.emailDate, { color: colors.textSecondary }]}>
              {item.date ? new Date(item.date).toLocaleDateString() : ''}
            </Text>
          </View>
          <Text style={[styles.emailSubject, { color: colors.text }]} numberOfLines={1}>
            {item.subject}
          </Text>
          <View style={styles.emailMeta}>
            <StatusBadge status={item.status} color={item.status === 'Sent' || item.status === 'Delivered' || item.status === 'Opened' ? '#22c55e' : '#6b7280'} />
            {!item.read && <View style={styles.unreadDot} />}
          </View>
        </View>
        <View style={styles.emailActions}>
          {activeTab === 'inbox' && (
            <TouchableOpacity onPress={() => handleArchive(item)} style={styles.actionBtn}>
              <Ionicons name="archive-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => handleDelete(item)} style={styles.actionBtn}>
            <Ionicons name="trash-outline" size={18} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  // ─── Payroll tab UI ─────────────────────────────────────────────────
  const renderPayrollTab = () => (
    <ScrollView style={styles.payrollContainer} contentContainerStyle={{ paddingBottom: 80 }}>
      {/* Company selector */}
      {availableCompanies.length > 0 && (
        <View style={styles.payrollSection}>
          <Text style={[styles.payrollSectionLabel, { color: colors.textSecondary }]}>Company</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexDirection: 'row' }}>
            {availableCompanies.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[styles.payrollChip, payrollCompanyId === c.id && { backgroundColor: colors.accent, borderColor: colors.accent }]}
                onPress={() => setPayrollCompanyId(c.id)}
              >
                <Text style={[styles.payrollChipText, payrollCompanyId === c.id && { color: '#fff' }]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Month / Year selector */}
      <View style={styles.payrollSection}>
        <Text style={[styles.payrollSectionLabel, { color: colors.textSecondary }]}>Period</Text>
        <View style={styles.payrollPeriodRow}>
          <TouchableOpacity
            style={[styles.payrollPeriodBtn, { backgroundColor: colors.card, borderColor: colors.borderLight }]}
            onPress={() => {
              const prev = payrollMonth - 1;
              setPayrollMonth(prev < 0 ? 11 : prev);
              if (prev < 0) setPayrollYear(y => y - 1);
            }}
          >
            <Icon name="chevron-back-outline" size={18} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.payrollPeriodDisplay, { backgroundColor: colors.card, borderColor: colors.borderLight }]}
            onPress={() => setShowMonthPicker(true)}
          >
            <Icon name="calendar-outline" size={16} color={colors.accent} />
            <Text style={[styles.payrollPeriodText, { color: colors.text }]}>{MONTHS[payrollMonth]} {payrollYear}</Text>
            <Icon name="chevron-down-outline" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.payrollPeriodBtn, { backgroundColor: colors.card, borderColor: colors.borderLight }]}
            onPress={() => {
              const next = payrollMonth + 1;
              setPayrollMonth(next > 11 ? 0 : next);
              if (next > 11) setPayrollYear(y => y + 1);
            }}
          >
            <Icon name="chevron-forward-outline" size={18} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Load button */}
      <TouchableOpacity
        style={[styles.payrollLoadBtn, { backgroundColor: colors.accent }]}
        onPress={fetchPayrollSlips}
        disabled={loadingSlips || !payrollCompanyId}
      >
        {loadingSlips ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Icon name="refresh-outline" size={18} color="#fff" />
            <Text style={styles.payrollLoadBtnText}>Load Salary Slips</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Stats bar */}
      {salarySlips.length > 0 && (
        <View style={styles.payrollStatsRow}>
          <View style={[styles.payrollStat, { backgroundColor: isDark ? '#1e293b' : '#eff6ff' }]}>
            <Text style={[styles.payrollStatValue, { color: '#3b82f6' }]}>{payrollStats.total}</Text>
            <Text style={[styles.payrollStatLabel, { color: colors.textSecondary }]}>Total</Text>
          </View>
          <View style={[styles.payrollStat, { backgroundColor: isDark ? '#064e3b' : '#ecfdf5' }]}>
            <Text style={[styles.payrollStatValue, { color: '#10b981' }]}>{payrollStats.sent}</Text>
            <Text style={[styles.payrollStatLabel, { color: colors.textSecondary }]}>Sent</Text>
          </View>
          <View style={[styles.payrollStat, { backgroundColor: isDark ? '#1e293b' : '#fffbeb' }]}>
            <Text style={[styles.payrollStatValue, { color: '#f59e0b' }]}>{payrollStats.pending}</Text>
            <Text style={[styles.payrollStatLabel, { color: colors.textSecondary }]}>Pending</Text>
          </View>
          <View style={[styles.payrollStat, { backgroundColor: isDark ? '#1e293b' : '#fef2f2' }]}>
            <Text style={[styles.payrollStatValue, { color: '#ef4444' }]}>{payrollStats.failed}</Text>
            <Text style={[styles.payrollStatLabel, { color: colors.textSecondary }]}>Failed</Text>
          </View>
        </View>
      )}

      {/* Select All / Clear */}
      {salarySlips.length > 0 && (
        <View style={styles.payrollSelectRow}>
          <TouchableOpacity onPress={toggleAllSlips} style={styles.payrollSelectBtn}>
            <Ionicons
              name={selectedSlipIds.size === salarySlips.length ? 'checkbox' : 'square-outline'}
              size={20}
              color={selectedSlipIds.size === salarySlips.length ? colors.accent : colors.textSecondary}
            />
            <Text style={[styles.payrollSelectText, { color: colors.text }]}>
              {selectedSlipIds.size} of {salarySlips.length} selected
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelectedSlipIds(new Set())}>
            <Text style={[styles.payrollClearText, { color: colors.accent }]}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Salary slips list */}
      {loadingSlips ? (
        <View style={styles.payrollLoadingWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.payrollLoadingText, { color: colors.textSecondary }]}>Loading salary slips...</Text>
        </View>
      ) : salarySlips.length === 0 ? (
        <View style={styles.payrollEmptyWrap}>
          <Ionicons name="wallet-outline" size={48} color={colors.textTertiary} />
          <Text style={[styles.payrollEmptyTitle, { color: colors.textSecondary }]}>No salary slips</Text>
          <Text style={[styles.payrollEmptySub, { color: colors.textTertiary }]}>
            {payrollCompanyId ? 'No slips for this period. Try a different month.' : 'Select a company first.'}
          </Text>
        </View>
      ) : (
        salarySlips.map(slip => {
          const st = slipEmailStatus(slip);
          const statusInfo = PAYROLL_EMAIL_STATUS[st] || PAYROLL_EMAIL_STATUS['Not sent'];
          const isSelected = selectedSlipIds.has(slip.id);
          return (
            <View
              key={slip.id}
              style={[styles.payrollSlipItem, { backgroundColor: isSelected ? (isDark ? 'rgba(249,115,22,0.08)' : 'rgba(249,115,22,0.05)') : colors.card, borderColor: colors.borderLight }]}
            >
              <TouchableOpacity onPress={() => toggleSlipSelection(slip.id)} style={styles.payrollSlipCheck}>
                <Ionicons
                  name={isSelected ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={isSelected ? '#f97316' : colors.textSecondary}
                />
              </TouchableOpacity>
              <View style={[styles.payrollSlipAvatar, { backgroundColor: slip.departmentColor || colors.accent }]}>
                <Text style={styles.payrollSlipAvatarText}>
                  {(slip.employeeName || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.payrollSlipName, { color: colors.text }]} numberOfLines={1}>{slip.employeeName}</Text>
                <Text style={[styles.payrollSlipDept, { color: colors.textSecondary }]} numberOfLines={1}>{slip.department || '—'} · {slip.employeeEmail || '—'}</Text>
              </View>
              <View style={[styles.payrollSlipBadge, { backgroundColor: statusInfo.bg }]}>
                <Text style={[styles.payrollSlipBadgeText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
              </View>
            </View>
          );
        })
      )}

      {/* Action buttons */}
      {salarySlips.length > 0 && (
        <View style={styles.payrollActions}>
          <TouchableOpacity
            style={[styles.payrollSendBtn, (sendingPayroll || selectedSlipIds.size === 0) && { opacity: 0.5 }]}
            onPress={handleSendPayrollEmails}
            disabled={sendingPayroll || selectedSlipIds.size === 0}
          >
            {sendingPayroll ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
            <Text style={styles.payrollSendBtnText}>
              {sendingPayroll ? 'Sending…' : `Send Payroll Emails (${selectedSlipIds.size})`}
            </Text>
          </TouchableOpacity>

          {payrollStats.failed > 0 && (
            <TouchableOpacity
              style={[styles.payrollRetryBtn, retryingFailed && { opacity: 0.5 }]}
              onPress={handleRetryFailedSlips}
              disabled={retryingFailed}
            >
              {retryingFailed ? (
                <ActivityIndicator size="small" color="#b45309" />
              ) : (
                <Ionicons name="refresh-outline" size={18} color="#b45309" />
              )}
              <Text style={styles.payrollRetryBtnText}>
                {retryingFailed ? 'Retrying…' : `Retry Failed (${payrollStats.failed})`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Month picker modal */}
      {showMonthPicker && (
        <PremiumModal visible={showMonthPicker} onClose={() => setShowMonthPicker(false)} title="Select Month">
          <ScrollView style={{ maxHeight: 400 }}>
            {MONTHS.map((m, idx) => (
              <TouchableOpacity
                key={m}
                style={[styles.payrollMonthItem, payrollMonth === idx && { backgroundColor: colors.accent + '15' }]}
                onPress={() => { setPayrollMonth(idx); setShowMonthPicker(false); }}
              >
                <Text style={[styles.payrollMonthText, payrollMonth === idx && { color: colors.accent, fontWeight: '700' }, { color: colors.text }]}>{m}</Text>
                {payrollMonth === idx && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </PremiumModal>
      )}
    </ScrollView>
  );

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Email Center" onBack={() => navigation.goBack()} />
      <HeroBanner
        greeting="Email Center"
        name={`${activeTab === 'payroll' ? salarySlips.length : filtered.length} total`}
        stats={[
          { label: 'Total', value: activeTab === 'payroll' ? payrollStats.total : emails.length, color: '#3b82f6' },
          { label: 'Sent', value: activeTab === 'payroll' ? payrollStats.sent : emails.filter(e => e.status === 'Sent' || e.status === 'Delivered').length, color: '#10b981' },
          { label: 'Pending', value: activeTab === 'payroll' ? payrollStats.pending : emails.filter(e => e.status === 'Scheduled').length, color: '#eab308' },
          { label: 'Failed', value: activeTab === 'payroll' ? payrollStats.failed : emails.filter(e => e.status === 'Failed').length, color: '#ef4444' },
        ]}
      />

      <View style={[styles.tabBar, { backgroundColor: colors.card }]}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && { borderBottomColor: colors.accent, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons name={tab.icon} size={18} color={activeTab === tab.key ? colors.accent : colors.textSecondary} />
            <Text style={[styles.tabLabel, { color: activeTab === tab.key ? colors.accent : colors.textSecondary }]}>
              {tab.label}
            </Text>
            {!!tabBadges[tab.key] && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{tabBadges[tab.key] > 99 ? '99+' : tabBadges[tab.key]}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'payroll' ? (
        renderPayrollTab()
      ) : (
        <>
          <View style={styles.searchRow}>
            <View style={styles.searchWrap}>
              <PremiumSearchBar
                value={searchTerm}
                onChangeText={setSearchTerm}
                placeholder="Search emails..."
              />
            </View>
            <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={exporting}>
              {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>

          {/* Bulk actions bar */}
          {showBulkBar && (
            <View style={[styles.bulkBar, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', borderColor: colors.borderLight }]}>
              <TouchableOpacity onPress={clearSelection} style={styles.bulkBarBtn}>
                <Ionicons name="close-circle-outline" size={18} color={colors.textSecondary} />
                <Text style={[styles.bulkBarCount, { color: colors.text }]}>{selectedEmailIds.size} selected</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkActionBtn, { backgroundColor: colors.accent }]}
                onPress={handleBulkMarkRead}
                disabled={bulkOperating}
              >
                <Ionicons name="mail-open-outline" size={16} color="#fff" />
                <Text style={styles.bulkActionText}>Read</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkActionBtn, { backgroundColor: '#6366f1' }]}
                onPress={handleBulkArchive}
                disabled={bulkOperating}
              >
                <Ionicons name="archive-outline" size={16} color="#fff" />
                <Text style={styles.bulkActionText}>Archive</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkActionBtn, { backgroundColor: '#ef4444' }]}
                onPress={handleBulkDelete}
                disabled={bulkOperating}
              >
                <Ionicons name="trash-outline" size={16} color="#fff" />
                <Text style={styles.bulkActionText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Select All row when not in bulk mode */}
          {!showBulkBar && paginated.length > 0 && (
            <TouchableOpacity style={styles.selectAllRow} onPress={toggleSelectAll}>
              <Ionicons
                name={isAllSelected ? 'checkbox' : 'square-outline'}
                size={18}
                color={isAllSelected ? colors.accent : colors.textSecondary}
              />
              <Text style={[styles.selectAllText, { color: colors.textSecondary }]}>
                {isAllSelected ? 'Deselect all' : 'Select all'}
              </Text>
            </TouchableOpacity>
          )}

          <FlatList
            data={paginated}
            keyExtractor={item => item.id}
            renderItem={renderEmailItem}
            contentContainerStyle={filtered.length === 0 ? styles.emptyList : styles.list}
            ListEmptyComponent={<EmptyStateView icon="mail-outline" title="No emails" subtitle={`No emails in ${activeTab}`} />}
            ListFooterComponent={renderPagination}
          />

          <FloatingActionButton icon="create-outline" onPress={() => setShowCompose(true)} />
        </>
      )}

      {showViewer && selectedEmail && (
        <PremiumModal visible={showViewer} onClose={() => setShowViewer(false)} title="Email">
          <ScrollView style={styles.viewerContent}>
            <Text style={[styles.viewerSubject, { color: colors.text }]}>{selectedEmail.subject}</Text>
            <View style={styles.viewerMeta}>
              <Text style={[styles.viewerLabel, { color: colors.textSecondary }]}>From: {selectedEmail.from} ({selectedEmail.fromEmail})</Text>
              <Text style={[styles.viewerLabel, { color: colors.textSecondary }]}>To: {selectedEmail.to} ({selectedEmail.toEmail})</Text>
              {selectedEmail.cc ? <Text style={[styles.viewerLabel, { color: colors.textSecondary }]}>CC: {selectedEmail.cc}</Text> : null}
              <Text style={[styles.viewerLabel, { color: colors.textSecondary }]}>Date: {selectedEmail.date ? new Date(selectedEmail.date).toLocaleString() : ''}</Text>
              <StatusBadge status={selectedEmail.status} color={selectedEmail.status === 'Sent' || selectedEmail.status === 'Delivered' || selectedEmail.status === 'Opened' ? '#22c55e' : '#6b7280'} />
            </View>
            {/* Email Body - HTML or plain text */}
            {selectedEmail.body && selectedEmail.body.includes('<') ? (
              <WebView
                source={{
                  html: `
                    <html>
                      <head>
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <style>
                          body { font-family: -apple-system, sans-serif; font-size: 15px; color: #1f2937; padding: 16px; line-height: 1.6; margin: 0; }
                          img { max-width: 100%; height: auto; }
                          a { color: #2563eb; }
                          p { margin: 0 0 10px 0; }
                        </style>
                      </head>
                      <body>${selectedEmail.body}</body>
                    </html>
                  `,
                }}
                style={{ height: 300, backgroundColor: isDark ? '#1e293b' : '#fff', borderRadius: 8 }}
                scrollEnabled={false}
                showsVerticalScrollIndicator={false}
              />
            ) : (
              <View style={[styles.viewerBody, { backgroundColor: isDark ? '#1e293b' : '#f8fafc' }]}>
                <Text style={[styles.viewerBodyText, { color: colors.text }]}>{selectedEmail.body || 'No content'}</Text>
              </View>
            )}

            {/* Delivery Tracking */}
            {(selectedEmail.tracking || ['Sent', 'Delivered', 'Opened', 'Clicked'].includes(selectedEmail.status)) && (
              <View style={[styles.trackingContainer, { backgroundColor: colors.card, borderColor: colors.borderLight }]}>
                <Text style={[styles.trackingTitle, { color: colors.text }]}>📧 Delivery Tracking</Text>
                <View style={styles.trackingBadges}>
                  {[
                    { key: 'sent', label: 'Sent', icon: '📤' as const, color: '#3b82f6' },
                    { key: 'delivered', label: 'Delivered', icon: '📬' as const, color: '#10b981' },
                    { key: 'opened', label: 'Opened', icon: '👁️' as const, color: '#8b5cf6' },
                    { key: 'clicked', label: 'Clicked', icon: '🔗' as const, color: '#f97316' },
                  ].map(step => {
                    const isActive = selectedEmail.tracking?.[step.key as keyof typeof selectedEmail.tracking] ||
                      (step.key === 'sent' && ['Sent', 'Delivered', 'Opened', 'Clicked'].includes(selectedEmail.status)) ||
                      (step.key === 'delivered' && ['Delivered', 'Opened', 'Clicked'].includes(selectedEmail.status)) ||
                      (step.key === 'opened' && ['Opened', 'Clicked'].includes(selectedEmail.status)) ||
                      (step.key === 'clicked' && selectedEmail.status === 'Clicked');
                    return (
                      <View
                        key={step.key}
                        style={[
                          styles.trackingBadge,
                          {
                            backgroundColor: isActive ? step.color + '20' : 'transparent',
                            borderColor: isActive ? step.color : colors.borderLight,
                          },
                        ]}
                      >
                        <Text style={{ fontSize: 12 }}>{step.icon}</Text>
                        <Text style={{ color: isActive ? step.color : colors.textSecondary, fontSize: 11, fontWeight: '600' }}>
                          {step.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                {(selectedEmail.sentAt || selectedEmail.deliveredAt || selectedEmail.openedAt) && (
                  <Text style={[styles.trackingTimestamps, { color: colors.textSecondary }]}>
                    Sent: {formatDate(selectedEmail.sentAt || selectedEmail.date)}
                    {selectedEmail.deliveredAt ? ` · Delivered: ${formatDate(selectedEmail.deliveredAt)}` : ''}
                    {selectedEmail.openedAt ? ` · Opened: ${formatDate(selectedEmail.openedAt)}` : ''}
                  </Text>
                )}
              </View>
            )}

            {/* Action Buttons */}
            <View style={styles.viewerActions}>
              <TouchableOpacity
                style={[styles.viewerActionBtn, { backgroundColor: colors.accent }]}
                onPress={() => {
                  setComposeTo(selectedEmail.fromEmail || '');
                  setComposeSubject(`Re: ${selectedEmail.subject || ''}`);
                  setComposeBody(`\n\n---------- Original message ----------\nFrom: ${selectedEmail.from} <${selectedEmail.fromEmail}>\nDate: ${selectedEmail.date}\nSubject: ${selectedEmail.subject}\n\n${selectedEmail.body?.replace(/<[^>]*>/g, '') || ''}`);
                  setShowViewer(false);
                  setShowCompose(true);
                }}
              >
                <Ionicons name="return-down-back" size={18} color="#fff" />
                <Text style={styles.viewerActionText}>Reply</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.viewerActionBtn, { backgroundColor: '#3b82f6' }]}
                onPress={() => {
                  setComposeTo('');
                  setComposeSubject(`Fwd: ${selectedEmail.subject || ''}`);
                  setComposeBody(`\n\n---------- Forwarded message ----------\nFrom: ${selectedEmail.from} <${selectedEmail.fromEmail}>\nDate: ${selectedEmail.date}\nSubject: ${selectedEmail.subject}\n\n${selectedEmail.body?.replace(/<[^>]*>/g, '') || ''}`);
                  setShowViewer(false);
                  setShowCompose(true);
                }}
              >
                <Ionicons name="arrow-redo-outline" size={18} color="#fff" />
                <Text style={styles.viewerActionText}>Forward</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.viewerActionBtn, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]} onPress={() => handleStar(selectedEmail)}>
                <Ionicons name={selectedEmail.starred ? 'star' : 'star-outline'} size={18} color={selectedEmail.starred ? '#f59e0b' : colors.textSecondary} />
                <Text style={[styles.viewerActionText, { color: colors.text }]}>{selectedEmail.starred ? 'Starred' : 'Star'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.viewerActionBtn, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]} onPress={() => handleArchive(selectedEmail)}>
                <Ionicons name="archive-outline" size={18} color={colors.textSecondary} />
                <Text style={[styles.viewerActionText, { color: colors.text }]}>Archive</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.viewerActionBtn, { backgroundColor: '#fef2f2' }]} onPress={() => { setShowViewer(false); handleDelete(selectedEmail); }}>
                <Ionicons name="trash-outline" size={18} color="#ef4444" />
                <Text style={[styles.viewerActionText, { color: '#ef4444' }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </PremiumModal>
      )}

      <PremiumBottomSheet visible={showCompose} onClose={() => setShowCompose(false)} title="Compose Email">
        <ScrollView style={styles.composeSheet}>
          {/* Template Selector */}
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Templates</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {EMAIL_TEMPLATES.map(t => (
              <TouchableOpacity
                key={t.id}
                onPress={() => applyTemplate(t.id)}
                style={{
                  backgroundColor: selectedTemplate === t.id ? '#f97316' : colors.card,
                  borderWidth: 1,
                  borderColor: selectedTemplate === t.id ? '#f97316' : colors.borderLight,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  marginRight: 8,
                }}
              >
                <Text style={{ color: selectedTemplate === t.id ? '#fff' : colors.text, fontSize: 12, fontWeight: '600' }}>{t.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Recipient Groups */}
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Quick Recipients</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {RECIPIENT_GROUPS.map(g => (
              <TouchableOpacity
                key={g.id}
                onPress={() => { setSelectedGroup(g.id); resolveGroup(g.id); }}
                style={{
                  backgroundColor: selectedGroup === g.id ? '#3b82f6' : colors.card,
                  borderWidth: 1,
                  borderColor: selectedGroup === g.id ? '#3b82f6' : colors.borderLight,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  marginRight: 8,
                }}
              >
                <Text style={{ color: selectedGroup === g.id ? '#fff' : colors.text, fontSize: 11, fontWeight: '600' }}>{g.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>To</Text>
          <TextInput
            style={[styles.input, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
            value={composeTo}
            onChangeText={setComposeTo}
            placeholder="recipient@company.com"
            placeholderTextColor={colors.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>CC (optional)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
            value={composeCc}
            onChangeText={setComposeCc}
            placeholder="cc@company.com"
            placeholderTextColor={colors.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>BCC (optional)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
            value={composeBcc}
            onChangeText={setComposeBcc}
            placeholder="bcc@company.com"
            placeholderTextColor={colors.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Subject</Text>
          <TextInput
            style={[styles.input, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
            value={composeSubject}
            onChangeText={setComposeSubject}
            placeholder="Subject"
            placeholderTextColor={colors.textSecondary}
          />
          {/* Formatting Toolbar */}
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Message</Text>
          <View style={{ flexDirection: 'row', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {[
              { id: 'bold', label: 'B', marker: '**' },
              { id: 'italic', label: 'I', marker: '_' },
              { id: 'underline', label: 'U', marker: '__' },
              { id: 'list', label: '• List', marker: '\n- ' },
              { id: 'numbered', label: '1. List', marker: '\n1. ' },
              { id: 'link', label: '🔗 Link', marker: '[text](url)' },
            ].map(f => (
              <TouchableOpacity
                key={f.id}
                onPress={() => insertFormat(f.marker)}
                style={{
                  backgroundColor: activeFormats.has(f.id) ? '#f97316' : colors.card,
                  borderWidth: 1,
                  borderColor: activeFormats.has(f.id) ? '#f97316' : colors.borderLight,
                  borderRadius: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}
              >
                <Text style={{
                  color: activeFormats.has(f.id) ? '#fff' : colors.text,
                  fontSize: 12,
                  fontWeight: f.id === 'bold' ? ('900' as const) : f.id === 'italic' ? ('normal' as const) : ('600' as const),
                  fontStyle: f.id === 'italic' ? 'italic' : 'normal',
                  textDecorationLine: f.id === 'underline' ? 'underline' : 'none',
                }}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.textArea, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
            value={composeBody}
            onChangeText={setComposeBody}
            placeholder="Write your message..."
            placeholderTextColor={colors.textSecondary}
            multiline
            textAlignVertical="top"
          />
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Schedule (optional)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
            value={composeScheduled}
            onChangeText={setComposeScheduled}
            placeholder="YYYY-MM-DD HH:mm"
            placeholderTextColor={colors.textSecondary}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <TouchableOpacity
              style={[styles.saveDraftBtn, sending && { opacity: 0.6 }]}
              onPress={handleSaveDraft}
              disabled={sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#64748b" />
              ) : (
                <>
                  <Ionicons name="document-text-outline" size={16} color="#64748b" />
                  <Text style={styles.saveDraftText}>Save Draft</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sendBtn, sending && { opacity: 0.6 }]}
              onPress={handleSend}
              disabled={sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="send" size={18} color="#fff" />
                  <Text style={styles.sendBtnText}>{composeScheduled ? 'Schedule' : 'Send'}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </PremiumBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  searchWrap: { flex: 1 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1 },
  pageSizeBtnText: { fontSize: 13, fontWeight: '600' },
  tabBar: { flexDirection: 'row', paddingHorizontal: 8, elevation: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  tabLabel: { fontSize: 11, fontWeight: '500' },
  tabBadge: { backgroundColor: '#3b82f6', borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabBadgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  list: { paddingBottom: 80 },
  emptyList: { flex: 1 },
  emailItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  unreadItem: { backgroundColor: 'rgba(59, 130, 246, 0.05)' },
  checkboxBtn: { padding: 4, marginRight: 4 },
  starBtn: { padding: 4, marginRight: 8 },
  emailContent: { flex: 1 },
  emailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  emailFrom: { fontSize: 14, fontWeight: '600' },
  unreadText: { fontWeight: '700' },
  emailDate: { fontSize: 11 },
  emailSubject: { fontSize: 13, marginTop: 2 },
  emailMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3b82f6' },
  emailActions: { flexDirection: 'column', gap: 4, marginLeft: 8 },
  actionBtn: { padding: 6 },
  // Bulk actions
  selectAllRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  selectAllText: { fontSize: 13, fontWeight: '500' },
  bulkBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderTopWidth: 1, borderBottomWidth: 1 },
  bulkBarBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bulkBarCount: { fontSize: 13, fontWeight: '600', marginLeft: 4 },
  bulkActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  bulkActionText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  // Payroll tab
  payrollContainer: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  payrollSection: { marginBottom: 14 },
  payrollSectionLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  payrollChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#d1d5db', marginRight: 8 },
  payrollChipText: { fontSize: 13, fontWeight: '500', color: '#374151' },
  payrollPeriodRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  payrollPeriodBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  payrollPeriodDisplay: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, borderRadius: 10, borderWidth: 1 },
  payrollPeriodText: { fontSize: 15, fontWeight: '600' },
  payrollLoadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, marginBottom: 14 },
  payrollLoadBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  payrollStatsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  payrollStat: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  payrollStatValue: { fontSize: 20, fontWeight: '800' },
  payrollStatLabel: { fontSize: 11, fontWeight: '500', marginTop: 2 },
  payrollSelectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  payrollSelectBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  payrollSelectText: { fontSize: 13, fontWeight: '600' },
  payrollClearText: { fontSize: 13, fontWeight: '600' },
  payrollSlipItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  payrollSlipCheck: { padding: 4, marginRight: 8 },
  payrollSlipAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 10, flexShrink: 0 },
  payrollSlipAvatarText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  payrollSlipName: { fontSize: 14, fontWeight: '600' },
  payrollSlipDept: { fontSize: 12, marginTop: 1 },
  payrollSlipBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, flexShrink: 0, marginLeft: 8 },
  payrollSlipBadgeText: { fontSize: 11, fontWeight: '600' },
  payrollActions: { gap: 10, marginTop: 4, marginBottom: 20 },
  payrollSendBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#f97316', paddingVertical: 14, borderRadius: 12 },
  payrollSendBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  payrollRetryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fef3c7', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#fcd34d' },
  payrollRetryBtnText: { color: '#b45309', fontSize: 14, fontWeight: '600' },
  payrollLoadingWrap: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  payrollLoadingText: { fontSize: 14 },
  payrollEmptyWrap: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  payrollEmptyTitle: { fontSize: 16, fontWeight: '600' },
  payrollEmptySub: { fontSize: 13, textAlign: 'center' },
  payrollMonthItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 10, marginBottom: 4 },
  payrollMonthText: { fontSize: 15 },
  // Viewer
  viewerContent: { paddingBottom: 20 },
  viewerSubject: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  viewerMeta: { gap: 4, marginBottom: 16 },
  viewerLabel: { fontSize: 13 },
  viewerBody: { borderRadius: 12, padding: 16, marginBottom: 16, minHeight: 120 },
  viewerBodyText: { fontSize: 14, lineHeight: 22 },
  // Tracking
  trackingContainer: { borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1 },
  trackingTitle: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  trackingBadges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  trackingBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  trackingTimestamps: { fontSize: 11, marginTop: 8 },
  viewerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  viewerActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  viewerActionText: { fontSize: 13, fontWeight: '600' },
  composeSheet: { paddingBottom: 30 },
  fieldLabel: { fontSize: 13, fontWeight: '500', marginBottom: 4, marginTop: 12 },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1 },
  textArea: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, minHeight: 120, borderWidth: 1 },
  sendBtn: { backgroundColor: '#3b82f6', borderRadius: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20, flex: 1 },
  sendBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  saveDraftBtn: { backgroundColor: '#f1f5f9', borderRadius: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20, flex: 1 },
  saveDraftText: { color: '#475569', fontSize: 14, fontWeight: '600' },
});
