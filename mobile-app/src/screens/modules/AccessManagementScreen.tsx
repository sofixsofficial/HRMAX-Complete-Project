import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, doc, updateDoc } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { useAuth } from '../../context/AuthContext';
import { HeroBanner, PremiumCard, PremiumModal, StatusBadge, EmptyStateView } from '../../components/PremiumComponents';
import { useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { formatDateSafe } from '../../utils/dateUtils';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  CORE_CRUD_ACTIONS, CORE_CRUD_CONFIG, coreModulesForRole, coreKeysForRole,
  totalCoreKeys, initialCoreEnabled, buildCorePermissionsArray,
} from '../../services/permissionConfig';
import type { CoreCrudModule } from '../../services/permissionConfig';

export default function AccessManagementScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors, isDark } = useTheme();

  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);

  // Core CRUD permission editor state
  const [matrixUser, setMatrixUser] = useState<any>(null);
  const [coreEnabled, setCoreEnabled] = useState<Record<string, boolean>>({});
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [matrixSaving, setMatrixSaving] = useState(false);
  const [autoSave, setAutoSave] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const [permError, setPermError] = useState('');

  const ROLES = ['All', 'master-admin', 'company-admin', 'executive', 'team-leader', 'reporting-manager', 'employee'];
  const isMasterAdmin = user?.role === 'master-admin';

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const snap = await getDocs(collection(db, 'users'));
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Access mgmt error:', err);
    }
    setLoading(false);
  };

  const toggleActive = async (u: any) => {
    try {
      await updateDoc(doc(db, 'users', u.id), { isActive: !u.isActive, status: u.isActive ? 'Inactive' : 'Active' });
      loadUsers();
    } catch {
      Alert.alert('Error', 'Failed to update status');
    }
  };

  const openMatrix = (u: any) => {
    const role = u.role === 'executive' ? 'executive' : 'team-leader';
    setMatrixUser(u);
    setCoreEnabled(initialCoreEnabled(role, u.permissions, u.permissionsConfigured === true));
    setMatrixDirty(false);
    setAutoSave('idle');
    setPermError('');
  };

  const closeMatrix = () => {
    if (matrixSaving) return;
    if (matrixDirty) {
      Alert.alert('Unsaved changes', 'Discard unsaved permission changes?', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => setMatrixUser(null) },
      ]);
      return;
    }
    setMatrixUser(null);
  };

  const togglePerm = (key: string) => {
    setCoreEnabled(m => ({ ...m, [key]: !m[key] }));
    setMatrixDirty(true);
  };

  const toggleModuleAll = (modKey: string, val: boolean) => {
    setCoreEnabled(m => {
      const next = { ...m };
      const role = matrixUser?.role === 'executive' ? 'executive' : 'team-leader';
      coreKeysForRole(role).filter(k => k.startsWith(`${modKey}.`)).forEach(k => { next[k] = val });
      return next;
    });
    setMatrixDirty(true);
  };

  const grantAllCore = () => {
    setCoreEnabled(m => {
      const next = { ...m };
      const role = matrixUser?.role === 'executive' ? 'executive' : 'team-leader';
      coreKeysForRole(role).forEach(k => { next[k] = true });
      return next;
    });
    setMatrixDirty(true);
  };

  const clearAllCore = () => {
    setCoreEnabled(m => {
      const next = { ...m };
      const role = matrixUser?.role === 'executive' ? 'executive' : 'team-leader';
      coreKeysForRole(role).forEach(k => { next[k] = false });
      return next;
    });
    setMatrixDirty(true);
  };

  const persistMatrix = useCallback(async (silent: boolean): Promise<boolean> => {
    if (!matrixUser) return false;
    if (!silent) setMatrixSaving(true);
    setPermError('');
    try {
      const role = matrixUser.role === 'executive' ? 'executive' : 'team-leader';
      const arr = buildCorePermissionsArray(role, coreEnabled, matrixUser.permissions);
      await updateDoc(doc(db, 'users', matrixUser.id), {
        permissions: arr,
        permissionsConfigured: true,
        permissionScopes: null,
        permissionsUpdatedAt: Date.now(),
        updatedAt: Date.now(),
      });
      setAutoSave(silent ? 'saved' : 'idle');
      await loadUsers();
      return true;
    } catch (err: any) {
      setPermError(err.message || 'Failed to save permissions');
      setAutoSave('idle');
      return false;
    } finally {
      if (!silent) setMatrixSaving(false);
    }
  }, [matrixUser, coreEnabled]);

  // Debounced autosave: every toggle change flushes ~700ms later so the
  // firestore rules start enforcing the new core CRUD matrix immediately.
  useEffect(() => {
    if (!matrixUser || !matrixDirty) return;
    setAutoSave('dirty');
    const t = setTimeout(async () => {
      setAutoSave('saving');
      const ok = await persistMatrix(true);
      if (ok) setMatrixDirty(false);
    }, 700);
    return () => clearTimeout(t);
  }, [coreEnabled, matrixDirty, matrixUser, persistMatrix]);

  const handleSaveMatrix = async () => {
    const ok = await persistMatrix(false);
    if (ok) {
      setMatrixDirty(false);
      Alert.alert('Saved', 'Permissions saved and enforced immediately.');
    }
  };

  const matrixRole = (matrixUser?.role === 'executive' ? 'executive' : 'team-leader') as 'team-leader' | 'executive';
  const enabledCoreCount = coreKeysForRole(matrixRole).filter(k => coreEnabled[k]).length;

  const filtered = users.filter((u: any) => {
    if (roleFilter !== 'All' && u.role !== roleFilter) return false;
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [searchTerm, roleFilter]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Email,Role,Status,Company'];
      const rows = filtered.map((u: any) => `${(u.name || '').replace(/,/g, ';')},${(u.email || '').replace(/,/g, ';')},${u.role},${u.isActive ? 'Active' : 'Inactive'},${(u.companyId || '').replace(/,/g, ';')}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'access_users_export.csv');
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

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'master-admin': return '#ef4444';
      case 'company-admin': return '#f59e0b';
      case 'executive': return '#8b5cf6';
      case 'team-leader': return '#3b82f6';
      case 'reporting-manager': return '#d97706';
      default: return '#22c55e';
    }
  };

  const renderMatrixModal = () => {
    if (!matrixUser) return null;
    const isMatrixRole = matrixUser.role === 'team-leader' || matrixUser.role === 'executive';
    return (
      <PremiumModal visible={!!matrixUser} onClose={closeMatrix} title={`Permissions — ${matrixUser.name || matrixUser.email || ''}`}>
        <View style={styles.matrixContent}>
          {!isMasterAdmin ? (
            <View style={s.permNotice}>
              <Icon name="lock-closed-outline" size={16} color={colors.textSecondary} />
              <Text style={[s.permNoticeText, { color: colors.textSecondary }]}>Only a master-admin can edit permissions.</Text>
            </View>
          ) : !isMatrixRole ? (
            <View style={s.permNotice}>
              <Icon name="information-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={[s.permNoticeText, { color: colors.textSecondary }]}>Permissions apply to Team Leaders and Executives only.</Text>
            </View>
          ) : (
            <View>
              <View style={s.permNotice}>
                <Icon name="shield-checkmark-outline" size={16} color="#7c3aed" />
                <Text style={[s.permNoticeText, { color: colors.textSecondary }]}>
                  {CORE_CRUD_CONFIG[matrixRole].description} Every action is granted by default and can be switched off below.
                </Text>
              </View>

              <View style={s.permAutoSaveRow}>
                <Text style={[s.permCount, { color: colors.textSecondary }]}>{enabledCoreCount} / {totalCoreKeys(matrixRole)} enabled</Text>
                {autoSave !== 'idle' && (
                  <Text style={[s.permAutoSaveText, { color: autoSave === 'saved' ? '#15803d' : autoSave === 'saving' ? '#0369a1' : '#b45309' }]}>
                    {autoSave === 'dirty' ? 'Unsaved changes…' : autoSave === 'saving' ? 'Saving…' : 'Saved to Firestore'}
                  </Text>
                )}
              </View>

              <View style={s.permTools}>
                <TouchableOpacity style={s.permToolBtn} onPress={grantAllCore}><Text style={s.permToolBtnText}>Grant all</Text></TouchableOpacity>
                <TouchableOpacity style={s.permToolBtn} onPress={clearAllCore}><Text style={s.permToolBtnText}>Clear all</Text></TouchableOpacity>
              </View>

              {permError ? (
                <View style={s.permErrorBox}>
                  <Icon name="alert-circle-outline" size={15} color="#dc2626" />
                  <Text style={s.permErrorText}>{permError}</Text>
                </View>
              ) : null}

              {coreModulesForRole(matrixRole).map(mod => {
                const modKeys = CORE_CRUD_ACTIONS.map(a => `${mod.key}.${a}`);
                const modAll = modKeys.every(k => !!coreEnabled[k]);
                const enabled = modKeys.filter(k => !!coreEnabled[k]).length;
                return (
                  <View key={mod.key} style={[s.permModRow, { borderBottomColor: colors.borderLight }]}>
                    <View style={s.permModHeader}>
                      <Icon name={mod.icon} size={16} color={mod.color} />
                      <Text style={[s.permModName, { color: colors.text }]}>{mod.label}</Text>
                      <Text style={[s.permModCount, { color: colors.textSecondary }]}>{enabled}/{modKeys.length}</Text>
                      <TouchableOpacity
                        style={[s.permModToggle, { borderColor: modAll ? '#15803d' : colors.borderLight }]}
                        onPress={() => toggleModuleAll(mod.key, !modAll)}
                      >
                        <Text style={{ color: modAll ? '#15803d' : colors.textSecondary, fontSize: 11, fontWeight: '700' }}>
                          {modAll ? 'Selected' : 'Select all'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.permActionsRow}>
                      {CORE_CRUD_ACTIONS.map(action => {
                        const key = `${mod.key}.${action}`;
                        const label = action.charAt(0).toUpperCase() + action.slice(1);
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[s.permActionCell, { backgroundColor: coreEnabled[key] ? '#ede9fe' : colors.card }]}
                            onPress={() => togglePerm(key)}
                          >
                            <Text style={[s.permActionLabel, { color: coreEnabled[key] ? '#5b21b6' : colors.textSecondary }]}>
                              {label}
                            </Text>
                            <Icon
                              name={coreEnabled[key] ? 'checkbox' : 'square-outline'}
                              size={16}
                              color={coreEnabled[key] ? '#7c3aed' : colors.textTertiary}
                            />
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                );
              })}

              <TouchableOpacity style={s.permSaveBtn} onPress={handleSaveMatrix} disabled={matrixSaving}>
                {matrixSaving ? (
                  <ActivityIndicator size={18} color="#fff" />
                ) : (
                  <>
                    <Icon name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={s.permSaveBtnText}>Save Permissions</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </PremiumModal>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Access Management" onBack={() => navigation.goBack()} />
      <HeroBanner greeting="Access Management" name="Users"
        stats={[
          { label: 'Total', value: users.length, color: '#3b82f6' },
          { label: 'Active', value: users.filter((u: any) => u.isActive).length, color: '#10b981' },
          { label: 'Inactive', value: users.filter((u: any) => !u.isActive).length, color: '#ef4444' },
        ]}
      />
      <Text style={s.count}>{filtered.length} total</Text>

      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {ROLES.map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.filterChip, roleFilter === r && { backgroundColor: colors.accent }]}
              onPress={() => setRoleFilter(r)}
            >
              <Text style={[styles.filterChipText, { color: roleFilter === r ? '#fff' : colors.textSecondary }]}>{r.replace('-', ' ')}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={s.searchRow}>
        <View style={s.searchInputWrap}>
          <Icon name="search-outline" size={18} color={colors.textTertiary} />
          <TextInput style={s.searchInput} placeholder="Search users..." placeholderTextColor={colors.textTertiary} value={searchTerm} onChangeText={setSearchTerm} />
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
            <EmptyStateView icon="lock-closed-outline" title="No users" subtitle="No users match your filters" />
          ) : paginated.map((u: any) => (
            <TouchableOpacity
              key={u.id}
              style={[styles.userItem, { backgroundColor: colors.card }]}
              onPress={() => { setSelectedUser(u); setShowDetail(true); }}
            >
              <View style={[styles.avatar, { backgroundColor: getRoleColor(u.role) }]}>
                <Text style={styles.avatarText}>{u.name?.charAt(0)?.toUpperCase() || '?'}</Text>
              </View>
              <View style={styles.userInfo}>
                <Text style={[styles.userName, { color: colors.text }]}>{u.name || 'Unknown'}</Text>
                <Text style={[styles.userEmail, { color: colors.textSecondary }]}>{u.email}</Text>
                <View style={styles.userMetaRow}>
                  <StatusBadge status={u.isActive ? 'Active' : 'Inactive'} color={u.isActive ? '#22c55e' : '#f59e0b'} />
                  <Text style={[styles.userRole, { color: getRoleColor(u.role) }]}>{u.role}</Text>
                </View>
              </View>
              <View style={styles.userActions}>
                {(u.role === 'team-leader' || u.role === 'executive') && (
                  <TouchableOpacity style={[s.permLaunchBtn, { borderColor: colors.borderLight }]} onPress={() => openMatrix(u)}>
                    <Icon name="key-outline" size={15} color="#7c3aed" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => toggleActive(u)} style={styles.toggleBtn}>
                  <Ionicons name={u.isActive ? 'toggle' : 'toggle-outline'} size={32} color={u.isActive ? '#22c55e' : colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
          {renderPagination()}
        </ScrollView>
      )}

      <PremiumModal visible={showDetail} onClose={() => setShowDetail(false)} title={selectedUser?.name || ''}>
        {selectedUser && (
          <View style={styles.detailContent}>
            {[
              { icon: 'mail-outline', label: 'Email', value: selectedUser.email },
              { icon: 'shield-outline', label: 'Role', value: selectedUser.role },
              { icon: 'checkmark-circle-outline', label: 'Status', value: selectedUser.isActive ? 'Active' : 'Inactive' },
              { icon: 'business-outline', label: 'Company', value: selectedUser.companyId || 'N/A' },
              { icon: 'calendar-outline', label: 'Created', value: formatDateSafe(selectedUser.createdAt) },
            ].map((item, i) => (
              <View key={i} style={styles.detailRow}>
                <Ionicons name={item.icon as any} size={16} color={colors.textSecondary} />
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>{item.label}</Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>{item.value}</Text>
              </View>
            ))}
            {(selectedUser.role === 'team-leader' || selectedUser.role === 'executive') && (
              <TouchableOpacity
                style={[styles.toggleActiveBtn, { backgroundColor: '#7c3aed' }]}
                onPress={() => { setShowDetail(false); openMatrix(selectedUser); }}
              >
                <Ionicons name="key-outline" size={18} color="#fff" />
                <Text style={[styles.toggleActiveText, { color: '#fff' }]}>Edit Permissions</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.toggleActiveBtn, { backgroundColor: selectedUser.isActive ? '#fef2f2' : '#f0fdf4' }]}
              onPress={() => { toggleActive(selectedUser); setShowDetail(false); }}
            >
              <Ionicons name={selectedUser.isActive ? 'close-circle-outline' : 'checkmark-circle-outline'} size={18} color={selectedUser.isActive ? '#ef4444' : '#22c55e'} />
              <Text style={[styles.toggleActiveText, { color: selectedUser.isActive ? '#ef4444' : '#22c55e' }]}>
                {selectedUser.isActive ? 'Deactivate User' : 'Activate User'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </PremiumModal>

      {renderMatrixModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  filterRow: { paddingHorizontal: 16, marginBottom: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, backgroundColor: '#F3F4F6' },
  filterChipText: { fontSize: 12, fontWeight: '600', color: '#1F2937' },
  list: { padding: 16, paddingBottom: 80 },
  userItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, marginBottom: 8, elevation: 1 },
  avatar: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  userInfo: { flex: 1, marginLeft: 12 },
  userName: { fontSize: 15, fontWeight: '600' },
  userEmail: { fontSize: 13 },
  userMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  userRole: { fontSize: 12, fontWeight: '600' },
  userActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleBtn: { padding: 4 },
  detailContent: { gap: 12, paddingBottom: 20 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailLabel: { fontSize: 13, width: 80 },
  detailValue: { fontSize: 14, fontWeight: '500', flex: 1 },
  toggleActiveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, marginTop: 16 },
  toggleActiveText: { fontSize: 15, fontWeight: '600' },
  matrixContent: { width: '100%', gap: 4 },
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
  permLaunchBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  permNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.borderLight, marginBottom: 8 },
  permNoticeText: { fontSize: 13, flex: 1 },
  permAutoSaveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  permCount: { fontSize: 13, fontWeight: '600' },
  permAutoSaveText: { fontSize: 12, fontWeight: '700' },
  permTools: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  permToolBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  permToolBtnText: { color: c.text, fontSize: 12, fontWeight: '700' },
  permErrorBox: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 8, backgroundColor: '#fef2f2', marginBottom: 8 },
  permErrorText: { color: '#dc2626', fontSize: 12.5, flex: 1 },
  permModRow: { borderBottomWidth: 1, paddingVertical: 10 },
  permModHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  permModName: { fontSize: 13, fontWeight: '600', flex: 1 },
  permModCount: { fontSize: 11, fontWeight: '700', backgroundColor: c.card, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  permModToggle: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1.5 },
  permActionsRow: { gap: 8, paddingRight: 8, paddingTop: 2 },
  permActionCell: { minWidth: 84, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, alignItems: 'center', gap: 4, flexDirection: 'row', justifyContent: 'space-between' },
  permActionLabel: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  permSaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#7c3aed', borderRadius: 12, paddingVertical: 14, marginTop: 20 },
  permSaveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});