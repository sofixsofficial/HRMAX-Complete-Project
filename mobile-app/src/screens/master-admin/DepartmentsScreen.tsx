import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { collection, getDocs } from '../../aws/firestore-compat';
import { db } from '../../aws/clients';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { subscribeDepartments, subscribeDepartmentsScoped, createDepartment, updateDepartment, deleteDepartment, type Department } from '../../services/departmentService';
import { subscribeEmployees, subscribeEmployeesScoped, type Employee } from '../../services/employeeService';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { PermissionGate } from '../../components/PermissionGate';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../utils/icons';

const COLORS = ['#3b82f6', '#10b981', '#FF6600', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#eab308'];

interface DeptForm {
  name: string;
  code: string;
  color: string;
  managerId: string;
  managerName: string;
  description: string;
  companyId: string;
}

const emptyForm: DeptForm = { name: '', code: '', color: '#3b82f6', managerId: '', managerName: '', description: '', companyId: '' };

export const DepartmentsScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [viewModal, setViewModal] = useState(false);
  const [selected, setSelected] = useState<Department | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<DeptForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ total: 0, withManager: 0, totalEmployees: 0 });
  const [activeFilter, setActiveFilter] = useState<'all' | 'withManager' | 'employees'>('all');
  const [companyFilter, setCompanyFilter] = useState('');
  const [showManagerPicker, setShowManagerPicker] = useState(false);
  const [managerSearch, setManagerSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);
  const isMasterAdmin = user?.role === 'master-admin';
  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const showCompanyPicker = !effectiveCompanyId && (isMasterAdmin || isRestrictedScope);
  // Active scope: selected company, or every authorized company in "All" mode
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );

  useEffect(() => {
    if (scopeIds.length === 0 && !isRestrictedScope) {
      const unsubAll = subscribeDepartments(null, (depts) => {
        setDepartments(depts);
        setStats({
          total: depts.length,
          withManager: depts.filter(d => !!d.managerId).length,
          totalEmployees: depts.reduce((sum, d) => sum + (d.employeeCount || 0), 0),
        });
        setLoading(false);
      });
      return unsubAll;
    }
    if (scopeIds.length === 0) {
      setDepartments([]);
      setStats({ total: 0, withManager: 0, totalEmployees: 0 });
      setLoading(false);
      return;
    }
    const unsub = subscribeDepartmentsScoped(scopeIds, (depts) => {
      setDepartments(depts);
      setStats({
        total: depts.length,
        withManager: depts.filter(d => !!d.managerId).length,
        totalEmployees: depts.reduce((sum, d) => sum + (d.employeeCount || 0), 0),
      });
      setLoading(false);
    });
    return unsub;
  }, [scopeIds, isRestrictedScope]);

  useEffect(() => {
    if (scopeIds.length === 0 && !isRestrictedScope) {
      const unsubAll = subscribeEmployees(null, (emps) => {
        setEmployees(emps);
      });
      return unsubAll;
    }
    if (scopeIds.length === 0) { setEmployees([]); return; }
    const unsub = subscribeEmployeesScoped(scopeIds, (emps) => {
      setEmployees(emps);
    });
    return unsub;
  }, [scopeIds, isRestrictedScope]);

  useEffect(() => {
    if (isMasterAdmin) {
      getDocs(collection(db, 'companies')).then(snap => {
        setCompanies(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
    } else if (availableCompanies.length > 0) {
      setCompanies(availableCompanies.map(c => ({ id: c.id, name: c.name })));
    }
  }, [isMasterAdmin, availableCompanies]);

  const filtered = useMemo(() => {
    return departments.filter(d => {
      if (activeFilter === 'withManager' && !d.managerId) return false;
      if (activeFilter === 'employees' && (d.employeeCount || 0) <= 0) return false;
      if (companyFilter && d.companyId !== companyFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!d.name.toLowerCase().includes(q) && !(d.managerName || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [departments, search, activeFilter, companyFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, activeFilter, companyFilter]);

  const getCompanyName = (id?: string) => {
    if (!id) return '';
    return companies.find(c => c.id === id)?.name || id;
  };

  const deptEmployees = selected ? employees.filter(e => e.departmentId === selected.id || e.department === selected.name) : [];

  const openCreate = () => { setEditing(null); setForm({ ...emptyForm, companyId: effectiveCompanyId || availableCompanies[0]?.id || '' }); setManagerSearch(''); setModal(true); };

  const openEdit = (dept: Department) => {
    setEditing(dept.id);
    setForm({
      name: dept.name, code: dept.code || '', color: dept.color || '#3b82f6',
      managerId: dept.managerId || '', managerName: dept.managerName || '',
      description: dept.description || '', companyId: dept.companyId || effectiveCompanyId || '',
    });
    setModal(true);
  };

  const openView = (dept: Department) => { setSelected(dept); setViewModal(true); };

  const handleDelete = (id: string, name: string) => {
    Alert.alert('Delete Department', `Delete "${name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteDepartment(id); } catch { Alert.alert('Error', 'Failed to delete'); }
      }},
    ]);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { Alert.alert('Validation', 'Department name is required'); return; }
    if (!form.companyId) { Alert.alert('Validation', 'Please assign a company'); return; }
    setSaving(true);
    try {
      if (editing) {
        const { companyId, ...updates } = form;
        await updateDepartment(editing, updates);
      } else {
        await createDepartment(form);
      }
      setModal(false);
    } catch { Alert.alert('Error', 'Failed to save department'); }
    finally { setSaving(false); }
  };

  const toggleFilter = (f: 'all' | 'withManager' | 'employees') => {
    setActiveFilter(prev => prev === f ? 'all' : f);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Code,Manager,Employees,Company,Description'];
      const rows = filtered.map(d => `${d.name},${d.code || ''},${d.managerName || ''},${d.employeeCount || 0},${getCompanyName(d.companyId)},${(d.description || '').replace(/,/g, ';')}`);
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'departments_export.csv');
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

  const selectManager = (emp: Employee) => {
    setForm({ ...form, managerId: (emp.userId as string) || emp.id, managerName: emp.name });
  };

  const managerList = useMemo(() => {
    const q = managerSearch.toLowerCase();
    return employees.filter(e => !q || (e.name || '').toLowerCase().includes(q) || (e.employeeId || '').toLowerCase().includes(q));
  }, [employees, managerSearch]);

  const formatDate = (d: any) => {
    if (!d) return 'N/A';
    const date = d?.toDate ? d.toDate() : new Date(d);
    return date.toLocaleDateString();
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Departments" onBack={() => navigation.goBack()} />
      <View style={s.header}>
        <Text style={s.title}>Departments</Text>
        <Text style={s.count}>{filtered.length} total</Text>
      </View>

      <View style={s.statsRow}>
        {[
          { key: 'all' as const, label: 'Total Departments', value: stats.total, color: '#3b82f6', icon: 'business-outline' },
          { key: 'employees' as const, label: 'Total Employees', value: stats.totalEmployees, color: '#10b981', icon: 'people-outline' },
          { key: 'withManager' as const, label: 'With Manager', value: stats.withManager, color: '#f59e0b', icon: 'person-outline' },
        ].map(card => (
          <TouchableOpacity
            key={card.key}
            style={[s.statCard, activeFilter === card.key && { borderColor: card.color, borderWidth: 2 }]}
            onPress={() => toggleFilter(card.key)}
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
          <TextInput style={s.searchInput} placeholder="Search departments..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
        </View>
        <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
        <PermissionGate module="departments" action="add">
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
          {companies.map(c => (
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
              <Text style={s.emptyText}>{search ? 'No departments match your search.' : 'No departments yet. Tap "Add" to create one.'}</Text>
            ) : (
              paginated.map(dept => (
                <View key={dept.id} style={s.card}>
                  <View style={s.cardTop}>
                    <View style={s.cardLeft}>
                      <View style={[s.colorDot, { backgroundColor: dept.color || '#3b82f6' }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.deptName}>{dept.name}</Text>
                        {dept.code && <Text style={s.deptCode}>Code: {dept.code}</Text>}
                      </View>
                    </View>
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{dept.employeeCount || 0}</Text>
                    </View>
                  </View>
                  {(isMasterAdmin || isRestrictedScope) && (
                    <View style={s.metaRow}>
                      <Icon name="business-outline" size={14} color={colors.textTertiary} />
                      <Text style={s.metaText} numberOfLines={1}>{getCompanyName(dept.companyId) || '—'}</Text>
                    </View>
                  )}
                  <View style={s.metaRow}>
                    <Icon name="person-outline" size={14} color={colors.textTertiary} />
                    <Text style={s.metaText} numberOfLines={1}>{dept.managerName || 'No manager assigned'}</Text>
                  </View>
                  <View style={s.metaRow}>
                    <Icon name="people-outline" size={14} color={colors.textTertiary} />
                    <Text style={s.metaText}>{dept.employeeCount || 0} employees</Text>
                  </View>
                  {dept.description && <Text style={s.desc} numberOfLines={2}>{dept.description}</Text>}
                  <View style={s.cardActions}>
                    <TouchableOpacity style={s.viewBtn} onPress={() => openView(dept)}>
                      <Icon name="eye-outline" size={15} color="#64748b" />
                      <Text style={s.viewBtnText}>View</Text>
                    </TouchableOpacity>
                    <PermissionGate module="departments" action="edit">
                      <TouchableOpacity style={s.editBtn} onPress={() => openEdit(dept)}>
                        <Icon name="create-outline" size={15} color="#3b82f6" />
                        <Text style={s.editBtnText}>Edit</Text>
                      </TouchableOpacity>
                    </PermissionGate>
                    <PermissionGate module="departments" action="delete">
                      <TouchableOpacity style={s.delBtn} onPress={() => handleDelete(dept.id, dept.name)}>
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
                <Text style={s.modalTitle}>{editing ? 'Edit Department' : 'Add New Department'}</Text>
                <TouchableOpacity onPress={() => setModal(false)}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>
              <TextInput style={s.input} placeholder="Department Name *" placeholderTextColor={colors.textTertiary} value={form.name} onChangeText={(t) => setForm({...form, name: t})} />
              <TextInput style={s.input} placeholder="Department Code" placeholderTextColor={colors.textTertiary} value={form.code} onChangeText={(t) => setForm({...form, code: t})} />
              <Text style={s.fieldLabel}>Department Manager</Text>
              <TouchableOpacity style={s.managerSelect} onPress={() => { setManagerSearch(''); setShowManagerPicker(true); }}>
                {form.managerName ? (
                  <Text style={s.managerSelectText} numberOfLines={1}>{form.managerName}</Text>
                ) : (
                  <Text style={s.managerSelectPlaceholder}>Select Manager</Text>
                )}
                <Icon name="chevron-down-outline" size={18} color={colors.textTertiary} />
              </TouchableOpacity>
              <TextInput style={[s.input, s.textArea]} placeholder="Description" placeholderTextColor={colors.textTertiary} value={form.description} onChangeText={(t) => setForm({...form, description: t})} multiline numberOfLines={3} />
              {showCompanyPicker && (
                <>
                  <Text style={s.fieldLabel}>Company</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                    {companies.map(c => (
                      <TouchableOpacity key={c.id} style={[s.chip, form.companyId === c.id && s.chipActive]} onPress={() => setForm({...form, companyId: c.id})}>
                        <Text style={[s.chipText, form.companyId === c.id && { color: '#fff' }]}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
              <Text style={s.fieldLabel}>Color</Text>
              <View style={s.colorRow}>
                {COLORS.map(c => (
                  <TouchableOpacity key={c} style={[s.colorOpt, { backgroundColor: c }, form.color === c && s.colorOptSel]} onPress={() => setForm({...form, color: c})} />
                ))}
              </View>
              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                  <Text style={s.saveBtnText}>{saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Department'}</Text>
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
              ) : managerList.map(emp => (
                <TouchableOpacity
                  key={emp.id || emp.userId || emp.name}
                  style={[s.pickerItem, form.managerId === ((emp.userId as string) || emp.id) && s.pickerItemActive]}
                  onPress={() => { selectManager(emp); setShowManagerPicker(false); }}
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
                <Text style={s.modalTitle}>Department Details</Text>
                <TouchableOpacity onPress={() => { setViewModal(false); setSelected(null); }}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>
              {selected && (
                <>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Department</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={[s.colorDot, { backgroundColor: selected.color || '#3b82f6' }]} />
                      <Text style={s.detailValue}>{selected.name}</Text>
                    </View>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Code</Text>
                    <Text style={s.detailValue}>{selected.code || 'N/A'}</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Manager</Text>
                    <Text style={s.detailValue}>{selected.managerName || 'Not assigned'}</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Employees</Text>
                    <Text style={s.detailValue}>{selected.employeeCount || 0}</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Description</Text>
                    <Text style={s.detailValue}>{selected.description || 'No description'}</Text>
                  </View>
                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Created</Text>
                    <Text style={s.detailValue}>{formatDate(selected.createdAt)}</Text>
                  </View>
                  {deptEmployees.length > 0 && (
                    <View style={{ marginTop: 16 }}>
                      <Text style={s.fieldLabel}>Employees in Dept ({deptEmployees.length})</Text>
                      {deptEmployees.map(emp => (
                        <View key={emp.id} style={s.empRow}>
                          <Icon name="person-outline" size={16} color={colors.textSecondary} />
                          <Text style={s.empName}>{emp.name}</Text>
                          <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{emp.designation || ''}</Text>
                        </View>
                      ))}
                    </View>
                  )}
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
  exportBtn: { backgroundColor: '#10b981', borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  list: { paddingHorizontal: 16, gap: 10 },
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 16 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  colorDot: { width: 12, height: 12, borderRadius: 6 },
  deptName: { fontSize: 16, fontWeight: '600', color: c.text },
  deptCode: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  badge: { backgroundColor: `${c.accent}15`, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: c.accent, fontWeight: '700', fontSize: 14 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  metaText: { fontSize: 13, color: c.textSecondary, flex: 1 },
  desc: { fontSize: 13, color: c.textTertiary, marginBottom: 8 },
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
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  fieldLabel: { color: c.textSecondary, fontSize: 14, marginBottom: 8, fontWeight: '600' },
  managerSelect: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.background, borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12 },
  managerSelectText: { color: c.text, fontSize: 15, flex: 1 },
  managerSelectPlaceholder: { color: c.textTertiary, fontSize: 15, flex: 1 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6', marginRight: 8, marginBottom: 4 },
  chipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  chipText: { color: '#1F2937', fontSize: 13, fontWeight: '600' },
  colorRow: { flexDirection: 'row', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  colorOpt: { width: 34, height: 34, borderRadius: 17 },
  colorOptSel: { borderWidth: 3, borderColor: '#fff' },
  pickerModal: { backgroundColor: c.card, borderRadius: 18, padding: 20, marginHorizontal: 20 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: c.borderLight },
  pickerItemActive: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  pickerItemName: { color: c.text, fontSize: 15, fontWeight: '500' },
  pickerItemSub: { color: c.textTertiary, fontSize: 12, marginTop: 2 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center' },
  cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#FF6600', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  detailRow: { marginBottom: 14 },
  detailLabel: { fontSize: 12, color: c.textTertiary, marginBottom: 2 },
  detailValue: { fontSize: 15, color: c.text, fontWeight: '500' },
  empRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.borderLight },
  empName: { flex: 1, fontSize: 14, color: c.text },
});
