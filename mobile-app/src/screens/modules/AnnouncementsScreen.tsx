import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, TextInput, Alert, Animated, ActivityIndicator } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { useCompany } from '../../context/CompanyContext';
import { Icon } from '../../utils/icons';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { subscribeAnnouncements, subscribeAnnouncementsScoped, createAnnouncement, deleteAnnouncement, Announcement } from '../../services/announcementService';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { HeroBanner, PremiumCard, ShimmerLoader, SegmentControl, PremiumSearchBar, EmptyStateView, Chip, StatusBadge, PremiumBottomSheet, PremiumModal } from '../../components/PremiumComponents';
import { ScreenHeader } from '../../components/ScreenHeader';

const CATEGORIES = ['Holiday', 'Policy', 'Event', 'Finance', 'Notice'];
const PRIORITIES = ['High', 'Medium', 'Low'] as const;
const PRIORITY_COLORS: Record<string, string> = { High: '#ef4444', Medium: '#f59e0b', Low: '#0284c7' };

export const AnnouncementsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const s = useMemo(() => createStyles(colors), [colors]);

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterCard, setFilterCard] = useState('All');
  const [addSheet, setAddSheet] = useState(false);
  const [viewItem, setViewItem] = useState<Announcement | null>(null);
  const [form, setForm] = useState({ title: '', category: '', priority: 'Medium' as 'High' | 'Medium' | 'Low', content: '', pinned: false });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);

  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );

  useEffect(() => {
    if (scopeIds.length === 0) {
      if (isRestrictedScope) { setAnnouncements([]); setLoading(false); return; }
      const unsubAll = subscribeAnnouncements(null, (data) => {
        setAnnouncements(data);
        setLoading(false);
      });
      return unsubAll;
    }
    const unsub = subscribeAnnouncementsScoped(scopeIds, (data) => {
      setAnnouncements(data);
      setLoading(false);
    });
    return unsub;
  }, [scopeIds, isRestrictedScope]);

  const onRefresh = () => { setRefreshing(true); setTimeout(() => setRefreshing(false), 300); };

  const sorted = useMemo(() => [...announcements].sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1)), [announcements]);
  const filtered = useMemo(() => sorted.filter((a) => {
    if (search && !a.title.toLowerCase().includes(search.toLowerCase()) && !a.content.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCategory && a.category !== filterCategory) return false;
    if (filterCard === 'Pinned' && !a.pinned) return false;
    if (filterCard === 'High Priority' && a.priority !== 'High') return false;
    return true;
  }), [sorted, search, filterCategory, filterCard]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, filterCategory, filterCard]);

  const resetForm = () => setForm({ title: '', category: '', priority: 'Medium', content: '', pinned: false });

  const handleCreate = async () => {
    if (!form.title.trim() || !form.category || !form.content.trim()) {
      Alert.alert('Required', 'Please fill in all required fields');
      return;
    }
    try {
      await createAnnouncement({
        title: form.title.trim(), category: form.category, priority: form.priority,
        content: form.content.trim(), pinned: form.pinned,
        author: user?.name || user?.email || 'Unknown',
        authorId: user?.id || '',
        companyId: effectiveCompanyId || user?.companyId || '',
      });
      setAddSheet(false);
      resetForm();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to create announcement');
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert('Delete', 'Delete this announcement?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { try { await deleteAnnouncement(id); } catch { Alert.alert('Error', 'Failed'); } }},
    ]);
  };

  const formatDate = (d: Date | string) => {
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Title,Category,Priority,Content,Author'];
      const rows = filtered.map(a => `${a.title || ''},${a.category || ''},${a.priority || ''},${(a.content || '').replace(/,/g, ';')},${(a.author || '').replace(/,/g, ';')}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'announcements_export.csv');
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
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Announcements" onBack={() => navigation.goBack()} />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FF6600" />}>
        <HeroBanner
          greeting="Communications"
          name="Announcements"
          subtitle={`${user?.companyName ? `${user.companyName} · ` : ''}${filtered.length} total`}
          stats={[
            { label: 'Total', value: announcements.length, color: '#FF6600' },
            { label: 'Pinned', value: announcements.filter(a => a.pinned).length, color: '#f59e0b' },
            { label: 'High Priority', value: announcements.filter(a => a.priority === 'High').length, color: '#ef4444' },
          ]}
        />

        <SegmentControl options={['All', 'Pinned', 'High Priority']} selected={filterCard} onSelect={setFilterCard} />

        <View style={s.searchRow}>
          <View style={{ flex: 1 }}>
            <PremiumSearchBar value={search} onChangeText={setSearch} placeholder="Search announcements..." />
          </View>
          <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
            {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 16, marginBottom: 12 }}>
          <Chip label="All" selected={!filterCategory} onPress={() => setFilterCategory('')} />
          {CATEGORIES.map((c) => (
            <Chip key={c} label={c} selected={filterCategory === c} onPress={() => setFilterCategory(prev => prev === c ? '' : c)} />
          ))}
        </ScrollView>

        {loading ? <ShimmerLoader count={4} height={100} style={{ paddingHorizontal: 16 }} /> :
        filtered.length === 0 ? <EmptyStateView icon="megaphone-outline" title="No announcements" subtitle="Create one to get started" /> :
        paginated.map((a) => (
          <PremiumCard key={a.id} style={{ marginHorizontal: 16, marginBottom: 10, padding: 16 }} accentColor={a.pinned ? '#f59e0b' : undefined} onPress={() => setViewItem(a)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {a.pinned && <Icon name="bookmark-outline" size={14} color="#f59e0b" />}
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 }} numberOfLines={1}>{a.title}</Text>
              </View>
              <TouchableOpacity onPress={() => handleDelete(a.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="trash-outline" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginTop: 6, marginBottom: 10 }} numberOfLines={2}>{a.content}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <StatusBadge status={a.priority} color={PRIORITY_COLORS[a.priority]} />
              <Text style={{ fontSize: 11, color: colors.textTertiary, flex: 1 }}>{a.category} · {formatDate(a.createdAt)}</Text>
            </View>
          </PremiumCard>
        ))}
        {renderPagination()}
        <View style={{ height: 80 }} />
      </ScrollView>

      <TouchableOpacity style={[s.fab, { backgroundColor: colors.accent }]} onPress={() => { resetForm(); setAddSheet(true); }}>
        <Icon name="add-outline" size={24} color="#fff" />
      </TouchableOpacity>

      <PremiumBottomSheet visible={!!viewItem} onClose={() => setViewItem(null)} title={viewItem?.title || ''}>
        {viewItem && (
          <>
            <Text style={{ fontSize: 13, color: colors.textTertiary, marginBottom: 12 }}>
              {viewItem.category} · By {viewItem.author} · {formatDate(viewItem.createdAt)}
            </Text>
            <StatusBadge status={`${viewItem.priority} Priority`} color={PRIORITY_COLORS[viewItem.priority]} />
            <Text style={{ fontSize: 14, color: colors.text, lineHeight: 22, marginTop: 16 }}>{viewItem.content}</Text>
          </>
        )}
      </PremiumBottomSheet>

      <PremiumModal visible={addSheet} onClose={() => { setAddSheet(false); resetForm(); }} title="New Announcement">
        <TextInput style={[s.modalInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text }]}
          placeholder="Title" placeholderTextColor={colors.textTertiary} value={form.title} onChangeText={(t) => setForm(f => ({ ...f, title: t }))} />
        <Text style={[s.fieldLabel, { color: colors.textSecondary }]}>Category</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity key={c} style={[s.chip, form.category === c && { backgroundColor: colors.accent }]}
              onPress={() => setForm(f => ({ ...f, category: c }))}>
              <Text style={[s.chipText, { color: form.category === c ? '#fff' : colors.textSecondary }]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[s.fieldLabel, { color: colors.textSecondary }]}>Priority</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {PRIORITIES.map((p) => (
            <TouchableOpacity key={p} style={[s.chip, form.priority === p && { backgroundColor: PRIORITY_COLORS[p] }]}
              onPress={() => setForm(f => ({ ...f, priority: p }))}>
              <Text style={[s.chipText, { color: form.priority === p ? '#fff' : colors.textSecondary }]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TextInput style={[s.modalInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.text, minHeight: 100, textAlignVertical: 'top' }]}
          placeholder="Content" placeholderTextColor={colors.textTertiary} value={form.content} onChangeText={(t) => setForm(f => ({ ...f, content: t }))} multiline />
        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 }}
          onPress={() => setForm(f => ({ ...f, pinned: !f.pinned }))}>
          <Icon name={form.pinned ? 'checkbox-outline' : 'square-outline'} size={20} color={colors.accent} />
          <Text style={{ fontSize: 14, color: colors.text }}>Pin this announcement</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ backgroundColor: colors.accent, paddingVertical: 14, borderRadius: 14, alignItems: 'center' }}
          onPress={handleCreate}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Create Announcement</Text>
        </TouchableOpacity>
      </PremiumModal>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  fab: { position: 'absolute', bottom: 20, right: 20, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 6 },
  searchRow: { flexDirection: 'row', alignItems: 'flex-start' },
  exportBtn: { marginLeft: 10, marginRight: 16, backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  modalInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: 'transparent' },
  chipText: { fontSize: 12, fontWeight: '600' },
});
