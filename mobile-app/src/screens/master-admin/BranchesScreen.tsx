import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { collection, getDocs } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import {
  subscribeBranches,
  subscribeBranchesScoped,
  createBranch,
  updateBranch,
  deleteBranch,
  regenerateQrToken,
  generateQrToken,
  DEFAULT_RADIUS_IN_METERS,
  type Branch,
} from '../../services/branchService';
import { subscribeEmployees, subscribeEmployeesScoped, type Employee } from '../../services/employeeService';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { PermissionGate } from '../../components/PermissionGate';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../utils/icons';

/**
 * Branches — mobile parity with the web Companies → Branches page
 * (frontend/src/pages/Branches.tsx). List, search, status/company filters,
 * create/edit (with manager picker + geofence radius + QR toggle), view with
 * the QR token, and delete. Writes go through branchService → REST
 * /api/branches (server enforces `settings.edit`).
 */

interface BranchForm {
  companyId: string;
  name: string;
  address: string;
  city: string;
  latitude: string;
  longitude: string;
  radiusInMeters: string;
  managerId: string;
  managerName: string;
  shifts: string;
  qrEnabled: boolean;
  isActive: boolean;
}

const emptyForm: BranchForm = {
  companyId: '',
  name: '',
  address: '',
  city: '',
  latitude: '',
  longitude: '',
  radiusInMeters: '',
  managerId: '',
  managerName: '',
  shifts: '',
  qrEnabled: false,
  isActive: true,
};

const toOptionalNumber = (v: string): number | undefined => {
  const t = v.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

export const BranchesScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [viewModal, setViewModal] = useState(false);
  const [selected, setSelected] = useState<Branch | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<BranchForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [companyFilter, setCompanyFilter] = useState('');
  const [showManagerPicker, setShowManagerPicker] = useState(false);
  const [managerSearch, setManagerSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const s = useMemo(() => createStyles(colors), [colors]);
  const isMasterAdmin = user?.role === 'master-admin';
  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const showCompanyPicker = !effectiveCompanyId && (isMasterAdmin || isRestrictedScope);
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );

  // Branches (all statuses — an archived branch must still be manageable).
  useEffect(() => {
    if (scopeIds.length === 0 && !isRestrictedScope) {
      const unsubAll = subscribeBranches(null, (rows) => {
        setBranches(rows);
        setLoading(false);
      });
      return unsubAll;
    }
    if (scopeIds.length === 0) {
      setBranches([]);
      setLoading(false);
      return;
    }
    const unsub = subscribeBranchesScoped(scopeIds, (rows) => {
      setBranches(rows);
      setLoading(false);
    });
    return unsub;
  }, [scopeIds, isRestrictedScope]);

  // Employees for the branch-manager picker.
  useEffect(() => {
    if (scopeIds.length === 0 && !isRestrictedScope) {
      const unsubAll = subscribeEmployees(null, (emps) => setEmployees(emps));
      return unsubAll;
    }
    if (scopeIds.length === 0) { setEmployees([]); return; }
    const unsub = subscribeEmployeesScoped(scopeIds, (emps) => setEmployees(emps));
    return unsub;
  }, [scopeIds, isRestrictedScope]);

  // Companies (picker + display names).
  useEffect(() => {
    if (isMasterAdmin) {
      getDocs(collection(db, 'companies')).then((snap) => {
        setCompanies(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      }).catch(() => { /* list stays empty — names fall back to ids */ });
    } else if (availableCompanies.length > 0) {
      setCompanies(availableCompanies.map((c) => ({ id: c.id, name: c.name })));
    }
  }, [isMasterAdmin, availableCompanies]);

  const stats = useMemo(() => ({
    total: branches.length,
    active: branches.filter((b) => b.isActive !== false).length,
    qr: branches.filter((b) => b.qrEnabled).length,
  }), [branches]);

  const filtered = useMemo(() => {
    return branches.filter((b) => {
      if (statusFilter === 'active' && b.isActive === false) return false;
      if (statusFilter === 'inactive' && b.isActive !== false) return false;
      if (companyFilter && b.companyId !== companyFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !b.name.toLowerCase().includes(q) &&
          !(b.city || '').toLowerCase().includes(q) &&
          !(b.address || '').toLowerCase().includes(q) &&
          !(b.managerName || '').toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [branches, search, statusFilter, companyFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize]
  );

  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, companyFilter]);

  const getCompanyName = (id?: string) => {
    if (!id) return '';
    return companies.find((c) => c.id === id)?.name || id;
  };

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...emptyForm,
      companyId: effectiveCompanyId || availableCompanies[0]?.id || companies[0]?.id || '',
      radiusInMeters: String(DEFAULT_RADIUS_IN_METERS),
    });
    setManagerSearch('');
    setModal(true);
  };

  const openEdit = (b: Branch) => {
    setEditing(b.id);
    setForm({
      companyId: b.companyId || '',
      name: b.name || '',
      address: b.address || '',
      city: b.city || '',
      latitude: b.latitude !== undefined ? String(b.latitude) : '',
      longitude: b.longitude !== undefined ? String(b.longitude) : '',
      radiusInMeters: b.radiusMeters !== undefined ? String(b.radiusMeters) : '',
      managerId: b.managerId || '',
      managerName: b.managerName || '',
      shifts: (b.shifts || []).join(', '),
      qrEnabled: b.qrEnabled === true,
      isActive: b.isActive !== false,
    });
    setModal(true);
  };

  const openView = (b: Branch) => { setSelected(b); setViewModal(true); };

  const handleDelete = (id: string, name: string) => {
    Alert.alert('Delete Branch', `Delete "${name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteBranch(id); } catch { Alert.alert('Error', 'Failed to delete branch'); }
      }},
    ]);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { Alert.alert('Validation', 'Branch name is required'); return; }
    if (!form.companyId) { Alert.alert('Validation', 'Please assign a company'); return; }
    if (!form.address.trim()) { Alert.alert('Validation', 'Address is required'); return; }
    const lat = toOptionalNumber(form.latitude);
    const lng = toOptionalNumber(form.longitude);
    if (form.latitude.trim() !== '' && lat === undefined) { Alert.alert('Validation', 'Latitude must be a number between -90 and 90'); return; }
    if (lat !== undefined && (lat < -90 || lat > 90)) { Alert.alert('Validation', 'Latitude must be a number between -90 and 90'); return; }
    if (form.longitude.trim() !== '' && lng === undefined) { Alert.alert('Validation', 'Longitude must be a number between -180 and 180'); return; }
    if (lng !== undefined && (lng < -180 || lng > 180)) { Alert.alert('Validation', 'Longitude must be a number between -180 and 180'); return; }
    const radiusRaw = form.radiusInMeters.trim();
    const radius = radiusRaw === '' ? undefined : Number(radiusRaw);
    if (radiusRaw !== '' && (!Number.isFinite(radius as number) || (radius as number) < 50 || (radius as number) > 500)) {
      Alert.alert('Validation', 'Radius must be a number between 50 and 500');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        companyId: form.companyId,
        name: form.name.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        latitude: lat,
        longitude: lng,
        radiusInMeters: radius,
        managerId: form.managerId,
        managerName: form.managerName,
        shifts: form.shifts.split(',').map((x) => x.trim()).filter(Boolean),
        qrEnabled: form.qrEnabled,
        isActive: form.isActive,
      };
      if (editing) {
        await updateBranch(editing, payload);
      } else {
        // QR attendance on → the token must exist before anyone opens the
        // QR view, so mint it now if the branch has none.
        await createBranch({
          ...payload,
          qrToken: form.qrEnabled ? generateQrToken() : '',
        });
      }
      setModal(false);
    } catch (err: any) {
      const msg = String(err?.message || '');
      const denied = msg.includes('permission') || msg.includes('access-denied') || msg.includes('forbidden');
      Alert.alert('Error', denied ? 'You do not have permission to modify branches.' : 'Failed to save branch');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateQr = async () => {
    if (!selected) return;
    Alert.alert(
      selected.qrToken ? 'Regenerate QR code' : 'Generate QR code',
      `A new token will replace the current one${selected.qrToken ? ' — the previous code will stop working immediately' : ''}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Confirm', onPress: async () => {
          setRegenerating(true);
          try {
            const token = await regenerateQrToken(selected.id);
            setSelected({ ...selected, qrToken: token, qrEnabled: true });
          } catch {
            Alert.alert('Error', 'Could not regenerate the QR token');
          } finally {
            setRegenerating(false);
          }
        }},
      ]
    );
  };

  const renderPagination = () => {
    if (filtered.length <= pageSize) return null;
    return (
      <View style={s.paginationRow}>
        <TouchableOpacity style={[s.pageBtn, currentPage === 1 && s.pageBtnDisabled]} disabled={currentPage === 1} onPress={() => setCurrentPage((p) => Math.max(1, p - 1))}>
          <Icon name="chevron-back-outline" size={16} color={currentPage === 1 ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={s.pageInfo}>{currentPage} / {totalPages}</Text>
        <TouchableOpacity style={[s.pageBtn, currentPage === totalPages && s.pageBtnDisabled]} disabled={currentPage === totalPages} onPress={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>
          <Icon name="chevron-forward-outline" size={16} color={currentPage === totalPages ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={s.pageSizeText}>Show:</Text>
        <TouchableOpacity style={s.pageSizeBtn} onPress={() => { const sizes = [5, 10, 20, 50]; const idx = sizes.indexOf(pageSize); setPageSize(sizes[(idx + 1) % sizes.length]); }}>
          <Text style={s.pageSizeBtnText}>{pageSize}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const managerList = useMemo(() => {
    const q = managerSearch.toLowerCase();
    return employees.filter((e) => !q || (e.name || '').toLowerCase().includes(q) || (e.employeeId || '').toLowerCase().includes(q));
  }, [employees, managerSearch]);

  const formatDate = (d: any) => {
    if (!d) return 'N/A';
    const date = d?.toDate ? d.toDate() : new Date(d);
    return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Branches" onBack={() => navigation.goBack()} />
      <View style={s.header}>
        <Text style={s.title}>Branches</Text>
        <Text style={s.count}>{filtered.length} total</Text>
      </View>

      <View style={s.statsRow}>
        {[
          { key: 'all' as const, label: 'Total Branches', value: stats.total, color: '#3b82f6', icon: 'business-outline' },
          { key: 'active' as const, label: 'Active', value: stats.active, color: '#10b981', icon: 'checkmark-circle-outline' },
          { key: 'inactive' as const, label: 'QR Enabled', value: stats.qr, color: '#FF6600', icon: 'qr-code-outline' },
        ].map((card) => (
          <TouchableOpacity
            key={card.key}
            style={[s.statCard, statusFilter === card.key && { borderColor: card.color, borderWidth: 2 }]}
            onPress={() => setStatusFilter((prev) => (prev === card.key ? 'all' : card.key))}
          >
            <View style={[s.statIcon, { backgroundColor: `${card.color}15` }]}>
              <Icon name={card.icon} size={18} color={card.color} />
            </View>
            <Text style={s.statValue}>{card.value}</Text>
            <Text style={s.statLabel}>{card.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.searchRow}>
        <View style={s.searchInputWrap}>
          <Icon name="search-outline" size={18} color={colors.textTertiary} />
          <TextInput style={s.searchInput} placeholder="Search branches..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
        </View>
        <PermissionGate module="settings" action="add">
          <TouchableOpacity style={s.addBtn} onPress={openCreate}>
            <Icon name="add-outline" size={18} color="#fff" />
          </TouchableOpacity>
        </PermissionGate>
      </View>

      {showCompanyPicker && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
          <TouchableOpacity style={[s.filterChip, companyFilter === '' && s.filterChipActive]} onPress={() => setCompanyFilter('')}>
            <Text style={[s.filterChipText, companyFilter === '' && { color: '#fff' }]}>All Companies</Text>
          </TouchableOpacity>
          {companies.map((c) => (
            <TouchableOpacity key={c.id} style={[s.filterChip, companyFilter === c.id && s.filterChipActive]} onPress={() => setCompanyFilter(c.id)}>
              <Text style={[s.filterChipText, companyFilter === c.id && { color: '#fff' }]} numberOfLines={1}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {loading ? (
        <Text style={s.emptyText}>Loading...</Text>
      ) : (
        <ScrollView style={{ flex: 1 }}>
          <View style={s.list}>
            {filtered.length === 0 ? (
              <Text style={s.emptyText}>{search ? 'No branches match your search.' : 'No branches yet. Tap "Add" to create one.'}</Text>
            ) : (
              paginated.map((branch) => (
                <View key={branch.id} style={s.card}>
                  <View style={s.cardTop}>
                    <View style={s.cardLeft}>
                      <View style={[s.statusDot, { backgroundColor: branch.isActive !== false ? '#10b981' : '#9ca3af' }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.branchName}>{branch.name}</Text>
                        {branch.city ? <Text style={s.branchSub}>{branch.city}</Text> : null}
                      </View>
                    </View>
                    <View style={[s.badge, branch.isActive === false && s.badgeInactive]}>
                      <Text style={[s.badgeText, branch.isActive === false && { color: '#6b7280' }]}>{branch.isActive !== false ? 'Active' : 'Inactive'}</Text>
                    </View>
                  </View>
                  {(isMasterAdmin || isRestrictedScope) && (
                    <View style={s.metaRow}>
                      <Icon name="business-outline" size={14} color={colors.textTertiary} />
                      <Text style={s.metaText} numberOfLines={1}>{getCompanyName(branch.companyId) || '—'}</Text>
                    </View>
                  )}
                  <View style={s.metaRow}>
                    <Icon name="location-outline" size={14} color={colors.textTertiary} />
                    <Text style={s.metaText} numberOfLines={1}>{branch.address || 'No address'}</Text>
                  </View>
                  <View style={s.metaRow}>
                    <Icon name="person-outline" size={14} color={colors.textTertiary} />
                    <Text style={s.metaText} numberOfLines={1}>{branch.managerName || 'No manager assigned'}</Text>
                  </View>
                  <View style={s.tagRow}>
                    <View style={s.tag}>
                      <Icon name="resize-outline" size={12} color={colors.textSecondary} />
                      <Text style={s.tagText}>{branch.radiusMeters ?? DEFAULT_RADIUS_IN_METERS}m radius</Text>
                    </View>
                    {branch.qrEnabled && (
                      <View style={[s.tag, { backgroundColor: '#FF660015' }]}>
                        <Icon name="qr-code-outline" size={12} color="#FF6600" />
                        <Text style={[s.tagText, { color: '#FF6600' }]}>QR</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.cardActions}>
                    <TouchableOpacity style={s.viewBtn} onPress={() => openView(branch)}>
                      <Icon name="eye-outline" size={15} color="#64748b" />
                      <Text style={s.viewBtnText}>View</Text>
                    </TouchableOpacity>
                    <PermissionGate module="settings" action="edit">
                      <TouchableOpacity style={s.editBtn} onPress={() => openEdit(branch)}>
                        <Icon name="create-outline" size={15} color="#3b82f6" />
                        <Text style={s.editBtnText}>Edit</Text>
                      </TouchableOpacity>
                    </PermissionGate>
                    <PermissionGate module="settings" action="delete">
                      <TouchableOpacity style={s.delBtn} onPress={() => handleDelete(branch.id, branch.name)}>
                        <Icon name="trash-outline" size={15} color="#ef4444" />
                        <Text style={s.delBtnText}>Delete</Text>
                      </TouchableOpacity>
                    </PermissionGate>
                  </View>
                </View>
              ))
            )}
          </View>
          {renderPagination()}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}

      {/* Create/Edit Modal */}
      <Modal visible={modal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <ScrollView contentContainerStyle={s.modalScroll}>
            <View style={s.modal}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>{editing ? 'Edit Branch' : 'Add New Branch'}</Text>
                <TouchableOpacity onPress={() => setModal(false)}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>
              <TextInput style={s.input} placeholder="Branch Name *" placeholderTextColor={colors.textTertiary} value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} />
              <TextInput style={[s.input, s.textArea]} placeholder="Address *" placeholderTextColor={colors.textTertiary} value={form.address} onChangeText={(t) => setForm({ ...form, address: t })} multiline numberOfLines={2} />
              <TextInput style={s.input} placeholder="City" placeholderTextColor={colors.textTertiary} value={form.city} onChangeText={(t) => setForm({ ...form, city: t })} />
              <View style={s.inputRow}>
                <TextInput style={[s.input, { flex: 1, marginBottom: 12, marginRight: 6 }]} placeholder="Latitude" placeholderTextColor={colors.textTertiary} keyboardType="numeric" value={form.latitude} onChangeText={(t) => setForm({ ...form, latitude: t })} />
                <TextInput style={[s.input, { flex: 1, marginBottom: 12, marginLeft: 6 }]} placeholder="Longitude" placeholderTextColor={colors.textTertiary} keyboardType="numeric" value={form.longitude} onChangeText={(t) => setForm({ ...form, longitude: t })} />
              </View>
              <TextInput style={s.input} placeholder={`Geofence radius (50–500 m, default ${DEFAULT_RADIUS_IN_METERS})`} placeholderTextColor={colors.textTertiary} keyboardType="numeric" value={form.radiusInMeters} onChangeText={(t) => setForm({ ...form, radiusInMeters: t })} />
              <Text style={s.fieldLabel}>Branch Manager</Text>
              <TouchableOpacity style={s.managerSelect} onPress={() => { setManagerSearch(''); setShowManagerPicker(true); }}>
                {form.managerName ? (
                  <Text style={s.managerSelectText} numberOfLines={1}>{form.managerName}</Text>
                ) : (
                  <Text style={s.managerSelectPlaceholder}>Select Manager</Text>
                )}
                <Icon name="chevron-down-outline" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
              <TextInput style={s.input} placeholder="Shifts (comma separated, e.g. Morning, Evening)" placeholderTextColor={colors.textTertiary} value={form.shifts} onChangeText={(t) => setForm({ ...form, shifts: t })} />
              <TouchableOpacity style={s.toggleRow} onPress={() => setForm({ ...form, qrEnabled: !form.qrEnabled })}>
                <View style={{ flex: 1 }}>
                  <Text style={s.toggleLabel}>QR check-in</Text>
                  <Text style={s.toggleHint}>Employees can punch by scanning this branch's QR code</Text>
                </View>
                <View style={[s.switch, form.qrEnabled && s.switchOn]}>
                  <View style={[s.switchKnob, form.qrEnabled && s.switchKnobOn]} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity style={s.toggleRow} onPress={() => setForm({ ...form, isActive: !form.isActive })}>
                <View style={{ flex: 1 }}>
                  <Text style={s.toggleLabel}>Active</Text>
                  <Text style={s.toggleHint}>Inactive branches do not accept check-ins</Text>
                </View>
                <View style={[s.switch, form.isActive && s.switchOn]}>
                  <View style={[s.switchKnob, form.isActive && s.switchKnobOn]} />
                </View>
              </TouchableOpacity>
              {showCompanyPicker && (
                <>
                  <Text style={s.fieldLabel}>Company</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                    {companies.map((c) => (
                      <TouchableOpacity key={c.id} style={[s.chip, form.companyId === c.id && s.chipActive]} onPress={() => setForm({ ...form, companyId: c.id })}>
                        <Text style={[s.chipText, form.companyId === c.id && { color: '#fff' }]}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                  <Text style={s.saveBtnText}>{saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Branch'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Manager Picker Modal */}
      <Modal visible={showManagerPicker} transparent animationType="fade">
        <View style={s.modalOverlay}>
          <View style={s.pickerModal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Select Manager</Text>
              <TouchableOpacity onPress={() => setShowManagerPicker(false)}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
            </View>
            <View style={s.searchInputWrap}>
              <Icon name="search-outline" size={18} color={colors.textTertiary} />
              <TextInput style={s.searchInput} placeholder="Search employees..." placeholderTextColor={colors.textTertiary} value={managerSearch} onChangeText={setManagerSearch} autoFocus />
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {managerList.length === 0 ? (
                <Text style={s.emptyText}>No employees found</Text>
              ) : managerList.map((emp) => (
                <TouchableOpacity
                  key={emp.id || emp.userId || emp.name}
                  style={[s.pickerItem, form.managerId === ((emp.userId as string) || emp.id) && s.pickerItemActive]}
                  onPress={() => {
                    setForm((f) => ({ ...f, managerId: (emp.userId as string) || emp.id, managerName: emp.name }));
                    setShowManagerPicker(false);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.pickerItemName, form.managerId === ((emp.userId as string) || emp.id) && { color: '#fff' }]}>{emp.name}</Text>
                    {emp.employeeId ? <Text style={[s.pickerItemSub, form.managerId === ((emp.userId as string) || emp.id) && { color: 'rgba(255,255,255,0.85)' }]}>{emp.employeeId} · {emp.designation || ''}</Text> : null}
                  </View>
                  {form.managerId === ((emp.userId as string) || emp.id) ? <Icon name="checkmark-circle-outline" size={18} color="#fff" /> : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* View Modal */}
      <Modal visible={viewModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <ScrollView contentContainerStyle={s.modalScroll}>
            <View style={s.modal}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Branch Details</Text>
                <TouchableOpacity onPress={() => { setViewModal(false); setSelected(null); }}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>
              {selected && (
                <>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Branch</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={[s.statusDot, { backgroundColor: selected.isActive !== false ? '#10b981' : '#9ca3af' }]} />
                      <Text style={s.detailValue}>{selected.name}</Text>
                    </View>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Company</Text>
                    <Text style={s.detailValue}>{getCompanyName(selected.companyId) || '—'}</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Address</Text>
                    <Text style={s.detailValue}>{selected.address || 'N/A'}{selected.city ? `, ${selected.city}` : ''}</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Coordinates</Text>
                    <Text style={s.detailValue}>
                      {selected.latitude !== undefined && selected.longitude !== undefined
                        ? `${selected.latitude}, ${selected.longitude}`
                        : 'Not set'}
                    </Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Geofence radius</Text>
                    <Text style={s.detailValue}>{selected.radiusMeters ?? DEFAULT_RADIUS_IN_METERS} m</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Manager</Text>
                    <Text style={s.detailValue}>{selected.managerName || 'Not assigned'}</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Shifts</Text>
                    <Text style={s.detailValue}>{(selected.shifts || []).length > 0 ? (selected.shifts || []).join(', ') : 'None configured'}</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Status</Text>
                    <Text style={s.detailValue}>{selected.isActive !== false ? 'Active' : 'Inactive'}</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>QR check-in</Text>
                    <Text style={s.detailValue}>{selected.qrEnabled ? 'Enabled' : 'Disabled'}</Text>
                  </View>
                  {selected.qrEnabled && selected.qrToken ? (
                    <View style={s.detailRow}>
                      <Text style={s.detailLabel}>QR token</Text>
                      <Text style={s.qrToken} selectable>{selected.qrToken}</Text>
                      <PermissionGate module="settings" action="edit">
                        <TouchableOpacity style={s.regenBtn} onPress={handleRegenerateQr} disabled={regenerating}>
                          {regenerating ? <ActivityIndicator size={14} color="#FF6600" /> : <Icon name="refresh-outline" size={14} color="#FF6600" />}
                          <Text style={s.regenBtnText}>{selected.qrToken ? 'Regenerate token' : 'Generate token'}</Text>
                        </TouchableOpacity>
                      </PermissionGate>
                    </View>
                  ) : null}
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Created</Text>
                    <Text style={s.detailValue}>{formatDate(selected.createdAt)}</Text>
                  </View>
                </>
              )}
              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => { setViewModal(false); setSelected(null); }}><Text style={s.cancelBtnText}>Close</Text></TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  header: { padding: 20, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', color: c.text },
  count: { color: c.textSecondary, fontSize: 14 },
  addBtn: { backgroundColor: '#FF6600', borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  statsRow: { paddingHorizontal: 16, marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  statCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 14, width: '31.5%', alignItems: 'center', justifyContent: 'center', height: 105 },
  statIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  statValue: { fontSize: 22, fontWeight: '700', color: c.text },
  statLabel: { fontSize: 12, color: c.textSecondary, marginTop: 2, textAlign: 'center' },
  searchRow: { marginHorizontal: 16, marginBottom: 8, flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInputWrap: { flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  filterRow: { paddingHorizontal: 16, marginBottom: 12, flexGrow: 0 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8 },
  filterChipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  filterChipText: { color: '#1F2937', fontSize: 13, fontWeight: '600', maxWidth: 160 },
  list: { paddingHorizontal: 16, gap: 10 },
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 16 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  branchName: { fontSize: 16, fontWeight: '600', color: c.text },
  branchSub: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  badge: { backgroundColor: '#10b98118', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeInactive: { backgroundColor: '#9ca3af25' },
  badgeText: { color: '#059669', fontWeight: '700', fontSize: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metaText: { fontSize: 13, color: c.textSecondary, flex: 1 },
  tagRow: { flexDirection: 'row', gap: 8, marginTop: 6, marginBottom: 4, flexWrap: 'wrap' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: `${c.accent}12`, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  tagText: { fontSize: 11.5, fontWeight: '600', color: c.textSecondary },
  cardActions: { flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: c.borderLight, paddingTop: 10, marginTop: 6 },
  viewBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#64748b15', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  viewBtnText: { color: '#64748b', fontWeight: '600', fontSize: 13 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#3b82f615', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  editBtnText: { color: '#3b82f6', fontWeight: '600', fontSize: 13 },
  delBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ef444415', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  delBtnText: { color: '#ef4444', fontWeight: '600', fontSize: 13 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: c.modalOverlay, justifyContent: 'center' },
  modalScroll: { padding: 20 },
  modal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 18, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: c.text, fontSize: 15, marginBottom: 12 },
  inputRow: { flexDirection: 'row' },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  fieldLabel: { color: c.textSecondary, fontSize: 14, marginBottom: 8, fontWeight: '600' },
  managerSelect: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.background, borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12 },
  managerSelectText: { color: c.text, fontSize: 15, flex: 1 },
  managerSelectPlaceholder: { color: c.textTertiary, fontSize: 15, flex: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.background, borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 },
  toggleLabel: { color: c.text, fontSize: 15, fontWeight: '600' },
  toggleHint: { color: c.textTertiary, fontSize: 12, marginTop: 2 },
  switch: { width: 46, height: 28, borderRadius: 14, backgroundColor: '#d1d5db', padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: '#FF6600' },
  switchKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  switchKnobOn: { alignSelf: 'flex-end' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8, marginBottom: 4 },
  chipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  chipText: { color: '#1F2937', fontSize: 13, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center' },
  cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#FF6600', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  pickerModal: { backgroundColor: c.card, borderRadius: 18, padding: 20, marginHorizontal: 20 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: c.borderLight },
  pickerItemActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  pickerItemName: { color: c.text, fontSize: 15, fontWeight: '500' },
  pickerItemSub: { color: c.textTertiary, fontSize: 12, marginTop: 2 },
  detailRow: { marginBottom: 14 },
  detailLabel: { fontSize: 12, color: c.textTertiary, marginBottom: 2 },
  detailValue: { fontSize: 15, color: c.text, fontWeight: '500' },
  qrToken: { fontSize: 14, color: c.text, fontWeight: '600', backgroundColor: c.background, borderWidth: 1, borderColor: c.borderLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 4 },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, backgroundColor: '#FF660015', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  regenBtnText: { color: '#FF6600', fontWeight: '600', fontSize: 13 },
});
