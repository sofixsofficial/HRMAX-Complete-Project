import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Modal, Alert, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, updateDoc, setDoc, getDocs, getDoc, query, where, onSnapshot } from '../../aws/firestore-compat';
import { createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail } from '../../aws/auth-compat';
import { ref, uploadBytes, getDownloadURL } from '../../aws/storage-compat';
import { db, auth, storage, functions } from '../../aws/clients';
import { httpsCallable } from '../../aws/functions-compat';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { FilterChips } from '../../components/FilterChips';
import { PermissionMatrix, PermissionMatrixColumn } from '../../components/PermissionMatrix';
import { ScreenHeader } from '../../components/ScreenHeader';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { validatePasswordPolicy } from '../../utils/passwordPolicy';
import { notifyExecutiveChanged } from '../../services/notificationService';
import type { User } from '../../types/user';

const EMPLOYMENT_TYPE_OPTIONS = ['Full-time', 'Part-time', 'Contract', 'Intern'] as const;
const STATUS_OPTIONS = ['Active', 'Inactive', 'On Leave'] as const;

const ACCEPTED_DOC_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const ACCEPTED_DOC_EXTS = ['jpg', 'jpeg', 'png', 'pdf'];
const MAX_DOC_SIZE = 5 * 1024 * 1024;

interface ExecForm {
  name: string; email: string; username: string; password: string; phone: string;
  executiveTitle: string; companyId: string; departmentId: string; departmentName: string;
  assignedCompanyIds: string[]; assignedTeamLeaderIds: string[];
  employmentType: string; status: string; joinDate: string;
  aadharNumber: string; aadharDoc: string; aadharDocName: string;
  panNumber: string; panDoc: string; panDocName: string;
  joiningLetterDoc: string; joiningLetterDocName: string;
  bankName: string; accountHolderName: string; accountNumber: string; ifscCode: string;
  pfAccountNumber: string; uanNumber: string; offerLetterDoc: string; offerLetterDocName: string;
  address: string; emergencyContactName: string; emergencyContactPhone: string;
  monthlyGrossSalary: string; salaryEffectiveDate: string;
}

const emptyForm: ExecForm = {
  name: '', email: '', username: '', password: '', phone: '',
  executiveTitle: '', companyId: '', departmentId: '', departmentName: '',
  assignedCompanyIds: [], assignedTeamLeaderIds: [],
  employmentType: 'Full-time', status: 'Active', joinDate: '',
  aadharNumber: '', aadharDoc: '', aadharDocName: '',
  panNumber: '', panDoc: '', panDocName: '',
  joiningLetterDoc: '', joiningLetterDocName: '',
  bankName: '', accountHolderName: '', accountNumber: '', ifscCode: '',
  pfAccountNumber: '', uanNumber: '', offerLetterDoc: '', offerLetterDocName: '',
  address: '', emergencyContactName: '', emergencyContactPhone: '',
  monthlyGrossSalary: '0', salaryEffectiveDate: '',
};

const PERMISSION_MODULES = [
  { module: 'Employees', actions: ['view', 'create', 'edit', 'delete'] },
  { module: 'Attendance', actions: ['view', 'manage', 'approve', 'reject'] },
  { module: 'Leave', actions: ['view', 'approve', 'create', 'reject', 'cancel'] },
  { module: 'Payroll', actions: ['view', 'manage', 'calculate', 'create', 'disburse', 'approve'] },
  { module: 'Salary', actions: ['view', 'manage', 'create', 'edit', 'delete', 'approve', 'export'] },
  { module: 'Tasks', actions: ['view', 'manage'] },
  { module: 'Support', actions: ['view', 'create', 'delete', 'manage'] },
  { module: 'Holidays', actions: ['view', 'manage', 'create', 'edit', 'delete', 'export'] },
  { module: 'Announcements', actions: ['view', 'create', 'edit', 'delete'] },
  { module: 'Reports', actions: ['view', 'export', 'download'] },
  { module: 'Settings', actions: ['view', 'manage'] },
  { module: 'Companies', actions: ['view', 'manage'] },
  { module: 'Departments', actions: ['view', 'add', 'edit', 'delete'] },
  { module: 'Assets', actions: ['view', 'create', 'edit', 'delete', 'approve', 'manage'] },
];

const getPermissionKey = (module: string, action: string) => `${module.toLowerCase().replace(/\s+/g, '_')}.${action}`;
const ALL_PERMISSIONS = PERMISSION_MODULES.flatMap(g => g.actions.map(a => getPermissionKey(g.module, a)));

const MATRIX_COLUMNS: PermissionMatrixColumn[] = [
  { key: 'view', label: 'View', desc: 'Read-only access' },
  { key: 'create', label: 'Create', desc: 'Add new entries' },
  { key: 'edit', label: 'Edit', desc: 'Update records' },
  { key: 'delete', label: 'Delete', desc: 'Remove entries' },
  { key: 'approve', label: 'Approve', desc: 'Authorize' },
  { key: 'reject', label: 'Reject', desc: 'Decline requests' },
  { key: 'cancel', label: 'Cancel', desc: 'Withdraw requests' },
  { key: 'calculate', label: 'Calculate', desc: 'Run calculations' },
  { key: 'disburse', label: 'Disburse', desc: 'Release payouts' },
  { key: 'export', label: 'Export', desc: 'Download data' },
  { key: 'download', label: 'Download', desc: 'Save reports' },
  { key: 'manage', label: 'Manage', desc: 'Full control' },
];

const templatePerms = (modules: string[], extra: string[], excludeDelete = false) => {
  const perms: string[] = [];
  for (const g of PERMISSION_MODULES) {
    if (!modules.includes(g.module)) continue;
    for (const a of g.actions) {
      if (excludeDelete && a === 'delete') continue;
      perms.push(getPermissionKey(g.module, a));
    }
  }
  return [...perms, ...extra];
};

const TEMPLATES: Record<string, { label: string; desc: string; perms: string[] | null }> = {
  'full-access': {
    label: 'Full Access',
    desc: 'All modules, all actions',
    perms: ALL_PERMISSIONS,
  },
  'hr-manager': {
    label: 'HR Manager',
    desc: 'Employee, attendance, leave, payroll, holidays',
    perms: templatePerms(
      ['Employees', 'Attendance', 'Leave', 'Payroll', 'Salary', 'Holidays', 'Reports'],
      ['settings.view', 'companies.view']
    ),
  },
  'team-leader': {
    label: 'Team Leader',
    desc: 'Employee view, attendance, leaves, tasks',
    perms: templatePerms(
      ['Employees', 'Attendance', 'Leave', 'Tasks', 'Holidays', 'Reports'],
      ['settings.view', 'companies.view'],
      true
    ),
  },
  'custom': {
    label: 'Custom',
    desc: 'Manually toggle individual permissions',
    perms: null,
  },
};

export const ExecutivesScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user: authUser, hasPermission } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const [executives, setExecutives] = useState<User[]>([]);
  const [masterAdmins, setMasterAdmins] = useState<User[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [allTeamLeaders, setAllTeamLeaders] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [modal, setModal] = useState(false);
  const [viewModal, setViewModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<ExecForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [permissions, setPermissions] = useState<string[]>(ALL_PERMISSIONS);
  const [showEmp, setShowEmp] = useState(true);
  const [showBank, setShowBank] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showComp, setShowComp] = useState(false);
  const [showPerms, setShowPerms] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [resettingPw, setResettingPw] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);
  const { width: screenWidth } = useWindowDimensions();
  const isWide = screenWidth >= 480;

  const isMasterAdmin = authUser?.role === 'master-admin';
  const isRestrictedScope = authUser?.role === 'executive' || authUser?.role === 'team-leader';
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(authUser?.role, effectiveCompanyId, availableCompanies),
    [authUser?.role, effectiveCompanyId, availableCompanies]
  );

  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'executive'));
    const unsubExec = onSnapshot(q, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as User));
      const scoped = isRestrictedScope && scopeIds.length > 0
        ? all.filter(e => {
            const ids: string[] = (e as any).assignedCompanyIds || [];
            return ids.some(id => scopeIds.includes(id));
          })
        : all;
      setExecutives(scoped);
      setLoading(false);
    }, () => setLoading(false));

    getDocs(collection(db, 'companies')).then(snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setCompanies(isRestrictedScope && scopeIds.length > 0 ? all.filter(c => scopeIds.includes(c.id)) : all);
    });
    getDocs(collection(db, 'departments')).then(snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
      setDepartments(isRestrictedScope && scopeIds.length > 0 ? all.filter((d: any) => scopeIds.includes(d.companyId)) : all);
    });
    const qTL = query(collection(db, 'users'), where('role', '==', 'team-leader'));
    const unsubTL = onSnapshot(qTL, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as User));
      const scoped = isRestrictedScope && scopeIds.length > 0
        ? all.filter(tl => {
            const ids: string[] = (tl as any).assignedCompanyIds || [];
            return ids.some(id => scopeIds.includes(id));
          })
        : all;
      setAllTeamLeaders(scoped);
    }, () => {});

    const qMA = query(collection(db, 'users'), where('role', '==', 'master-admin'));
    const unsubMA = onSnapshot(qMA, (snap) => setMasterAdmins(snap.docs.map(d => ({ id: d.id, ...d.data() } as User))), () => {});

    return () => { unsubExec(); unsubTL(); unsubMA(); };
  }, [scopeIds, isRestrictedScope]);

  const filtered = useMemo(() => {
    return executives.filter(e => {
      if (companyFilter && e.companyId !== companyFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.name?.toLowerCase().includes(q) && !e.email?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [executives, search, companyFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, companyFilter]);

  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || id;

  const openCreate = () => {
    if (!hasPermission('executives.create')) {
      Alert.alert('Access denied', 'You do not have permission to create executives');
      return;
    }
    setEditing(null);
    setForm(emptyForm);
    setPermissions(ALL_PERMISSIONS);
    setShowEmp(true); setShowBank(false); setShowContact(false); setShowComp(false); setShowPerms(false); setShowAssign(false);
    setModal(true);
  };

  const openEdit = (exec: User) => {
    if (!hasPermission('executives.edit')) {
      Alert.alert('Access denied', 'You do not have permission to edit executives');
      return;
    }
    setEditing(exec.id);
    setForm({
      name: exec.name || '', email: exec.email || '', username: (exec as any).username || '', password: '',
      phone: (exec as any).phone || '',
      executiveTitle: (exec as any).executiveTitle || '',
      companyId: exec.companyId || '',
      departmentId: (exec as any).departmentId || '',
      departmentName: (exec as any).department || '',
      assignedCompanyIds: (exec as any).assignedCompanyIds || [],
      assignedTeamLeaderIds: (exec as any).assignedTeamLeaderIds || [],
      employmentType: (exec as any).employmentType || 'Full-time',
      status: (exec as any).status || 'Active',
      joinDate: (exec as any).joinDate || '',
      aadharNumber: (exec as any).aadharNumber || '',
      aadharDoc: (exec as any).aadharDoc || '',
      aadharDocName: (exec as any).aadharDoc ? 'Uploaded' : '',
      panNumber: (exec as any).panNumber || '',
      panDoc: (exec as any).panDoc || '',
      panDocName: (exec as any).panDoc ? 'Uploaded' : '',
      joiningLetterDoc: (exec as any).joiningLetterDoc || '',
      joiningLetterDocName: (exec as any).joiningLetterDoc ? 'Uploaded' : '',
      bankName: (exec as any).bankName || '',
      accountHolderName: (exec as any).accountHolderName || '',
      accountNumber: (exec as any).accountNumber || '',
      ifscCode: (exec as any).ifscCode || '',
      pfAccountNumber: (exec as any).pfAccountNumber || '',
      uanNumber: (exec as any).uanNumber || '',
      offerLetterDoc: (exec as any).offerLetterDoc || '',
      offerLetterDocName: (exec as any).offerLetterDoc ? 'Uploaded' : '',
      address: (exec as any).address || '',
      emergencyContactName: (exec as any).emergencyContactName || '',
      emergencyContactPhone: (exec as any).emergencyContactPhone || '',
      monthlyGrossSalary: String((exec as any).monthlyGrossSalary || 0),
      salaryEffectiveDate: (exec as any).salaryEffectiveDate || '',
    });
    setPermissions((exec as any).permissions || ALL_PERMISSIONS);
    setShowEmp(true); setShowBank(false); setShowContact(false); setShowComp(false); setShowPerms(false); setShowAssign(false);
    setModal(true);
  };

  const openView = (exec: User) => { setSelected(exec); setViewModal(true); };
  const openDelete = (exec: User) => {
    if (!hasPermission('executives.delete')) {
      Alert.alert('Access denied', 'You do not have permission to delete executives');
      return;
    }
    setSelected(exec); setDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      const assignedCompanies: string[] = (selected as any).assignedCompanyIds || [];
      const assignedTLs: string[] = (selected as any).assignedTeamLeaderIds || [];
      if (assignedCompanies.length > 0) {
        await Promise.all(assignedCompanies.map(cId =>
          updateDoc(doc(db, 'companies', cId), { assignedExecutiveId: null, assignedExecutiveName: null })
        ));
      }
      if (assignedTLs.length > 0) {
        await Promise.all(assignedTLs.map(tlId =>
          updateDoc(doc(db, 'users', tlId), { reportingExecutiveId: null, reportingExecutiveName: null })
        ));
      }
      await updateDoc(doc(db, 'users', selected.id), { isActive: false, status: 'Inactive' });
      notifyExecutiveChanged('deactivated', selected.name || '', (selected as any).companyId || null, masterAdmins.map(m => m.id), selected.id);
      setDeleteModal(false);
      setSelected(null);
    } catch { Alert.alert('Error', 'Failed to deactivate executive'); }
  };

  const toggleCompany = (id: string) => {
    setForm(prev => ({
      ...prev,
      assignedCompanyIds: prev.assignedCompanyIds.includes(id)
        ? prev.assignedCompanyIds.filter(c => c !== id)
        : [...prev.assignedCompanyIds, id],
    }));
  };

  const toggleTL = (id: string) => {
    setForm(prev => ({
      ...prev,
      assignedTeamLeaderIds: prev.assignedTeamLeaderIds.includes(id)
        ? prev.assignedTeamLeaderIds.filter(t => t !== id)
        : [...prev.assignedTeamLeaderIds, id],
    }));
  };

  const togglePermission = (key: string) => {
    setPermissions(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]);
  };

  const applyTemplate = (key: string) => {
    const tpl = TEMPLATES[key];
    if (tpl && tpl.perms) { setPermissions(tpl.perms); return; }
    if (key === 'custom') setPermissions([]);
  };

  const toggleModule = (module: string, actions: readonly string[]) => {
    const perms = actions.map(a => getPermissionKey(module, a));
    const allChecked = perms.every(p => permissions.includes(p));
    setPermissions(allChecked ? permissions.filter(p => !perms.includes(p)) : [...new Set([...permissions, ...perms])]);
  };

  const selectAllPerms = () => setPermissions(ALL_PERMISSIONS);
  const clearAllPerms = () => setPermissions([]);

  const pickDocument = async (field: keyof ExecForm, nameField: keyof ExecForm) => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ACCEPTED_DOC_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const asset = res.assets[0];
      const mime = (asset.mimeType || '').toLowerCase();
      const ext = (asset.name || '').toLowerCase().split('.').pop() || '';
      if (!ACCEPTED_DOC_TYPES.includes(mime) && !ACCEPTED_DOC_EXTS.includes(ext)) {
        Alert.alert('Invalid file', 'Only JPG, PNG, and PDF files are supported.');
        return;
      }
      if (asset.size && asset.size > MAX_DOC_SIZE) {
        Alert.alert('File too large', 'File size exceeds 5MB limit.');
        return;
      }
      setForm(f => ({ ...f, [field]: asset.uri, [nameField]: asset.name }));
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not pick file');
    }
  };

  const removeDocument = (field: keyof ExecForm, nameField: keyof ExecForm) => {
    setForm(f => ({ ...f, [field]: '', [nameField]: '' }));
  };

  const uploadExecDoc = async (uid: string, field: string, file: { uri: string; name: string }) => {
    const safeName = (file.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
    const sRef = ref(storage, `executives/${uid}/${field}/${Date.now()}_${safeName}`);
    const response = await fetch(file.uri);
    const blob = await response.blob();
    await uploadBytes(sRef, blob, { contentType: 'application/octet-stream' });
    return getDownloadURL(sRef);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) { Alert.alert('Validation', 'Name and email are required'); return; }
    setSaving(true);
    try {
      const docFields: [keyof ExecForm, keyof ExecForm, string][] = [
        ['aadharDoc', 'aadharDocName', 'aadharDoc'],
        ['panDoc', 'panDocName', 'panDoc'],
        ['joiningLetterDoc', 'joiningLetterDocName', 'joiningLetterDoc'],
        ['offerLetterDoc', 'offerLetterDocName', 'offerLetterDoc'],
      ];
      const uploaded: Record<string, string> = {};

      if (editing) {
        const current = executives.find(e => e.id === editing);
        const prevCompanyIds: string[] = current ? ((current as any).assignedCompanyIds || []) : [];
        const prevTLIds: string[] = current ? ((current as any).assignedTeamLeaderIds || []) : [];
        const newCompanyIds = form.assignedCompanyIds;
        const newTLIds = form.assignedTeamLeaderIds;

        const removedCompanies = prevCompanyIds.filter(id => !newCompanyIds.includes(id));
        if (removedCompanies.length > 0) {
          await Promise.all(removedCompanies.map(cId =>
            updateDoc(doc(db, 'companies', cId), { assignedExecutiveId: null, assignedExecutiveName: null })
          ));
        }
        const addedCompanies = newCompanyIds.filter(id => !prevCompanyIds.includes(id));
        if (addedCompanies.length > 0) {
          await Promise.all(addedCompanies.map(cId =>
            updateDoc(doc(db, 'companies', cId), { assignedExecutiveId: editing, assignedExecutiveName: form.name })
          ));
        }

        const removedTLs = prevTLIds.filter(id => !newTLIds.includes(id));
        const addedTLs = newTLIds.filter(id => !prevTLIds.includes(id));

        // Keep each team leader's authoritative `linkedExecutiveIds` array in sync.
        // Dashboards/filters read `linkedExecutiveIds` to derive a TL's portfolio,
        // so assigning an executive to a TL must append the executive there too.
        const syncLinkedExec = async (tlId: string, op: 'add' | 'remove') => {
          const tlSnap = await getDoc(doc(db, 'users', tlId));
          const current: string[] = (tlSnap.exists() && (tlSnap.data() as any).linkedExecutiveIds) || [];
          const next = op === 'add'
            ? (current.includes(editing) ? current : [...current, editing])
            : current.filter((x: string) => x !== editing);
          await updateDoc(doc(db, 'users', tlId), { linkedExecutiveIds: next });
        };

        if (removedTLs.length > 0) {
          await Promise.all(removedTLs.map(async (tlId) => {
            await updateDoc(doc(db, 'users', tlId), { reportingExecutiveId: null, reportingExecutiveName: null });
            await syncLinkedExec(tlId, 'remove');
          }));
        }
        if (addedTLs.length > 0) {
          await Promise.all(addedTLs.map(async (tlId) => {
            await updateDoc(doc(db, 'users', tlId), { reportingExecutiveId: editing, reportingExecutiveName: form.name });
            await syncLinkedExec(tlId, 'add');
          }));
        }

        const payload: any = {
          name: form.name, email: form.email,
          phone: form.phone, executiveTitle: form.executiveTitle,
          companyId: form.companyId, department: form.departmentName,
          departmentId: form.departmentId,
          assignedCompanyIds: form.assignedCompanyIds,
          assignedTeamLeaderIds: form.assignedTeamLeaderIds,
          employmentType: form.employmentType, status: form.status,
          joinDate: form.joinDate,
          aadharNumber: form.aadharNumber, panNumber: form.panNumber,
          bankName: form.bankName, accountHolderName: form.accountHolderName,
          accountNumber: form.accountNumber, ifscCode: form.ifscCode,
          pfAccountNumber: form.pfAccountNumber, uanNumber: form.uanNumber,
          address: form.address,
          emergencyContactName: form.emergencyContactName,
          emergencyContactPhone: form.emergencyContactPhone,
          monthlyGrossSalary: Number(form.monthlyGrossSalary) || 0,
          salaryEffectiveDate: form.salaryEffectiveDate,
          ...(authUser?.role === 'master-admin' ? { permissions, permissionsConfigured: true } : {}),
        };
        await updateDoc(doc(db, 'users', editing), payload);

        for (const [field, nameField, storageField] of docFields) {
          const uri = form[field] as string;
          const name = form[nameField] as string;
          if (uri && !uri.startsWith('https://')) {
            uploaded[storageField] = await uploadExecDoc(editing, storageField, { uri, name: name || storageField });
          }
        }
        if (Object.keys(uploaded).length > 0) {
          await updateDoc(doc(db, 'users', editing), uploaded);
        }
        notifyExecutiveChanged('updated', form.name, form.companyId, masterAdmins.map(m => m.id), editing || undefined);
        setModal(false);
      } else {
        if (!form.username.trim() || form.username.trim().length < 3) {
          Alert.alert('Validation', 'System username must be at least 3 characters');
          setSaving(false);
          return;
        }
        if (!form.password || !validatePasswordPolicy(form.password).valid) {
          const policy = validatePasswordPolicy(form.password || '');
          Alert.alert('Password does not meet the requirements', policy.errors[0] || 'Password does not meet the requirements.');
          setSaving(false);
          return;
        }
        const createStaffUser = httpsCallable(functions, 'createStaffUser');
        const { data: fnResult } = await createStaffUser({
          email: form.email,
          password: form.password,
          name: form.name,
          username: form.username.trim(),
          phone: form.phone || '',
          role: 'executive',
          companyId: form.companyId || undefined,
          departmentId: form.departmentId || undefined,
          departmentName: form.departmentName || '',
          executiveTitle: form.executiveTitle || '',
          assignedCompanyIds: form.assignedCompanyIds,
          assignedTeamLeaderIds: form.assignedTeamLeaderIds,
          designation: '',
          employmentType: form.employmentType || 'Full-time',
          status: form.status || 'Active',
          joinDate: form.joinDate || '',
          aadharNumber: form.aadharNumber || '',
          panNumber: form.panNumber || '',
          bankName: form.bankName || '',
          accountHolderName: form.accountHolderName || '',
          accountNumber: form.accountNumber || '',
          ifscCode: form.ifscCode || '',
          pfAccountNumber: form.pfAccountNumber || '',
          uanNumber: form.uanNumber || '',
          address: form.address || '',
          emergencyContactName: form.emergencyContactName || '',
          emergencyContactPhone: form.emergencyContactPhone || '',
          monthlyGrossSalary: Number(form.monthlyGrossSalary) || 0,
          salaryEffectiveDate: form.salaryEffectiveDate || '',
        } as any);
        const uid = (fnResult as any).uid as string;

        for (const [field, nameField, storageField] of docFields) {
          const uri = form[field] as string;
          const name = form[nameField] as string;
          if (uri && !uri.startsWith('https://')) {
            uploaded[storageField] = await uploadExecDoc(uid, storageField, { uri, name: name || storageField });
          }
        }
        if (Object.keys(uploaded).length > 0) {
          await updateDoc(doc(db, 'users', uid), uploaded);
        }

        notifyExecutiveChanged('created', form.name, form.companyId, masterAdmins.map(m => m.id), uid);
        setModal(false);
      }
    } catch (err: any) {
      const code = err.code || '';
      if (code === 'auth/email-already-in-use') Alert.alert('Error', 'This email is already registered. Please use a different email.');
      else if (code === 'auth/weak-password') Alert.alert('Error', 'Password must be at least 8 characters with upper, lower, number and symbol.');
      else if (code === 'auth/invalid-email') Alert.alert('Error', 'The email address is not valid.');
      else Alert.alert('Error', err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const confirmResetKey = (exec: User) => {
    Alert.alert('Reset Key / Password', `Send a password reset email to ${exec.email}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Send', onPress: async () => {
        try {
          await sendPasswordResetEmail(auth, exec.email);
          Alert.alert('Success', `Password reset email sent to ${exec.email}`);
        } catch (err: any) {
          Alert.alert('Error', err.message || 'Failed to send reset email');
        }
      }},
    ]);
  };

  const handleResetPassword = async () => {
    if (!selected) return;
    setResettingPw(true);
    try {
      await sendPasswordResetEmail(auth, selected.email);
      Alert.alert('Success', `Password reset email sent to ${selected.email}`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send reset email');
    } finally {
      setResettingPw(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Name,Email,Title,Company,Status,Employment Type,TLs Assigned,Companies Assigned'];
      const rows = filtered.map(e => {
        const tlNames = (e as any).assignedTeamLeaderIds?.map((id: string) => allTeamLeaders.find(tl => tl.id === id)?.name || id).join('; ') || '';
        const coNames = (e as any).assignedCompanyIds?.map((id: string) => getCompanyName(id)).join('; ') || '';
        return `${e.name},${e.email},${(e as any).executiveTitle || ''},${getCompanyName(e.companyId || '')},${(e as any).status || 'Active'},${(e as any).employmentType || ''},${tlNames},${coNames}`;
      });
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'executives_export.csv');
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
      <ScreenHeader title="Executives" onBack={() => navigation.goBack()} />
      <View style={s.header}>
        <Text style={s.title}>Executives</Text>
        <Text style={s.count}>{filtered.length} total</Text>
      </View>

      <View style={s.statsRow}>
        {[
          { label: 'Total Executives', value: executives.length, icon: 'briefcase-outline', color: '#FF6600' },
          { label: 'Companies Assigned', value: companies.filter(c => (c as any).assignedExecutiveId).length, icon: 'business-outline', color: '#3b82f6' },
          { label: 'Team Leaders Reporting', value: allTeamLeaders.filter(tl => (tl as any).reportingExecutiveId).length, icon: 'people-outline', color: '#8b5cf6' },
        ].map(card => (
          <View key={card.label} style={s.statCard}>
            <View style={[s.statIcon, { backgroundColor: `${card.color}15` }]}>
              <Icon name={card.icon} size={16} color={card.color} />
            </View>
            <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{card.value}</Text>
            <Text style={s.statLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{card.label}</Text>
          </View>
        ))}
      </View>

      <View style={s.searchRow}>
        <View style={s.searchInputWrap}>
          <Icon name="search-outline" size={18} color={colors.textTertiary} />
          <TextInput style={s.searchInput} placeholder="Search executives..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
        </View>
        <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
        {hasPermission('executives.create') && (
        <TouchableOpacity style={s.addBtn} onPress={openCreate}>
          <Icon name="add-outline" size={18} color="#fff" />
          {isWide ? <Text style={s.addBtnText}>Add Executive</Text> : null}
        </TouchableOpacity>
        )}
      </View>

      <FilterChips
        options={companies.map(c => ({ label: c.name, value: c.id }))}
        selected={companyFilter}
        allLabel="All Companies"
        onSelect={setCompanyFilter}
      />

      {loading ? (
        <Text style={s.emptyText}>Loading...</Text>
      ) : (
        <ScrollView style={{ flex: 1 }}>
          <View style={s.list}>
            {paginated.length === 0 ? (
              <Text style={s.emptyText}>{search || companyFilter ? 'No executives match your filters.' : 'No executives yet.'}</Text>
            ) : paginated.map(exec => {
              const compIds: string[] = (exec as any).assignedCompanyIds || [];
              const tlIds: string[] = (exec as any).assignedTeamLeaderIds || [];
              const compNames = compIds.map((id: string) => getCompanyName(id)).filter(Boolean);
              const tlNames = tlIds.map((id: string) => allTeamLeaders.find(tl => tl.id === id)?.name || id).filter(Boolean);
              const MAX_VISIBLE = 3;
              const active = (exec as any).status === 'Active' || (exec as any).status === undefined;
              return (
                <View key={exec.id} style={s.card}>
                  <View style={s.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.empName}>{exec.name}</Text>
                      <Text style={s.roleText}>{(exec as any).executiveTitle || 'Executive'}</Text>
                      <Text style={s.emailText}>{exec.email}</Text>
                    </View>
                    <View style={[s.badge, { backgroundColor: active ? '#10b98120' : '#ef444420' }]}>
                      <Text style={[s.badgeText, { color: active ? '#10b981' : '#ef4444' }]}>{(exec as any).status || 'Active'}</Text>
                    </View>
                  </View>

                  {compNames.length > 0 ? (
                    <View style={s.tagBlock}>
                      <Text style={s.tagLabel}>Companies Managed</Text>
                      <View style={s.tagRow}>
                        {compNames.slice(0, MAX_VISIBLE).map(n => (
                          <Text key={n} style={[s.tag, s.tagCompany]}>{n}</Text>
                        ))}
                        {compNames.length > MAX_VISIBLE && <Text style={[s.tag, s.tagMore]}>+{compNames.length - MAX_VISIBLE}</Text>}
                      </View>
                    </View>
                  ) : null}

                  {tlNames.length > 0 ? (
                    <View style={s.tagBlock}>
                      <Text style={s.tagLabel}>Team Leaders Managed</Text>
                      <View style={s.tagRow}>
                        {tlNames.slice(0, MAX_VISIBLE).map(n => (
                          <Text key={n} style={[s.tag, s.tagTL]}>{n}</Text>
                        ))}
                        {tlNames.length > MAX_VISIBLE && <Text style={[s.tag, s.tagMore]}>+{tlNames.length - MAX_VISIBLE}</Text>}
                      </View>
                    </View>
                  ) : null}

                  <View style={s.detailRow}>
                    <Text style={s.detailLabel}>Department: {(exec as any).department || (exec as any).departmentName || 'Unassigned'}</Text>
                  </View>

                  <View style={s.cardActions}>
                    <TouchableOpacity style={s.viewBtn} onPress={() => openView(exec)}>
                      <Icon name="eye-outline" size={15} color="#64748b" />
                      <Text style={s.viewBtnText}>View</Text>
                    </TouchableOpacity>
                    {hasPermission('executives.edit') && (
                    <TouchableOpacity style={s.editBtn} onPress={() => openEdit(exec)}>
                      <Icon name="create-outline" size={15} color="#3b82f6" />
                      <Text style={s.editBtnText}>Edit</Text>
                    </TouchableOpacity>
                    )}
                    {authUser?.role === 'master-admin' && (
                    <TouchableOpacity style={s.resetKeyBtn} onPress={() => confirmResetKey(exec)}>
                      <Icon name="key-outline" size={15} color="#d97706" />
                      <Text style={s.resetKeyBtnText}>Reset Key</Text>
                    </TouchableOpacity>
                    )}
                    {hasPermission('executives.delete') && (
                    <TouchableOpacity style={s.delBtn} onPress={() => openDelete(exec)}>
                      <Icon name="trash-outline" size={15} color="#ef4444" />
                      <Text style={s.delBtnText}>Deact.</Text>
                    </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
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
                <Text style={s.modalTitle}>{editing ? 'Edit Executive' : 'Add Executive'}</Text>
                <TouchableOpacity onPress={() => setModal(false)}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>

              <Text style={s.formSectionTitle}>Personal Information</Text>
              <Text style={s.fieldLabel}>Full Name *</Text>
              <TextInput style={s.input} placeholder="Full Name" placeholderTextColor={colors.textTertiary} value={form.name} onChangeText={(t) => setForm({...form, name: t})} />
              <Text style={s.fieldLabel}>Corporate Email *</Text>
              <TextInput style={s.input} placeholder="executive@company.com" placeholderTextColor={colors.textTertiary} value={form.email} onChangeText={(t) => setForm({...form, email: t})} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
              <Text style={s.fieldLabel}>Phone Number</Text>
              <TextInput style={s.input} placeholder="+91 98765 43210" placeholderTextColor={colors.textTertiary} value={form.phone} onChangeText={(t) => setForm({...form, phone: t})} keyboardType="phone-pad" />

              <Text style={s.formSectionTitle}>Account Credentials</Text>
              {!editing && (
                <>
                  <Text style={s.fieldLabel}>System Username *</Text>
                  <TextInput style={s.input} placeholder="your_username" placeholderTextColor={colors.textTertiary} value={form.username} onChangeText={(t) => setForm({...form, username: t})} autoCapitalize="none" autoCorrect={false} />
                  <Text style={s.fieldLabel}>Temporary Password *</Text>
                  <TextInput style={s.input} placeholder="Min 8 chars (upper+lower+number+symbol)" placeholderTextColor={colors.textTertiary} value={form.password} onChangeText={(t) => setForm({...form, password: t})} />
                </>
              )}

              <Text style={s.formSectionTitle}>Position Details</Text>
              <Text style={s.fieldLabel}>Executive Role / Title</Text>
              <TextInput style={s.input} placeholder="e.g. Vice President, Managing Director" placeholderTextColor={colors.textTertiary} value={form.executiveTitle} onChangeText={(t) => setForm({...form, executiveTitle: t})} />
              <Text style={s.fieldLabel}>Department Linkage</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <TouchableOpacity style={[s.chip, !form.departmentId && s.chipActive]} onPress={() => setForm({...form, departmentId: '', departmentName: ''})}>
                  <Text style={[s.chipText, !form.departmentId && { color: '#fff' }]}>Select Department</Text>
                </TouchableOpacity>
                {departments.filter(d => !form.companyId || !d.companyId || d.companyId === form.companyId).map(d => (
                  <TouchableOpacity key={d.id} style={[s.chip, form.departmentId === d.id && s.chipActive]} onPress={() => setForm({...form, departmentId: d.id, departmentName: d.name})}>
                    <Text style={[s.chipText, form.departmentId === d.id && { color: '#fff' }]}>{d.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {sectionToggle('Employment & Compliance Details', showEmp, setShowEmp)}
              {showEmp && (
                <>
                  <Text style={s.fieldLabel}>Employment Type</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    {EMPLOYMENT_TYPE_OPTIONS.map(et => (
                      <TouchableOpacity key={et} style={[s.chip, form.employmentType === et && s.chipActive]} onPress={() => setForm({...form, employmentType: et})}>
                        <Text style={[s.chipText, form.employmentType === et && { color: '#fff' }]}>{et}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <Text style={s.fieldLabel}>Status</Text>
                  <View style={s.optionRow}>
                    {STATUS_OPTIONS.map(st => (
                      <TouchableOpacity key={st} style={[s.option, form.status === st && s.optionActive]} onPress={() => setForm({...form, status: st})}>
                        <Text style={[s.optionText, form.status === st && { color: '#fff' }]}>{st}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={s.fieldLabel}>Join Date</Text>
                  <TextInput style={s.input} placeholder="YYYY-MM-DD" placeholderTextColor={colors.textTertiary} value={form.joinDate} onChangeText={(t) => setForm({...form, joinDate: t})} />
                  <Text style={s.fieldLabel}>Aadhaar Number</Text>
                  <TextInput style={s.input} placeholder="12-digit Aadhaar number" placeholderTextColor={colors.textTertiary} value={form.aadharNumber} onChangeText={(t) => setForm({...form, aadharNumber: t})} maxLength={12} keyboardType="number-pad" />
                  <DocumentUploadField
                    label="Aadhaar Card Upload"
                    fileName={form.aadharDocName}
                    onPick={() => pickDocument('aadharDoc', 'aadharDocName')}
                    onRemove={() => removeDocument('aadharDoc', 'aadharDocName')}
                  />
                  <Text style={s.fieldLabel}>PAN Number</Text>
                  <TextInput style={s.input} placeholder="e.g. ABCDE1234F" placeholderTextColor={colors.textTertiary} value={form.panNumber} onChangeText={(t) => setForm({...form, panNumber: t.toUpperCase()})} maxLength={10} autoCapitalize="characters" />
                  <DocumentUploadField
                    label="PAN Card Upload"
                    fileName={form.panDocName}
                    onPick={() => pickDocument('panDoc', 'panDocName')}
                    onRemove={() => removeDocument('panDoc', 'panDocName')}
                  />
                  <DocumentUploadField
                    label="Company Joining Letter"
                    fileName={form.joiningLetterDocName}
                    onPick={() => pickDocument('joiningLetterDoc', 'joiningLetterDocName')}
                    onRemove={() => removeDocument('joiningLetterDoc', 'joiningLetterDocName')}
                  />
                </>
              )}

              {sectionToggle('Bank & Statutory Details', showBank, setShowBank)}
              {showBank && (
                <>
                  <TextInput style={s.input} placeholder="Bank Name" placeholderTextColor={colors.textTertiary} value={form.bankName} onChangeText={(t) => setForm({...form, bankName: t})} />
                  <TextInput style={s.input} placeholder="Account Holder Name" placeholderTextColor={colors.textTertiary} value={form.accountHolderName} onChangeText={(t) => setForm({...form, accountHolderName: t})} />
                  <TextInput style={s.input} placeholder="Account Number" placeholderTextColor={colors.textTertiary} value={form.accountNumber} onChangeText={(t) => setForm({...form, accountNumber: t})} keyboardType="number-pad" />
                  <TextInput style={s.input} placeholder="IFSC Code" placeholderTextColor={colors.textTertiary} value={form.ifscCode} onChangeText={(t) => setForm({...form, ifscCode: t.toUpperCase()})} autoCapitalize="characters" />
                  <TextInput style={s.input} placeholder="PF Account Number" placeholderTextColor={colors.textTertiary} value={form.pfAccountNumber} onChangeText={(t) => setForm({...form, pfAccountNumber: t})} />
                  <TextInput style={s.input} placeholder="UAN Number" placeholderTextColor={colors.textTertiary} value={form.uanNumber} onChangeText={(t) => setForm({...form, uanNumber: t})} />
                  <DocumentUploadField
                    label="Offer Letter"
                    fileName={form.offerLetterDocName}
                    onPick={() => pickDocument('offerLetterDoc', 'offerLetterDocName')}
                    onRemove={() => removeDocument('offerLetterDoc', 'offerLetterDocName')}
                  />
                </>
              )}

              {sectionToggle('Contact Information', showContact, setShowContact)}
              {showContact && (
                <>
                  <TextInput style={[s.input, s.textArea]} placeholder="Address" placeholderTextColor={colors.textTertiary} value={form.address} onChangeText={(t) => setForm({...form, address: t})} multiline numberOfLines={2} />
                  <TextInput style={s.input} placeholder="Emergency Contact Name" placeholderTextColor={colors.textTertiary} value={form.emergencyContactName} onChangeText={(t) => setForm({...form, emergencyContactName: t})} />
                  <TextInput style={s.input} placeholder="Emergency Contact Phone" placeholderTextColor={colors.textTertiary} value={form.emergencyContactPhone} onChangeText={(t) => setForm({...form, emergencyContactPhone: t})} keyboardType="phone-pad" />
                </>
              )}

              {sectionToggle('Compensation Details', showComp, setShowComp)}
              {showComp && (
                <>
                  <TextInput style={s.input} placeholder="Monthly Gross Salary" placeholderTextColor={colors.textTertiary} value={form.monthlyGrossSalary} onChangeText={(t) => setForm({...form, monthlyGrossSalary: t})} keyboardType="decimal-pad" />
                  <TextInput style={s.input} placeholder="Salary Effective Date (YYYY-MM-DD)" placeholderTextColor={colors.textTertiary} value={form.salaryEffectiveDate} onChangeText={(t) => setForm({...form, salaryEffectiveDate: t})} />
                </>
              )}

              {sectionToggle('Hierarchy Assignment', showAssign, setShowAssign)}
              {showAssign && (
                <>
                  <Text style={s.fieldLabel}>Primary Company</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    <TouchableOpacity style={[s.chip, !form.companyId && s.chipActive]} onPress={() => setForm({...form, companyId: ''})}>
                      <Text style={[s.chipText, !form.companyId && { color: '#fff' }]}>None</Text>
                    </TouchableOpacity>
                    {companies.map(c => (
                      <TouchableOpacity key={c.id} style={[s.chip, form.companyId === c.id && s.chipActive]} onPress={() => setForm({...form, companyId: c.id})}>
                        <Text style={[s.chipText, form.companyId === c.id && { color: '#fff' }]}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={s.fieldLabel}>Assign Companies (manage)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                    {companies.filter(c => c.id !== form.companyId).map(c => {
                      const selected = form.assignedCompanyIds.includes(c.id);
                      return (
                        <TouchableOpacity key={c.id} style={[s.chip, selected && s.chipActive]} onPress={() => toggleCompany(c.id)}>
                          <Text style={[s.chipText, selected && { color: '#fff' }]}>{c.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <Text style={s.fieldLabel}>Assign Team Leaders (reporting to)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                    {allTeamLeaders.filter(tl => tl.isActive !== false).map(tl => {
                      const selected = form.assignedTeamLeaderIds.includes(tl.id);
                      return (
                        <TouchableOpacity key={tl.id} style={[s.chip, selected && s.chipActive]} onPress={() => toggleTL(tl.id)}>
                          <Text style={[s.chipText, selected && { color: '#fff' }]}>{tl.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </>
              )}

              {authUser?.role === 'master-admin' && sectionToggle('Access Permissions', showPerms, setShowPerms)}
              {authUser?.role === 'master-admin' && showPerms && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={s.fieldLabel}>Quick-Start Templates</Text>
                  <View style={s.templateRow}>
                    {Object.entries(TEMPLATES).map(([key, tpl]) => {
                      const active = tpl.perms !== null && permissions.length === tpl.perms.length && tpl.perms.every(p => permissions.includes(p));
                      return (
                        <TouchableOpacity
                          key={key}
                          style={[s.templateChip, active && s.templateChipActive]}
                          onPress={() => applyTemplate(key)}
                        >
                          <Text style={[s.templateChipText, active && { color: '#fff' }]}>{tpl.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <View style={s.permToolbar}>
                    <Text style={s.permCount}>{permissions.length} of {ALL_PERMISSIONS.length} selected</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity style={s.permToolBtn} onPress={selectAllPerms}><Text style={s.permToolBtnText}>Select All</Text></TouchableOpacity>
                      <TouchableOpacity style={s.permToolBtn} onPress={clearAllPerms}><Text style={s.permToolBtnText}>Clear All</Text></TouchableOpacity>
                    </View>
                  </View>
                  <PermissionMatrix
                    columns={MATRIX_COLUMNS}
                    modules={PERMISSION_MODULES}
                    permissions={permissions}
                    onToggle={togglePermission}
                    onToggleModule={toggleModule}
                    accentColor="#FF6600"
                    getActionKey={(module, columnKey) => {
                      const g = PERMISSION_MODULES.find(x => x.module === module);
                      if (!g) return null;
                      if (columnKey === 'create' && g.actions.includes('add')) return 'add';
                      return g.actions.includes(columnKey) ? columnKey : null;
                    }}
                  />
                </View>
              )}

              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                  <Text style={s.saveBtnText}>{saving ? 'Saving...' : editing ? 'Save Changes' : 'Save Executive'}</Text>
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
                <Text style={s.modalTitle}>Executive Details</Text>
                <TouchableOpacity onPress={() => { setViewModal(false); setSelected(null); }}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>
              {selected && (
                <>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Basic Information</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Name</Text><Text style={s.detailValue}>{selected.name}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Email</Text><Text style={s.detailValue}>{selected.email}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Title</Text><Text style={s.detailValue}>{(selected as any).executiveTitle || 'Executive'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Phone</Text><Text style={s.detailValue}>{(selected as any).phone || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Status</Text><Text style={[s.detailValue, { color: (selected as any).status === 'Active' || !(selected as any).status ? '#10b981' : '#ef4444' }]}>{(selected as any).status || 'Active'}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Organization</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Primary Company</Text><Text style={s.detailValue}>{getCompanyName(selected.companyId || '') || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Department</Text><Text style={s.detailValue}>{(selected as any).department || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Employment Type</Text><Text style={s.detailValue}>{(selected as any).employmentType || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Join Date</Text><Text style={s.detailValue}>{(selected as any).joinDate || 'N/A'}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Assigned Companies</Text>
                    <Text style={s.detailValue}>{(selected as any).assignedCompanyIds?.length ? (selected as any).assignedCompanyIds.map((id: string) => getCompanyName(id)).join(', ') : 'None'}</Text>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Assigned Team Leaders</Text>
                    <Text style={s.detailValue}>{(selected as any).assignedTeamLeaderIds?.length ? (selected as any).assignedTeamLeaderIds.map((id: string) => allTeamLeaders.find(tl => tl.id === id)?.name || id).join(', ') : 'None'}</Text>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Bank & Compensation</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Bank</Text><Text style={s.detailValue}>{(selected as any).bankName || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>A/C No.</Text><Text style={s.detailValue}>{(selected as any).accountNumber ? `••••${String((selected as any).accountNumber).slice(-4)}` : 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Gross Salary</Text><Text style={s.detailValue}>{(selected as any).monthlyGrossSalary ? `₹${(selected as any).monthlyGrossSalary}` : 'N/A'}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Documents</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Aadhar</Text><Text style={s.detailValue}>{(selected as any).aadharNumber || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>PAN</Text><Text style={s.detailValue}>{(selected as any).panNumber || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>PF/UAN</Text><Text style={s.detailValue}>{(selected as any).pfAccountNumber || 'N/A'} / {(selected as any).uanNumber || 'N/A'}</Text></View>
                  </View>
                  <View style={s.modalActions}>
                    <TouchableOpacity style={s.resetPwBtn} onPress={handleResetPassword} disabled={resettingPw}>
                      <Text style={s.resetPwBtnText}>{resettingPw ? 'Sending...' : 'Reset Password'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.cancelBtn} onPress={() => { setViewModal(false); setSelected(null); }}><Text style={s.cancelBtnText}>Close</Text></TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Delete Modal */}
      <Modal visible={deleteModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalSmall}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Deactivate Executive</Text>
              <TouchableOpacity onPress={() => setDeleteModal(false)}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
            </View>
            {selected && (
              <>
                <Icon name="alert-circle-outline" size={48} color="#ef4444" style={{ alignSelf: 'center', marginBottom: 12 }} />
                <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
                  Deactivate <Text style={{ fontWeight: 'bold' }}>{selected.name}</Text>? They will lose system access.
                </Text>
                <View style={s.modalActions}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setDeleteModal(false)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={s.deleteConfirmBtn} onPress={handleDelete}><Text style={s.deleteConfirmBtnText}>Deactivate</Text></TouchableOpacity>
                </View>
              </>
            )}
          </View>
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
  statsRow: { paddingHorizontal: 16, marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  statCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 8, width: '31%', alignItems: 'center', justifyContent: 'center', height: 95 },
  statIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '700', color: c.text },
  statLabel: { fontSize: 11, color: c.textSecondary, marginTop: 2, textAlign: 'center' },
  searchRow: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInputWrap: { flex: 1, minWidth: 0, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  addBtn: { backgroundColor: '#FF6600', borderRadius: 12, height: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, flexShrink: 0, minWidth: 44 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  list: {},
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 16, marginHorizontal: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  empName: { fontSize: 16, fontWeight: '600', color: c.text },
  roleText: { color: '#FF6600', fontSize: 13, marginTop: 2 },
  emailText: { color: c.textSecondary, fontSize: 12, marginTop: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  tagBlock: { marginTop: 8 },
  tagLabel: { fontSize: 11, color: c.textTertiary, textTransform: 'uppercase', fontWeight: '700', marginBottom: 4 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, fontSize: 11, fontWeight: '600', overflow: 'hidden' },
  tagCompany: { backgroundColor: '#eff6ff', color: '#2563eb' },
  tagTL: { backgroundColor: '#fef3c7', color: '#d97706' },
  tagMore: { backgroundColor: '#f1f5f9', color: '#64748b' },
  cardActions: { flexDirection: 'row', gap: 6, borderTopWidth: 1, borderTopColor: c.borderLight, paddingTop: 10, marginTop: 10, flexWrap: 'wrap' },
  viewBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#64748b15', paddingHorizontal: 10, paddingVertical: 7 },
  viewBtnText: { color: '#64748b', fontWeight: '600', fontSize: 12 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#3b82f615', paddingHorizontal: 10, paddingVertical: 7 },
  editBtnText: { color: '#3b82f6', fontWeight: '600', fontSize: 12 },
  resetKeyBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#fef3c7', paddingHorizontal: 10, paddingVertical: 7 },
  resetKeyBtnText: { color: '#d97706', fontWeight: '600', fontSize: 12 },
  delBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#ef444415', paddingHorizontal: 10, paddingVertical: 7 },
  delBtnText: { color: '#ef4444', fontWeight: '600', fontSize: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: { fontSize: 13, color: c.textSecondary, flex: 1 },
  detailValue: { fontSize: 13, color: c.text, flex: 1, textAlign: 'right' },
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
  modalSmall: { backgroundColor: c.card, padding: 24, marginHorizontal: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, color: c.text, fontSize: 15, marginBottom: 12 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  fieldLabel: { color: c.textSecondary, fontSize: 14, marginBottom: 8, fontWeight: '600' },
  formSectionTitle: { fontSize: 17, fontWeight: '700', color: c.text, marginTop: 18, marginBottom: 12, borderTopWidth: 1, borderTopColor: c.borderLight, paddingTop: 14 },
  optionRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  option: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center' },
  optionActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  optionText: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, backgroundColor: '#F3F4F6' },
  chipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  chipText: { color: '#1F2937', fontSize: 13, fontWeight: '600' },
  templateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  templateChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.card },
  templateChipActive: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  templateChipText: { color: c.textSecondary, fontSize: 13, fontWeight: '600' },
  permToolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  permCount: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
  permToolBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, backgroundColor: c.background },
  permToolBtnText: { color: c.textSecondary, fontSize: 12, fontWeight: '600' },
  uploadWrap: { marginBottom: 12 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#3b82f6', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#3b82f610' },
  uploadBtnText: { color: '#3b82f6', fontSize: 13, fontWeight: '600', flex: 1 },
  uploadHint: { color: c.textTertiary, fontSize: 11, marginTop: 6 },
  uploadRemove: { color: '#ef4444', fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'right' },
  sectionToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginBottom: 8, borderTopWidth: 1, borderTopColor: c.borderLight },
  sectionToggleText: { color: c.text, fontSize: 15, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center' },
  cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#FF6600', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  resetPwBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#6366f1', alignItems: 'center' },
  resetPwBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  deleteConfirmBtn: { flex: 1, backgroundColor: '#ef4444', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  deleteConfirmBtnText: { color: '#fff', fontWeight: 'bold' },
  detailSection: { marginBottom: 20 },
  detailSectionTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: c.borderLight, paddingBottom: 6 },
});

const DocumentUploadField: React.FC<{
  label: string;
  fileName: string;
  onPick: () => void;
  onRemove: () => void;
}> = ({ label, fileName, onPick, onRemove }) => {
  const { colors } = useTheme();
  const st = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={st.uploadWrap}>
      <Text style={st.fieldLabel}>{label}</Text>
      <TouchableOpacity style={st.uploadBtn} onPress={onPick}>
        <Icon name="attach-outline" size={18} color="#3b82f6" />
        <Text style={st.uploadBtnText} numberOfLines={1}>{fileName || 'Choose file'}</Text>
      </TouchableOpacity>
      <Text style={st.uploadHint}>JPG, PNG, PDF • Max 5MB</Text>
      {fileName ? (
        <TouchableOpacity onPress={onRemove}>
          <Text style={st.uploadRemove}>Remove</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};
