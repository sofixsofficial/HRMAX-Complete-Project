import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { createTicket, getTicketsByCompany } from '../../services/supportService';
import { HeroBanner, PremiumCard, EmptyStateView, StatusBadge } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme } from '../../context/ThemeContext';
import type { SupportTicket } from '../../types/user';

const CATEGORIES = ['IT Support', 'HR', 'Finance', 'General', 'Technical', 'Access Request'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const FAQ_ITEMS = [
  { q: 'How do I reset my password?', a: 'Go to Settings > Security to enter a new password. If locked out, use the "Forgot Password" link on the login page.' },
  { q: 'How do I submit leave?', a: 'Navigate to Leaves from the menu, tap "Request Leave", select dates and type, then submit.' },
  { q: 'How do I view my payslips?', a: 'Go to Payroll from the Operations section to view and download salary slips.' },
  { q: 'How do I update my profile?', a: 'Go to My Profile from the menu to update your personal details.' },
  { q: 'How do I contact IT support?', a: 'Use this form below to submit a ticket. For urgent issues, contact your team leader directly.' },
];

export default function SupportScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId } = useCompany();
  const { colors, isDark } = useTheme();

  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [priority, setPriority] = useState('Medium');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [recentTickets, setRecentTickets] = useState<SupportTicket[]>([]);
  const [allUserTickets, setAllUserTickets] = useState<SupportTicket[]>([]);

  useEffect(() => {
    if (effectiveCompanyId) {
      getTicketsByCompany(effectiveCompanyId).then(tickets => {
        const userTickets = tickets.filter(t => t.createdById === user?.id);
        setAllUserTickets(userTickets);
        setRecentTickets(userTickets.slice(0, 5));
      }).catch(() => {});
    }
  }, [effectiveCompanyId]);

  const ticketStats = useMemo(() => ({
    total: allUserTickets.length,
    open: allUserTickets.filter(t => t.status === 'Open').length,
    inProgress: allUserTickets.filter(t => t.status === 'In Progress').length,
    resolved: allUserTickets.filter(t => t.status === 'Resolved').length,
  }), [allUserTickets]);

  const handleSubmit = async () => {
    if (!subject.trim() || !description.trim()) {
      Alert.alert('Required', 'Subject and description are required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const ticket = await createTicket({
        title: subject, description, status: 'Open',
        priority: priority as any, category,
        createdBy: user?.name || '', createdById: user?.id || '',
        companyId: effectiveCompanyId || '', companyName: '',
      });
      setTicketId(ticket.id);
      setSubmitted(true);
    } catch (err) {
      setError('Failed to submit ticket. Please try again.');
    }
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title="Support" onBack={() => navigation.goBack()} />
        <View style={styles.successContainer}>
          <View style={[styles.successIcon, { backgroundColor: '#22c55e' }]}>
            <Ionicons name="checkmark-circle" size={64} color="#fff" />
          </View>
          <Text style={[styles.successTitle, { color: colors.text }]}>Ticket Submitted!</Text>
          <Text style={[styles.successId, { color: colors.textSecondary }]}>Ticket ID: {ticketId}</Text>
          <Text style={[styles.successMsg, { color: colors.textSecondary }]}>We'll get back to you shortly.</Text>
          <TouchableOpacity style={[styles.newTicketBtn, { backgroundColor: colors.accent }]} onPress={() => { setSubmitted(false); setSubject(''); setDescription(''); setTicketId(null); }}>
            <Text style={styles.newTicketBtnText}>Submit Another</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Support" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="Support" name="Get help and submit tickets" subtitle="headset-outline" stats={[
        { label: 'Open', value: ticketStats.open, color: '#3b82f6' },
        { label: 'In Progress', value: ticketStats.inProgress, color: '#eab308' },
        { label: 'Resolved', value: ticketStats.resolved, color: '#10b981' },
        { label: 'Total', value: ticketStats.total, color: '#8b5cf6' },
      ]} />

      <ScrollView>
        <PremiumCard style={styles.card}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>FAQ</Text>
          {FAQ_ITEMS.map((faq, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.faqItem, i < FAQ_ITEMS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
              onPress={() => setExpandedFaq(expandedFaq === i ? null : i)}
            >
              <View style={styles.faqHeader}>
                <Text style={[styles.faqQ, { color: colors.text }]}>{faq.q}</Text>
                <Ionicons name={expandedFaq === i ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
              </View>
              {expandedFaq === i && (
                <Text style={[styles.faqA, { color: colors.textSecondary }]}>{faq.a}</Text>
              )}
            </TouchableOpacity>
          ))}
        </PremiumCard>

        <PremiumCard style={styles.card}>
          <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Submit a Ticket</Text>
          {error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Category</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.chip, category === c && { backgroundColor: colors.accent }]}
                onPress={() => setCategory(c)}
              >
                <Text style={[styles.chipText, { color: category === c ? '#fff' : colors.textSecondary }]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Priority</Text>
          <View style={styles.chipRow}>
            {PRIORITIES.map(p => (
              <TouchableOpacity
                key={p}
                style={[styles.chip, priority === p && { backgroundColor: '#f59e0b' }]}
                onPress={() => setPriority(p)}
              >
                <Text style={[styles.chipText, { color: priority === p ? '#fff' : colors.textSecondary }]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Subject</Text>
          <TextInput
            style={[styles.input, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
            value={subject}
            onChangeText={setSubject}
            placeholder="Brief subject"
            placeholderTextColor={colors.textSecondary}
          />

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Description</Text>
          <TextInput
            style={[styles.textArea, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe your issue in detail..."
            placeholderTextColor={colors.textSecondary}
            multiline
            textAlignVertical="top"
          />

          <TouchableOpacity style={[styles.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="send" size={18} color="#fff" />
                <Text style={styles.submitBtnText}>Submit Ticket</Text>
              </>
            )}
          </TouchableOpacity>
        </PremiumCard>

        {recentTickets.length > 0 && (
          <PremiumCard style={styles.card}>
            <Text style={[{fontSize:16,fontWeight:'700',marginBottom:12,color:colors.text}]}>Recent Tickets</Text>
            {recentTickets.map(t => (
              <View key={t.id} style={styles.recentTicket}>
                <View style={styles.recentTicketInfo}>
                  <Text style={[styles.recentTicketTitle, { color: colors.text }]} numberOfLines={1}>{t.title}</Text>
                  <Text style={[styles.recentTicketDate, { color: colors.textSecondary }]}>{new Date(t.createdAt).toLocaleDateString()}</Text>
                </View>
                <StatusBadge status={t.status} color={t.status === 'Open' ? '#3b82f6' : t.status === 'In Progress' ? '#f59e0b' : t.status === 'Resolved' ? '#22c55e' : '#6b7280'} />
              </View>
            ))}
          </PremiumCard>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { marginHorizontal: 16, marginBottom: 16, padding: 16 },
  faqItem: { paddingVertical: 12 },
  faqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  faqQ: { fontSize: 14, fontWeight: '500', flex: 1 },
  faqA: { fontSize: 13, marginTop: 6, lineHeight: 20 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, backgroundColor: '#fef2f2', borderRadius: 8, marginBottom: 12 },
  errorText: { color: '#ef4444', fontSize: 13, flex: 1 },
  fieldLabel: { fontSize: 13, fontWeight: '500', marginBottom: 6, marginTop: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#1F2937' },
  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1 },
  textArea: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, minHeight: 100, borderWidth: 1 },
  submitBtn: { backgroundColor: '#3b82f6', borderRadius: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  recentTicket: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#e2e8f0' },
  recentTicketInfo: { flex: 1, marginRight: 8 },
  recentTicketTitle: { fontSize: 14, fontWeight: '500' },
  recentTicketDate: { fontSize: 12 },
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  successIcon: { width: 96, height: 96, borderRadius: 48, justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  successTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  successId: { fontSize: 14, fontFamily: 'monospace', marginBottom: 8 },
  successMsg: { fontSize: 14, marginBottom: 24, textAlign: 'center' },
  newTicketBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  newTicketBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
