import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, addDoc, updateDoc, doc, query, where, orderBy, serverTimestamp } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { subscribeEmployees } from '../../services/employeeService';
import { HeroBanner, PremiumCard, StatusBadge, EmptyStateView, PremiumBottomSheet, FloatingActionButton } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export default function PerformanceScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId } = useCompany();
  const { colors, isDark } = useTheme();

  const [reviews, setReviews] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<any>(null);
  const [rating, setRating] = useState(3);
  const [feedback, setFeedback] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    loadData();
  }, [effectiveCompanyId]);

  const loadData = async () => {
    try {
      const q = effectiveCompanyId
        ? query(collection(db, 'performance'), where('companyId', '==', effectiveCompanyId), orderBy('createdAt', 'desc'))
        : query(collection(db, 'performance'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setReviews(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Performance load error:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    const unsub = subscribeEmployees(effectiveCompanyId, (emps) => setEmployees(emps));
    return unsub;
  }, [effectiveCompanyId]);

  const handleSubmit = async () => {
    if (!selectedEmp || !feedback.trim()) {
      Alert.alert('Required', 'Select employee and provide feedback');
      return;
    }
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'performance'), {
        employeeId: selectedEmp.id,
        employeeName: selectedEmp.name,
        employeeEmail: selectedEmp.email,
        department: selectedEmp.department,
        rating,
        feedback: feedback.trim(),
        reviewerId: user?.id || '',
        reviewerName: user?.name || '',
        companyId: effectiveCompanyId || '',
        createdAt: serverTimestamp(),
      });
      setShowReview(false);
      setSelectedEmp(null);
      setRating(3);
      setFeedback('');
      loadData();
    } catch {
      Alert.alert('Error', 'Failed to submit review');
    }
    setSubmitting(false);
  };

  const getRatingColor = (r: number) => {
    if (r >= 4) return '#22c55e';
    if (r >= 3) return '#f59e0b';
    return '#ef4444';
  };

  const filtered = reviews.filter((r: any) => !searchTerm || r.employeeName?.toLowerCase().includes(searchTerm.toLowerCase()));

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Employee,Department,Rating,Feedback,Reviewer,Date'];
      const rows = filtered.map((r: any) => `${(r.employeeName || '').replace(/,/g, ';')},${(r.department || '').replace(/,/g, ';')},${r.rating},${(r.feedback || '').replace(/,/g, ';')},${(r.reviewerName || '').replace(/,/g, ';')},${r.createdAt?.toDate?.()?.toLocaleDateString() || ''}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'performance_export.csv');
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
      <View style={s.paginationRow}>
        <TouchableOpacity style={[s.pageBtn, currentPage === 1 && s.pageBtnDisabled]} disabled={currentPage === 1} onPress={() => setCurrentPage(p => Math.max(1, p - 1))}>
          <Icon name="chevron-back-outline" size={16} color={currentPage === 1 ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={s.pageInfo}>{currentPage} / {totalPages}</Text>
        <TouchableOpacity style={[s.pageBtn, currentPage === totalPages && s.pageBtnDisabled]} disabled={currentPage === totalPages} onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
          <Icon name="chevron-forward-outline" size={16} color={currentPage === totalPages ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={s.pageSizeText}>Show:</Text>
        <TouchableOpacity style={s.pageSizeBtn} onPress={() => { const sizes = [5, 10, 20, 50]; const idx = sizes.indexOf(pageSize); setPageSize(sizes[(idx + 1) % sizes.length]); }}>
          <Text style={s.pageSizeBtnText}>{pageSize}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Performance" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="Performance" name="Performance reviews and feedback" subtitle="trending-up-outline"
        stats={[
          { label: 'Total', value: reviews.length, color: '#3b82f6' },
          { label: 'High Rating', value: reviews.filter((r: any) => r.rating >= 4).length, color: '#10b981' },
          { label: 'Low Rating', value: reviews.filter((r: any) => r.rating <= 2).length, color: '#ef4444' },
        ]}
      />
      <Text style={s.count}>{filtered.length} total</Text>

      <View style={s.searchRow}>
        <View style={s.searchInputWrap}>
          <Icon name="search-outline" size={18} color={colors.textTertiary} />
          <TextInput style={s.searchInput} placeholder="Search reviews..." placeholderTextColor={colors.textTertiary} value={searchTerm} onChangeText={setSearchTerm} />
          {searchTerm ? <TouchableOpacity onPress={() => setSearchTerm('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
        </View>
        <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}><ActivityIndicator size="large" color={colors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {filtered.length === 0 ? (
            <EmptyStateView icon="trending-up-outline" title="No reviews" subtitle="No performance reviews yet" />
          ) : paginated.map((review: any) => (
            <PremiumCard key={review.id} style={styles.reviewCard}>
              <View style={styles.reviewHeader}>
                <View style={[styles.avatar, { backgroundColor: getRatingColor(review.rating) }]}>
                  <Text style={styles.avatarText}>{review.employeeName?.charAt(0)?.toUpperCase()}</Text>
                </View>
                <View style={styles.reviewInfo}>
                  <Text style={[styles.reviewName, { color: colors.text }]}>{review.employeeName}</Text>
                  <Text style={[styles.reviewDept, { color: colors.textSecondary }]}>{review.department}</Text>
                </View>
                <Text style={[styles.reviewRating, { color: getRatingColor(review.rating) }]}>{review.rating}/5</Text>
              </View>
              <Text style={[styles.reviewFeedback, { color: colors.text }]}>{review.feedback}</Text>
              <Text style={[styles.reviewMeta, { color: colors.textSecondary }]}>
                {review.reviewerName} · {review.createdAt?.toDate?.()?.toLocaleDateString() || ''}
              </Text>
            </PremiumCard>
          ))}
          {renderPagination()}
        </ScrollView>
      )}

      <FloatingActionButton icon="add" onPress={() => setShowReview(true)} label="New performance review" />

      <PremiumBottomSheet visible={showReview} onClose={() => setShowReview(false)} title="New Review">
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Employee</Text>
        <ScrollView style={{ maxHeight: 150 }}>
          {employees.map((e: any) => (
            <TouchableOpacity
              key={e.id}
              style={[styles.empOption, selectedEmp?.id === e.id && { backgroundColor: 'rgba(59,130,246,0.1)' }]}
              onPress={() => setSelectedEmp(e)}
            >
              <Text style={[styles.empOptionName, { color: colors.text }]}>{e.name}</Text>
              <Text style={[styles.empOptionDept, { color: colors.textSecondary }]}>{e.department}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Rating</Text>
        <View style={styles.starRow}>
          {[1, 2, 3, 4, 5].map(s => (
            <TouchableOpacity key={s} onPress={() => setRating(s)}>
              <Ionicons name={s <= rating ? 'star' : 'star-outline'} size={32} color={s <= rating ? getRatingColor(s) : colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Feedback</Text>
        <TextInput
          style={[styles.textArea, { backgroundColor: isDark ? '#1e293b' : '#f1f5f9', color: colors.text, borderColor: colors.border }]}
          value={feedback}
          onChangeText={setFeedback}
          placeholder="Provide feedback..."
          placeholderTextColor={colors.textSecondary}
          multiline
          textAlignVertical="top"
        />

        <TouchableOpacity style={[styles.submitBtn, { backgroundColor: colors.accent }]} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitBtnText}>Submit Review</Text>}
        </TouchableOpacity>
      </PremiumBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 80 },
  reviewCard: { marginBottom: 10, padding: 14 },
  reviewHeader: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  reviewInfo: { flex: 1, marginLeft: 10 },
  reviewName: { fontSize: 15, fontWeight: '600' },
  reviewDept: { fontSize: 12 },
  reviewRating: { fontSize: 20, fontWeight: '800' },
  reviewFeedback: { fontSize: 14, marginTop: 10, lineHeight: 20 },
  reviewMeta: { fontSize: 12, marginTop: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '500', marginBottom: 6, marginTop: 12 },
  empOption: { padding: 10, borderRadius: 8, marginBottom: 4, flexDirection: 'row', justifyContent: 'space-between' },
  empOptionName: { fontSize: 14, fontWeight: '500' },
  empOptionDept: { fontSize: 12 },
  starRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginVertical: 8 },
  textArea: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, minHeight: 100, borderWidth: 1 },
  submitBtn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

const createStyles = (c: ThemeColors) => StyleSheet.create({
  count: { color: c.textSecondary, fontSize: 13, marginHorizontal: 16, marginBottom: 8, textAlign: 'right' },
  searchRow: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', gap: 10, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
});
