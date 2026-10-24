import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs } from '../../aws/firestore-compat';
import { ref, uploadBytes, getDownloadURL } from '../../aws/storage-compat';
import { db, storage } from '../../aws/clients';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { subscribeEmployees, subscribeEmployeesScoped, createEmployee, updateEmployee, getEmployeesByCompany, type Employee } from '../../services/employeeService';
import { getDepartmentsByCompany, type Department } from '../../services/departmentService';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { PermissionGate } from '../../components/PermissionGate';
import { FilterChips } from '../../components/FilterChips';
import { ScreenHeader } from '../../components/ScreenHeader';
import { Icon } from '../../utils/icons';

const STATUS_OPTIONS = ['Active', 'Inactive', 'On Leave'] as const;
const EMPLOYMENT_TYPE_OPTIONS = ['Full-time', 'Part-time', 'Contract', 'Intern'] as const;
const ROLE_OPTIONS = [
  { value: 'employee', label: 'Employee' },
  { value: 'reporting-manager', label: 'Reporting Manager' },
];
const STATUS_COLORS: Record<string, string> = { Active: '#10b981', Inactive: '#ef4444', 'On Leave': '#FF6600' };

interface EmpForm {
  name: string; email: string; username: string; password: string; phone: string;
  employeeId: string; designation: string; department: string; departmentId: string; departmentColor: string;
  employmentType: string; joinDate: string; birthDate: string;
  role: string; status: string; companyId: string;
  address: string; emergencyContactName: string; emergencyContactPhone: string;
  aadharNumber: string; panNumber: string;
  bankName: string; accountHolderName: string; accountNumber: string; ifscCode: string;
  pfAccountNumber: string; uanNumber: string;
  monthlyGrossSalary: string; salaryEffectiveDate: string;
  salaryCycle: string; workingDaysPerMonth: string; overtimeRatePerHour: string; weekendDays: number[];
  managerId: string; managerName: string;
}

const EMPLOYEE_DOC_FIELDS = ['aadharDoc', 'panDoc', 'joiningLetterDoc', 'offerLetterDoc'] as const;
type EmployeeDocField = typeof EMPLOYEE_DOC_FIELDS[number];

interface DocFile {
  uri: string; name: string; size?: number; mimeType?: string;
}

const WEEKDAY_OPTIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const emptyForm: EmpForm = {
  name: '', email: '', username: '', password: '', phone: '',
  employeeId: '', designation: '', department: '', departmentId: '', departmentColor: '#f97316',
  employmentType: 'Full-time', joinDate: '', birthDate: '',
  role: 'employee', status: 'Active', companyId: '',
  address: '', emergencyContactName: '', emergencyContactPhone: '',
  aadharNumber: '', panNumber: '',
  bankName: '', accountHolderName: '', accountNumber: '', ifscCode: '',
  pfAccountNumber: '', uanNumber: '',
  monthlyGrossSalary: '0', salaryEffectiveDate: '',
  salaryCycle: 'Monthly', workingDaysPerMonth: '26', overtimeRatePerHour: '1.5', weekendDays: [0, 6],
  managerId: '', managerName: '',
};

export const EmployeesScreen: React.FC<{ route?: any }> = ({ route }) => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user, hasPermission } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allManagers, setAllManagers] = useState<Employee[]>([]);
  const [docFiles, setDocFiles] = useState<Partial<Record<EmployeeDocField, DocFile>>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [viewModal, setViewModal] = useState(false);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<EmpForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0, onLeave: 0 });
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  // form section toggles
  const [showAccount, setShowAccount] = useState(false);
  const [showOrg, setShowOrg] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showBank, setShowBank] = useState(false);
  const [showSalary, setShowSalary] = useState(false);
  const [showEmergency, setShowEmergency] = useState(false);

  const s = useMemo(() => createStyles(colors), [colors]);

  const isMasterAdmin = user?.role === 'master-admin';
  const showCompanyPicker = isMasterAdmin && !effectiveCompanyId;
  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  // Active scope: selected company, or every authorized company in "All" mode
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );

  useEffect(() => {
    // master-admin without a selection keeps the full-directory view
    if (scopeIds.length === 0) {
      if (!isRestrictedScope) {
        const unsubAll = subscribeEmployees(null, (emps) => {
          setEmployees(emps);
          setStats({
            total: emps.length,
            active: emps.filter(e => e.status === 'Active').length,
            inactive: emps.filter(e => e.status === 'Inactive').length,
            onLeave: emps.filter(e => e.status === 'On Leave').length,
          });
          setLoading(false);
        });
        return unsubAll;
      }
      setEmployees([]);
      setStats({ total: 0, active: 0, inactive: 0, onLeave: 0 });
      setLoading(false);
      return;
    }
    const unsub = subscribeEmployeesScoped(scopeIds, (emps) => {
      setEmployees(emps);
      setStats({
        total: emps.length,
        active: emps.filter(e => e.status === 'Active').length,
        inactive: emps.filter(e => e.status === 'Inactive').length,
        onLeave: emps.filter(e => e.status === 'On Leave').length,
      });
      setLoading(false);
    });
    return unsub;
  }, [scopeIds, isRestrictedScope]);

  useEffect(() => {
    if (scopeIds.length > 0 || isMasterAdmin) {
      getDocs(collection(db, 'companies')).then(snap => {
        setCompanies(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }).catch(() => {});
    }
  }, [scopeIds, isMasterAdmin]);

  useEffect(() => {
    if (form.companyId) {
      getDepartmentsByCompany(form.companyId).then(setDepartments).catch(() => setDepartments([]));
    } else {
      setDepartments([]);
    }
  }, [form.companyId]);

  useEffect(() => {
    if (form.companyId) {
      getEmployeesByCompany(form.companyId)
        .then(emps => setAllManagers(emps.filter(e =>
          (e as any).isReportingManager === true ||
          e.role === 'reporting-manager' ||
          e.role === 'company-admin' ||
          e.role === 'team-leader' ||
          e.role === 'executive'
        )))
        .catch(() => setAllManagers([]));
    } else {
      setAllManagers([]);
    }
  }, [form.companyId]);

  const filtered = useMemo(() => {
    return employees.filter(e => {
      if (filterStatus && e.status !== filterStatus) return false;
      if (filterCompany && e.companyId !== filterCompany) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.name?.toLowerCase().includes(q) && !e.email?.toLowerCase().includes(q) &&
            !e.department?.toLowerCase().includes(q) && !e.designation?.toLowerCase().includes(q) &&
            !(e.employeeId || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [employees, search, filterStatus, filterCompany]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, filterStatus, filterCompany]);

  const openCreate = () => {
    if (!hasPermission('employees.create')) {
      Alert.alert('Access denied', 'You do not have permission to create employees');
      return;
    }
    setEditing(null);
    setForm({ ...emptyForm, companyId: effectiveCompanyId || '' });
    setDocFiles({});
    setShowAccount(false); setShowOrg(false); setShowDocs(false); setShowBank(false); setShowSalary(false); setShowEmergency(false);
    setModal(true);
  };

  useEffect(() => {
    if (route?.params?.action === 'create') {
      openCreate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.action]);

  // Deep-link status filter from dashboard cards (e.g. Active / Inactive / On Leave)
  useEffect(() => {
    const st = route?.params?.status as string | undefined;
    if (st && STATUS_OPTIONS.includes(st as any) && st !== filterStatus) {
      setFilterStatus(st);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.status]);

  const openEdit = (emp: Employee) => {
    if (!hasPermission('employees.edit')) {
      Alert.alert('Access denied', 'You do not have permission to edit employees');
      return;
    }
    setEditing(emp.id);
    setForm({
      name: emp.name || '',
      email: emp.email || '',
      username: (emp as any).username || '',
      password: '',
      phone: emp.phone || '',
      employeeId: emp.employeeId || '',
      designation: emp.designation || '',
      department: emp.department || '',
      departmentId: (emp as any).departmentId || '',
      departmentColor: (emp as any).departmentColor || '#f97316',
      employmentType: emp.employmentType || 'Full-time',
      joinDate: emp.joinDate ? (typeof emp.joinDate === 'string' ? emp.joinDate : new Date(emp.joinDate.seconds ? emp.joinDate.seconds * 1000 : emp.joinDate).toISOString().split('T')[0]) : '',
      birthDate: (emp as any).birthDate || '',
      role: emp.role || 'employee',
      status: emp.status || 'Active',
      companyId: emp.companyId || effectiveCompanyId || '',
      address: (emp as any).address || '',
      emergencyContactName: (emp as any).emergencyContactName || '',
      emergencyContactPhone: (emp as any).emergencyContactPhone || '',
      aadharNumber: (emp as any).aadharNumber || '',
      panNumber: (emp as any).panNumber || '',
      bankName: (emp as any).bankName || '',
      accountHolderName: (emp as any).accountHolderName || '',
      accountNumber: (emp as any).accountNumber || '',
      ifscCode: (emp as any).ifscCode || '',
      pfAccountNumber: (emp as any).pfAccountNumber || '',
      uanNumber: (emp as any).uanNumber || '',
      monthlyGrossSalary: String((emp as any).monthlyGrossSalary || 0),
      salaryEffectiveDate: (emp as any).salaryEffectiveDate || '',
      salaryCycle: (emp as any).salaryCycle || 'Monthly',
      workingDaysPerMonth: String((emp as any).workingDaysPerMonth || 26),
      overtimeRatePerHour: String((emp as any).overtimeRatePerHour || 1.5),
      weekendDays: (emp as any).weekendDays && (emp as any).weekendDays.length ? (emp as any).weekendDays : [0, 6],
      managerId: (emp as any).managerId || (emp as any).reportingManagerId || '',
      managerName: (emp as any).managerName || (emp as any).reportingManagerName || '',
    });
    setDocFiles({});
    setShowAccount(false); setShowOrg(false); setShowDocs(false); setShowBank(false); setShowSalary(false); setShowEmergency(false);
    setModal(true);
  };

  const openView = (emp: Employee) => { setSelected(emp); setViewModal(true); };

  const handleDelete = (id: string, name: string) => {
    if (!hasPermission('employees.delete')) {
      Alert.alert('Access denied', 'You do not have permission to delete employees');
      return;
    }
    Alert.alert('Deactivate Employee', `Deactivate "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: async () => {
        try { await updateEmployee(id, { status: 'Inactive' } as any); } catch { Alert.alert('Error', 'Failed to deactivate'); }
      }},
    ]);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) { Alert.alert('Validation', 'Name and email are required'); return; }
    if (form.name.trim().length < 2) { Alert.alert('Validation', 'Name must be at least 2 characters'); return; }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) { Alert.alert('Validation', 'Invalid email address'); return; }
    if (!editing) {
      if (!form.username.trim() || form.username.trim().length < 3) { Alert.alert('Validation', 'Username must be at least 3 characters'); return; }
      if (!form.password) { Alert.alert('Validation', 'Password is required for new employees'); return; }
      if (form.password.length < 6) { Alert.alert('Validation', 'Password must be at least 6 characters'); return; }
      if (!form.companyId) { Alert.alert('Validation', 'Please assign a company'); return; }
      if (form.role !== 'reporting-manager' && !form.managerId) { Alert.alert('Validation', 'Manager is required for Employee role'); return; }
    }
    setSaving(true);
    try {
      const employeeIdFinal = !editing && !form.employeeId.trim() ? await generateEmployeeId(form.companyId) : form.employeeId;
      const payload: any = {
        name: form.name,
        email: form.email,
        username: form.username,
        phone: form.phone,
        employeeId: employeeIdFinal,
        designation: form.designation,
        department: form.department,
        departmentId: form.departmentId,
        departmentColor: form.departmentColor,
        employmentType: form.employmentType,
        joinDate: form.joinDate || new Date(),
        birthDate: form.birthDate,
        role: form.role,
        status: form.status,
        companyId: form.companyId,
        address: form.address,
        emergencyContactName: form.emergencyContactName,
        emergencyContactPhone: form.emergencyContactPhone,
        aadharNumber: form.aadharNumber,
        panNumber: form.panNumber,
        bankName: form.bankName,
        accountHolderName: form.accountHolderName,
        accountNumber: form.accountNumber,
        ifscCode: form.ifscCode,
        pfAccountNumber: form.pfAccountNumber,
        uanNumber: form.uanNumber,
        monthlyGrossSalary: Number(form.monthlyGrossSalary) || 0,
        salaryEffectiveDate: form.salaryEffectiveDate,
        salaryCycle: form.salaryCycle || 'Monthly',
        workingDaysPerMonth: Number(form.workingDaysPerMonth) || 26,
        overtimeRatePerHour: Number(form.overtimeRatePerHour) || 1.5,
        weekendDays: form.weekendDays,
        managerId: form.managerId,
        managerName: form.managerName,
        isReportingManager: form.role === 'reporting-manager',
        reportingManagerId: form.role === 'reporting-manager' ? '' : form.managerId || '',
        reportingManagerName: form.role === 'reporting-manager' ? '' : form.managerName || '',
        reportsToRole: form.role === 'reporting-manager'
          ? 'company-admin'
          : (allManagers.find(m => m.id === form.managerId || m.userId === form.managerId)?.role === 'company-admin'
              ? 'company-admin'
              : 'reporting-manager'),
      };

      let employeeId = editing;
      if (editing) {
        await updateEmployee(editing, payload);
        employeeId = editing;
      } else {
        const result = await createEmployee(payload, form.password);
        employeeId = result.id;
      }

      const newFiles = Object.entries(docFiles).filter(([, f]) => !!f);
      if (newFiles.length > 0) {
        const uploads: Record<string, string> = {};
        for (const [field, file] of newFiles) {
          if (!file) continue;
          const url = await uploadEmployeeFile(file, employeeId, field);
          uploads[field] = url;
        }
        if (Object.keys(uploads).length > 0) {
          await updateEmployee(employeeId, uploads as any);
        }
      }

      setModal(false);
      if (!editing) {
        Alert.alert('Success', `Employee created!\nUsername: ${payload.username || form.employeeId}\nPassword: ${form.password}`);
      }
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const pickDocument = async (field: EmployeeDocField) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'application/pdf'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      const asset = res.assets[0];
      const name = asset.name || 'document';
      if (asset.size && asset.size > 5 * 1024 * 1024) {
        Alert.alert('File too large', 'File size exceeds 5MB limit');
        return;
      }
      setDocFiles(prev => ({ ...prev, [field]: { uri: asset.uri, name, size: asset.size, mimeType: asset.mimeType } }));
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to pick document');
    }
  };

  const generateEmployeeId = async (companyId: string): Promise<string> => {
    const company = companies.find(c => c.id === companyId);
    const code = (company as any)?.code || '';
    const prefix = code ? `${code}-${new Date().getFullYear()}` : 'EMP';
    try {
      const emps = await getEmployeesByCompany(companyId);
      let maxNum = 0;
      emps.forEach(e => {
        const val = (e as any).employeeId as string | undefined;
        if (val) {
          const match = val.match(/(\d+)$/);
          if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
        }
      });
      return `${prefix}-${String(maxNum + 1).padStart(4, '0')}`;
    } catch {
      return `${prefix}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    }
  };

  const uploadEmployeeFile = async (file: DocFile, employeeId: string, field: string): Promise<string> => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageRef = ref(storage, `documents/${form.companyId}/${employeeId}/${field}_${Date.now()}_${safeName}`);
    const response = await fetch(file.uri);
    const blob = await response.blob();
    await uploadBytes(storageRef, blob, { contentType: file.mimeType || blob.type || 'application/octet-stream' });
    return getDownloadURL(storageRef);
  };

  const renderDocUpload = (field: EmployeeDocField, label: string) => {
    const file = docFiles[field];
    return (
      <View style={s.docField}>
        <Text style={s.fieldLabel}>{label}</Text>
        <TouchableOpacity style={s.docUploadBtn} onPress={() => pickDocument(field)}>
          <Icon name="cloud-upload-outline" size={18} color="#FF6600" />
          <Text style={s.docUploadBtnText} numberOfLines={1}>{file ? file.name : 'Upload JPG, PNG or PDF (max 5MB)'}</Text>
        </TouchableOpacity>
        {file ? <TouchableOpacity style={s.docRemoveBtn} onPress={() => setDocFiles(prev => ({ ...prev, [field]: undefined }))}><Text style={s.docRemoveText}>Remove</Text></TouchableOpacity> : null}
      </View>
    );
  };

  const toggleStatusFilter = (status: string) => {
    setFilterStatus(prev => prev === status ? '' : status);
  };

  const formatDate = (d: any) => {
    if (!d) return 'N/A';
    if (typeof d === 'string') return new Date(d).toLocaleDateString();
    if (d?.toDate) return d.toDate().toLocaleDateString();
    if (d?.seconds) return new Date(d.seconds * 1000).toLocaleDateString();
    return new Date(d).toLocaleDateString();
  };

  const getCompanyName = (id: string) => {
    return availableCompanies.find(c => c.id === id)?.name || companies.find(c => c.id === id)?.name || id || 'N/A';
  };

  const getManagerName = (emp: Employee) => {
    const mid = (emp as any).managerId;
    const mName = (emp as any).managerName;
    if (mName) return mName;
    if (!mid) return 'N/A';
    const found = employees.find(e => e.id === mid || e.userId === mid);
    return found?.name || 'N/A';
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Email,Employee ID,Designation,Department,Status,Employment Type,Role,Company,Join Date,Phone,Manager'];
      const rows = filtered.map(e => {
        const cName = getCompanyName(e.companyId || '');
        return `${e.name},${e.email},${e.employeeId || ''},${e.designation || ''},${e.department || ''},${e.status || ''},${e.employmentType || ''},${e.role || ''},${cName},${formatDate(e.joinDate)},${e.phone || ''},${getManagerName(e)}`;
      });
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'employees_export.csv');
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

  const sectionToggle = (label: string, open: boolean, setOpen: (v: boolean) => void) => (
    <TouchableOpacity style={s.sectionToggle} onPress={() => setOpen(!open)}>
      <Text style={s.sectionToggleText}>{label}</Text>
      <Icon name={open ? 'chevron-up-outline' : 'chevron-down-outline'} size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  return (
    <View style={s.container}>
      <ScreenHeader title="Employees" onBack={() => navigation.goBack()} />
      <View style={s.header}>
        <Text style={s.title}>Employees</Text>
        <Text style={s.count}>{filtered.length} total</Text>
      </View>

      <View style={s.statsRow}>
        {[
          { key: '', label: 'Total', value: stats.total, icon: 'people-outline', color: '#3b82f6' },
          { key: 'Active', label: 'Active', value: stats.active, icon: 'checkmark-circle-outline', color: '#10b981' },
          { key: 'Inactive', label: 'Inactive', value: stats.inactive, icon: 'close-circle-outline', color: '#ef4444' },
          { key: 'On Leave', label: 'On Leave', value: stats.onLeave, icon: 'umbrella-outline', color: '#FF6600' },
        ].map(card => (
          <TouchableOpacity key={card.key} style={[s.statCard, filterStatus === card.key && { borderColor: card.color, borderWidth: 2 }]} onPress={() => toggleStatusFilter(card.key)}>
            <View style={[s.statIcon, { backgroundColor: `${card.color}15` }]}>
              <Icon name={card.icon} size={16} color={card.color} />
            </View>
            <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{card.value}</Text>
            <Text style={s.statLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{card.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.searchRow}>
        <View style={s.searchInputWrap}>
          <Icon name="search-outline" size={18} color={colors.textTertiary} />
          <TextInput style={s.searchInput} placeholder="Search employees..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
        </View>
        <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
        <PermissionGate module="employees" action="create">
          <TouchableOpacity style={s.addBtn} onPress={openCreate}>
            <Icon name="add-outline" size={18} color="#fff" />
          </TouchableOpacity>
        </PermissionGate>
      </View>

      {showCompanyPicker && (
        <FilterChips
          options={companies.map(c => ({ label: c.name, value: c.id }))}
          selected={filterCompany}
          onSelect={setFilterCompany}
        />
      )}

      {loading ? (
        <Text style={s.emptyText}>Loading...</Text>
      ) : (
        <ScrollView style={{ flex: 1 }}>
          <View style={s.list}>
            {paginated.length === 0 ? (
              <Text style={s.emptyText}>{search || filterStatus || filterCompany ? 'No employees match your filters.' : 'No employees yet.'}</Text>
            ) : paginated.map(emp => (
              <View key={emp.id} style={s.card}>
                <View style={s.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.empName}>{emp.name}</Text>
                    <Text style={s.designation}>{emp.designation || emp.employeeId || 'N/A'} • {emp.role}</Text>
                  </View>
                  <View style={[s.badge, { backgroundColor: `${STATUS_COLORS[emp.status || 'Active']}20` }]}>
                    <Text style={[s.badgeText, { color: STATUS_COLORS[emp.status || 'Active'] }]}>{emp.status}</Text>
                  </View>
                </View>
                <Text style={s.deptText}>{emp.department || 'N/A'} • {emp.email}</Text>
                {emp.phone ? <Text style={s.phoneText}>{emp.phone}</Text> : null}
                <View style={s.cardActions}>
                  <TouchableOpacity style={s.viewBtn} onPress={() => openView(emp)}>
                    <Icon name="eye-outline" size={15} color="#64748b" />
                    <Text style={s.viewBtnText}>View</Text>
                  </TouchableOpacity>
                  <PermissionGate module="employees" action="edit">
                    <TouchableOpacity style={s.editBtn} onPress={() => openEdit(emp)}>
                      <Icon name="create-outline" size={15} color="#3b82f6" />
                      <Text style={s.editBtnText}>Edit</Text>
                    </TouchableOpacity>
                  </PermissionGate>
                  <PermissionGate module="employees" action="delete">
                    <TouchableOpacity style={s.delBtn} onPress={() => handleDelete(emp.id, emp.name)}>
                      <Icon name="trash-outline" size={15} color="#ef4444" />
                      <Text style={s.delBtnText}>Deact.</Text>
                    </TouchableOpacity>
                  </PermissionGate>
                </View>
              </View>
            ))}
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
                <Text style={s.modalTitle}>{editing ? 'Edit Employee' : 'Add Employee'}</Text>
                <TouchableOpacity onPress={() => setModal(false)}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>

              {/* Basic */}
              <TextInput style={s.input} placeholder="Full Name *" placeholderTextColor={colors.textTertiary} value={form.name} onChangeText={(t) => setForm({...form, name: t})} />
              <TextInput style={s.input} placeholder="Email *" placeholderTextColor={colors.textTertiary} value={form.email} onChangeText={(t) => setForm({...form, email: t})} keyboardType="email-address" autoCapitalize="none" />
              <TextInput style={s.input} placeholder="Phone" placeholderTextColor={colors.textTertiary} value={form.phone} onChangeText={(t) => setForm({...form, phone: t})} keyboardType="phone-pad" />
              <TextInput style={s.input} placeholder="Date of Birth (YYYY-MM-DD)" placeholderTextColor={colors.textTertiary} value={form.birthDate} onChangeText={(t) => setForm({...form, birthDate: t})} />

              {sectionToggle('Account Credentials', showAccount, setShowAccount)}
              {showAccount && (
                <>
                  <TextInput style={s.input} placeholder="Username" placeholderTextColor={colors.textTertiary} value={form.username} onChangeText={(t) => setForm({...form, username: t})} autoCapitalize="none" />
                  {!editing && <TextInput style={s.input} placeholder="Password *" placeholderTextColor={colors.textTertiary} value={form.password} onChangeText={(t) => setForm({...form, password: t})} secureTextEntry />}
                </>
              )}

              {sectionToggle('Organization', showOrg, setShowOrg)}
              {showOrg && (
                <>
                  <TextInput style={s.input} placeholder="Employee ID (auto if empty)" placeholderTextColor={colors.textTertiary} value={form.employeeId} onChangeText={(t) => setForm({...form, employeeId: t})} />
                  <TextInput style={s.input} placeholder="Designation" placeholderTextColor={colors.textTertiary} value={form.designation} onChangeText={(t) => setForm({...form, designation: t})} />

                  <Text style={s.fieldLabel}>Company *</Text>
                  {isMasterAdmin || isRestrictedScope ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                      {(isRestrictedScope && availableCompanies.length > 0 ? availableCompanies : companies).map(c => (
                        <TouchableOpacity key={c.id} style={[s.chip, form.companyId === c.id && s.chipActive]} onPress={() => {
                          setForm({...form, companyId: c.id, departmentId: '', department: '', departmentColor: '#f97316', managerId: '', managerName: ''});
                        }}>
                          <Text style={[s.chipText, form.companyId === c.id && { color: '#fff' }]}>{c.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  ) : (
                    <Text style={s.noOptionsText}>{form.companyId ? (companies.find(c => c.id === form.companyId)?.name || form.companyId) : 'No company assigned'}</Text>
                  )}

                  <Text style={s.fieldLabel}>Department</Text>
                  {departments.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                      <TouchableOpacity style={[s.chip, !form.departmentId && s.chipActive]} onPress={() => setForm({...form, departmentId: '', department: '', departmentColor: '#f97316'})}>
                        <Text style={[s.chipText, !form.departmentId && { color: '#fff' }]}>None</Text>
                      </TouchableOpacity>
                      {departments.map(d => (
                        <TouchableOpacity key={d.id} style={[s.chip, form.departmentId === d.id && s.chipActive]} onPress={() => setForm({...form, departmentId: d.id, department: d.name, departmentColor: d.color || '#f97316'})}>
                          <Text style={[s.chipText, form.departmentId === d.id && { color: '#fff' }]}>{d.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  ) : (
                    <Text style={s.noOptionsText}>{form.companyId ? 'No departments for this company' : 'Select a company first'}</Text>
                  )}

                  <Text style={s.fieldLabel}>Reporting Manager / Team Leader</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    <TouchableOpacity style={[s.chip, !form.managerId && s.chipActive]} onPress={() => setForm({...form, managerId: '', managerName: ''})}>
                      <Text style={[s.chipText, !form.managerId && { color: '#fff' }]}>None</Text>
                    </TouchableOpacity>
                    {allManagers.filter(m => !editing || (m.id !== editing && m.userId !== editing)).map(m => (
                      <TouchableOpacity key={m.id} style={[s.chip, form.managerId === m.id && s.chipActive]} onPress={() => setForm({...form, managerId: m.id, managerName: m.name})}>
                        <Text style={[s.chipText, form.managerId === m.id && { color: '#fff' }]}>{m.name} ({m.employeeId || m.role})</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  {form.role === 'reporting-manager' ? <Text style={s.noOptionsText}>N/A — Reporting Manager</Text> : null}

                  <Text style={s.fieldLabel}>Join Date (YYYY-MM-DD)</Text>
                  <TextInput style={s.input} placeholder="Join Date (YYYY-MM-DD)" placeholderTextColor={colors.textTertiary} value={form.joinDate} onChangeText={(t) => setForm({...form, joinDate: t})} />

                  <Text style={s.fieldLabel}>Employment Type</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    {EMPLOYMENT_TYPE_OPTIONS.map(et => (
                      <TouchableOpacity key={et} style={[s.chip, form.employmentType === et && s.chipActive]} onPress={() => setForm({...form, employmentType: et})}>
                        <Text style={[s.chipText, form.employmentType === et && { color: '#fff' }]}>{et}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={s.fieldLabel}>Role</Text>
                  <View style={s.optionRow}>
                    {ROLE_OPTIONS.map(r => (
                      <TouchableOpacity key={r.value} style={[s.option, form.role === r.value && s.optionActive]} onPress={() => setForm({...form, role: r.value})}>
                        <Text style={[s.optionText, form.role === r.value && { color: '#fff' }]}>{r.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={s.fieldLabel}>Status</Text>
                  <View style={s.optionRow}>
                    {STATUS_OPTIONS.map(s2 => (
                      <TouchableOpacity key={s2} style={[s.option, form.status === s2 && s.optionActive]} onPress={() => setForm({...form, status: s2})}>
                        <Text style={[s.optionText, form.status === s2 && { color: '#fff' }]}>{s2}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              {sectionToggle('Documents & Compliance (Aadhar, PAN, Joining Letter)', showDocs, setShowDocs)}
              {showDocs && (
                <>
                  <Text style={s.fieldLabel}>Aadhar Number</Text>
                  <TextInput style={s.input} placeholder="Aadhar Number" placeholderTextColor={colors.textTertiary} value={form.aadharNumber} onChangeText={(t) => setForm({...form, aadharNumber: t})} />
                  {renderDocUpload('aadharDoc', 'Aadhar Card')}
                  <Text style={s.fieldLabel}>PAN Number</Text>
                  <TextInput style={s.input} placeholder="PAN Number" placeholderTextColor={colors.textTertiary} value={form.panNumber} onChangeText={(t) => setForm({...form, panNumber: t})} />
                  {renderDocUpload('panDoc', 'PAN Card')}
                  {renderDocUpload('joiningLetterDoc', 'Company Joining Letter')}
                </>
              )}

              {sectionToggle('Bank Details', showBank, setShowBank)}
              {showBank && (
                <>
                  <TextInput style={s.input} placeholder="Bank Name" placeholderTextColor={colors.textTertiary} value={form.bankName} onChangeText={(t) => setForm({...form, bankName: t})} />
                  <TextInput style={s.input} placeholder="Account Holder Name" placeholderTextColor={colors.textTertiary} value={form.accountHolderName} onChangeText={(t) => setForm({...form, accountHolderName: t})} />
                  <TextInput style={s.input} placeholder="Account Number" placeholderTextColor={colors.textTertiary} value={form.accountNumber} onChangeText={(t) => setForm({...form, accountNumber: t})} keyboardType="number-pad" />
                  <TextInput style={s.input} placeholder="IFSC Code" placeholderTextColor={colors.textTertiary} value={form.ifscCode} onChangeText={(t) => setForm({...form, ifscCode: t})} />
                  <TextInput style={s.input} placeholder="PF Account Number" placeholderTextColor={colors.textTertiary} value={form.pfAccountNumber} onChangeText={(t) => setForm({...form, pfAccountNumber: t})} />
                  <TextInput style={s.input} placeholder="UAN Number" placeholderTextColor={colors.textTertiary} value={form.uanNumber} onChangeText={(t) => setForm({...form, uanNumber: t})} />
                  {renderDocUpload('offerLetterDoc', 'Offer Letter')}
                </>
              )}

              {sectionToggle('Compensation Details', showSalary, setShowSalary)}
              {showSalary && (
                <>
                  <Text style={s.fieldLabel}>Monthly Gross Salary</Text>
                  <TextInput style={s.input} placeholder="Monthly Gross Salary" placeholderTextColor={colors.textTertiary} value={form.monthlyGrossSalary} onChangeText={(t) => setForm({...form, monthlyGrossSalary: t})} keyboardType="decimal-pad" />
                  <TextInput style={s.input} placeholder="Salary Effective Date (YYYY-MM-DD)" placeholderTextColor={colors.textTertiary} value={form.salaryEffectiveDate} onChangeText={(t) => setForm({...form, salaryEffectiveDate: t})} />

                  <Text style={s.fieldLabel}>Salary Cycle</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    {['Monthly', 'Bi-weekly'].map(cycle => (
                      <TouchableOpacity key={cycle} style={[s.chip, form.salaryCycle === cycle && s.chipActive]} onPress={() => setForm({...form, salaryCycle: cycle})}>
                        <Text style={[s.chipText, form.salaryCycle === cycle && { color: '#fff' }]}>{cycle}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={s.fieldLabel}>Working Days / Month</Text>
                  <TextInput style={s.input} placeholder="Working Days / Month" placeholderTextColor={colors.textTertiary} value={form.workingDaysPerMonth} onChangeText={(t) => setForm({...form, workingDaysPerMonth: t})} keyboardType="number-pad" />
                  <Text style={s.fieldLabel}>Overtime Rate (x base)</Text>
                  <TextInput style={s.input} placeholder="Overtime Rate" placeholderTextColor={colors.textTertiary} value={form.overtimeRatePerHour} onChangeText={(t) => setForm({...form, overtimeRatePerHour: t})} keyboardType="decimal-pad" />

                  <Text style={s.fieldLabel}>Weekend Days</Text>
                  <View style={s.weekendRow}>
                    {WEEKDAY_OPTIONS.map((day, idx) => {
                      const selected = form.weekendDays.includes(idx);
                      return (
                        <TouchableOpacity key={day} style={[s.weekendChip, selected && s.weekendChipActive]} onPress={() => {
                          const next = selected ? form.weekendDays.filter(d => d !== idx) : [...form.weekendDays, idx];
                          setForm({...form, weekendDays: next});
                        }}>
                          <Text style={[s.weekendChipText, selected && { color: '#fff' }]}>{day}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              {sectionToggle('Emergency Contact', showEmergency, setShowEmergency)}
              {showEmergency && (
                <>
                  <TextInput style={s.input} placeholder="Emergency Contact Name" placeholderTextColor={colors.textTertiary} value={form.emergencyContactName} onChangeText={(t) => setForm({...form, emergencyContactName: t})} />
                  <TextInput style={s.input} placeholder="Emergency Contact Phone" placeholderTextColor={colors.textTertiary} value={form.emergencyContactPhone} onChangeText={(t) => setForm({...form, emergencyContactPhone: t})} keyboardType="phone-pad" />
                </>
              )}

              <TextInput style={[s.input, s.textArea]} placeholder="Address" placeholderTextColor={colors.textTertiary} value={form.address} onChangeText={(t) => setForm({...form, address: t})} multiline numberOfLines={2} />

              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                  <Text style={s.saveBtnText}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* View Modal */}
      <Modal visible={viewModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <ScrollView contentContainerStyle={s.modalScroll}>
            <View style={s.modal}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Employee Details</Text>
                <TouchableOpacity onPress={() => { setViewModal(false); setSelected(null); }}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>
              {selected && (
                <>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Basic Information</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Name</Text><Text style={s.detailValue}>{selected.name}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Email</Text><Text style={s.detailValue}>{selected.email}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Phone</Text><Text style={s.detailValue}>{selected.phone || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>DOB</Text><Text style={s.detailValue}>{formatDate((selected as any).birthDate)}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Employee ID</Text><Text style={s.detailValue}>{selected.employeeId || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Status</Text><Text style={[s.detailValue, { color: STATUS_COLORS[selected.status || 'Active'] || colors.text }]}>{selected.status || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Username</Text><Text style={s.detailValue}>{(selected as any).username || 'N/A'}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Organization</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Designation</Text><Text style={s.detailValue}>{selected.designation || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Department</Text><Text style={s.detailValue}>{selected.department || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Role</Text><Text style={s.detailValue}>{selected.role || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Employment Type</Text><Text style={s.detailValue}>{selected.employmentType || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Company</Text><Text style={s.detailValue}>{selected.companyId ? getCompanyName(selected.companyId) : 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Join Date</Text><Text style={s.detailValue}>{formatDate(selected.joinDate)}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Manager</Text><Text style={s.detailValue}>{getManagerName(selected)}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Bank Details</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Bank Name</Text><Text style={s.detailValue}>{(selected as any).bankName || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>A/C Holder</Text><Text style={s.detailValue}>{(selected as any).accountHolderName || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>A/C Number</Text><Text style={s.detailValue}>{(selected as any).accountNumber ? `••••${String((selected as any).accountNumber).slice(-4)}` : 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>IFSC</Text><Text style={s.detailValue}>{(selected as any).ifscCode || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>PF Account</Text><Text style={s.detailValue}>{(selected as any).pfAccountNumber || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>UAN</Text><Text style={s.detailValue}>{(selected as any).uanNumber || 'N/A'}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Salary</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Monthly Gross</Text><Text style={s.detailValue}>{(selected as any).monthlyGrossSalary ? `₹${(selected as any).monthlyGrossSalary}` : 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Effective Date</Text><Text style={s.detailValue}>{formatDate((selected as any).salaryEffectiveDate)}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Documents</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Aadhar</Text><Text style={s.detailValue}>{(selected as any).aadharNumber || ((selected as any).aadharDoc ? 'Uploaded' : 'N/A')}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>PAN</Text><Text style={s.detailValue}>{(selected as any).panNumber || ((selected as any).panDoc ? 'Uploaded' : 'N/A')}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Emergency Contact</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Name</Text><Text style={s.detailValue}>{(selected as any).emergencyContactName || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Phone</Text><Text style={s.detailValue}>{(selected as any).emergencyContactPhone || 'N/A'}</Text></View>
                  </View>
                  {(selected as any).address ? (
                    <View style={s.detailSection}>
                      <Text style={s.detailSectionTitle}>Address</Text>
                      <Text style={s.descText}>{(selected as any).address}</Text>
                    </View>
                  ) : null}
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
  header: { padding: 20, paddingBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontSize: 24, fontWeight: 'bold', color: c.text },
  count: { color: c.textSecondary, fontSize: 14 },
  statsRow: { paddingHorizontal: 16, marginBottom: 10, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  statCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 8, width: '31%', alignItems: 'center', justifyContent: 'center', height: 95 },
  statIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '700', color: c.text },
  statLabel: { fontSize: 11, color: c.textSecondary, marginTop: 2, textAlign: 'center' },
  searchRow: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInputWrap: { flex: 1, minWidth: 0, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  addBtn: { backgroundColor: '#FF6600', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  list: {},
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 16, marginHorizontal: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  empName: { fontSize: 16, fontWeight: '600', color: c.text },
  designation: { color: '#FF6600', fontSize: 13, marginTop: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  deptText: { color: c.textSecondary, fontSize: 13, marginBottom: 2 },
  phoneText: { color: c.textTertiary, fontSize: 12 },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderTopWidth: 1, borderTopColor: c.borderLight, paddingTop: 10, marginTop: 8 },
  viewBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#64748b15', paddingHorizontal: 10, paddingVertical: 7 },
  viewBtnText: { color: '#64748b', fontWeight: '600', fontSize: 12 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#3b82f615', paddingHorizontal: 10, paddingVertical: 7 },
  editBtnText: { color: '#3b82f6', fontWeight: '600', fontSize: 12 },
  delBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#ef444415', paddingHorizontal: 10, paddingVertical: 7 },
  delBtnText: { color: '#ef4444', fontWeight: '600', fontSize: 12 },
  paginationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 16 },
  pageBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageBtnDisabled: { opacity: 0.3 },
  pageInfo: { color: c.text, fontSize: 14, fontWeight: '600', minWidth: 60, textAlign: 'center' },
  pageSizeText: { color: c.textSecondary, fontSize: 12, marginLeft: 8 },
  pageSizeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  pageSizeBtnText: { color: c.text, fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: c.modalOverlay, justifyContent: 'center' },
  modalScroll: { padding: 20 },
  modal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 16, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, color: c.text, fontSize: 15, marginBottom: 12 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  fieldLabel: { color: c.textSecondary, fontSize: 14, marginBottom: 8, fontWeight: '600' },
  optionRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  option: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center' },
  optionActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  optionText: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, backgroundColor: '#F3F4F6' },
  chipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  chipText: { color: '#1F2937', fontSize: 13, fontWeight: '600' },
  sectionToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginBottom: 8, borderTopWidth: 1, borderTopColor: c.borderLight },
  sectionToggleText: { color: c.text, fontSize: 15, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center' },
  cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#FF6600', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  detailSection: { marginBottom: 20 },
  detailSectionTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: c.borderLight, paddingBottom: 6 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.borderLight },
  detailLabel: { fontSize: 13, color: c.textTertiary, flex: 1 },
  detailValue: { fontSize: 14, color: c.text, fontWeight: '500', flex: 1, textAlign: 'right' },
  descText: { color: c.textSecondary, fontSize: 14, lineHeight: 20 },
  noOptionsText: { color: c.textTertiary, fontSize: 13, marginBottom: 12 },
  docField: { marginBottom: 12 },
  docUploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#FF6600', borderStyle: 'dashed', borderRadius: 10, padding: 12, backgroundColor: c.accentBg },
  docUploadBtnText: { color: c.text, fontSize: 13, flex: 1 },
  docRemoveBtn: { alignSelf: 'flex-start', marginTop: 6 },
  docRemoveText: { color: c.danger, fontSize: 13, fontWeight: '600' },
  weekendRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 },
  weekendChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F3F4F6' },
  weekendChipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  weekendChipText: { color: '#1F2937', fontSize: 13, fontWeight: '600' },
});
