import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Modal, Alert, Switch, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, setDoc, updateDoc, getDocs, query, where, onSnapshot } from '../../aws/firestore-compat';
import { createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail } from '../../aws/auth-compat';
import { ref, uploadBytes, getDownloadURL } from '../../aws/storage-compat';
import { auth, db, storage, functions } from '../../aws/clients';
import { httpsCallable } from '../../aws/functions-compat';
import { Paths, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { FilterChips } from '../../components/FilterChips';
import { ScreenHeader } from '../../components/ScreenHeader';
import { notifyTeamLeaderCreated, notifyTeamLeaderUpdated, notifyTeamLeaderDeactivated } from '../../services/notificationService';
import type { User } from '../../types/user';

const EMPLOYMENT_TYPE_OPTIONS = ['Full-time', 'Part-time', 'Contract', 'Intern'] as const;
const STATUS_OPTIONS = ['Active', 'Inactive', 'On Leave'] as const;

const ACCEPTED_DOC_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const ACCEPTED_DOC_EXTS = ['jpg', 'jpeg', 'png', 'pdf'];
const MAX_DOC_SIZE = 5 * 1024 * 1024;

interface TLForm {
  name: string; email: string; username: string; password: string; phone: string;
  companyId: string; executiveIds: string[];
  designation: string; departmentId: string; departmentName: string;
  employmentType: string; status: string; joinDate: string;
  aadharNumber: string; aadharDoc: string; aadharDocName: string;
  panNumber: string; panDoc: string; panDocName: string;
  joiningLetterDoc: string; joiningLetterDocName: string;
  bankName: string; accountHolderName: string; accountNumber: string; ifscCode: string;
  pfAccountNumber: string; uanNumber: string; offerLetterDoc: string; offerLetterDocName: string;
  address: string; emergencyContactName: string; emergencyContactPhone: string;
  monthlyGrossSalary: string; salaryEffectiveDate: string;
}

const emptyForm: TLForm = {
  name: '', email: '', username: '', password: '', phone: '',
  companyId: '', executiveIds: [],
  designation: '', departmentId: '', departmentName: '',
  employmentType: 'Full-time', status: 'Active', joinDate: '',
  aadharNumber: '', aadharDoc: '', aadharDocName: '',
  panNumber: '', panDoc: '', panDocName: '',
  joiningLetterDoc: '', joiningLetterDocName: '',
  bankName: '', accountHolderName: '', accountNumber: '', ifscCode: '',
  pfAccountNumber: '', uanNumber: '', offerLetterDoc: '', offerLetterDocName: '',
  address: '', emergencyContactName: '', emergencyContactPhone: '',
  monthlyGrossSalary: '0', salaryEffectiveDate: '',
};

export const TeamLeadersScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user: authUser } = useAuth();
  const [teamLeaders, setTeamLeaders] = useState<User[]>([]);
  const [executives, setExecutives] = useState<User[]>([]);
  const [masterAdmins, setMasterAdmins] = useState<User[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [execFilter, setExecFilter] = useState('');
  const [modal, setModal] = useState(false);
  const [viewModal, setViewModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<TLForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showEmp, setShowEmp] = useState(true);
  const [showBank, setShowBank] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showComp, setShowComp] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [contingency, setContingency] = useState(false);
  const [resettingPw, setResettingPw] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);
  const { width: screenWidth } = useWindowDimensions();
  const isWide = screenWidth >= 480;

  useEffect(() => {
    const qTL = query(collection(db, 'users'), where('role', '==', 'team-leader'));
    const unsubTL = onSnapshot(qTL, (snap) => {
      setTeamLeaders(snap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
      setLoading(false);
    }, () => setLoading(false));

    const qEx = query(collection(db, 'users'), where('role', '==', 'executive'));
    const unsubEx = onSnapshot(qEx, (snap) => setExecutives(snap.docs.map(d => ({ id: d.id, ...d.data() } as User))), () => {});

    const qMA = query(collection(db, 'users'), where('role', '==', 'master-admin'));
    const unsubMA = onSnapshot(qMA, (snap) => setMasterAdmins(snap.docs.map(d => ({ id: d.id, ...d.data() } as User))), () => {});

    getDocs(collection(db, 'companies')).then(snap => setCompanies(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    getDocs(collection(db, 'departments')).then(snap => setDepartments(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

    return () => { unsubTL(); unsubEx(); unsubMA(); };
  }, []);

  const filtered = useMemo(() => {
    return teamLeaders.filter(tl => {
      if (execFilter) {
        const linkedIds: string[] = (tl as any).linkedExecutiveIds || ((tl as any).reportingExecutiveId ? [(tl as any).reportingExecutiveId] : []);
        if (!linkedIds.includes(execFilter)) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!tl.name?.toLowerCase().includes(q) && !tl.email?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [teamLeaders, search, execFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, execFilter]);

  const execOptions = useMemo(() => executives.filter(e => e.isActive), [executives]);
  const getCompanyName = (id: string) => companies.find(c => c.id === id)?.name || id;
  const getExecName = (id: string) => executives.find(e => e.id === id)?.name || id;

  const getDerivedCompany = (tl: User) => {
    const linkedExecIds: string[] = (tl as any).linkedExecutiveIds || ((tl as any).reportingExecutiveId ? [(tl as any).reportingExecutiveId] : []);
    if (linkedExecIds.length > 0) {
      const exec = executives.find(e => e.id === linkedExecIds[0]);
      if (exec?.companyId) return getCompanyName(exec.companyId);
    }
    if (tl.companyId) return getCompanyName(tl.companyId);
    return 'Unassigned';
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setContingency(false);
    setShowEmp(true); setShowBank(false); setShowContact(false); setShowComp(false); setShowAssign(false);
    setModal(true);
  };

  const openEdit = (tl: User) => {
    setEditing(tl.id);
    const linkedIds: string[] = (tl as any).linkedExecutiveIds || ((tl as any).reportingExecutiveId ? [(tl as any).reportingExecutiveId] : []);
    setForm({
      name: tl.name || '', email: tl.email || '', username: (tl as any).username || '', password: '',
      phone: (tl as any).phone || '', companyId: tl.companyId || '',
      executiveIds: linkedIds,
      designation: (tl as any).designation || '',
      departmentId: (tl as any).departmentId || '',
      departmentName: (tl as any).department || '',
      employmentType: (tl as any).employmentType || 'Full-time',
      status: (tl as any).status || 'Active',
      joinDate: (tl as any).joinDate || '',
      aadharNumber: (tl as any).aadharNumber || '',
      aadharDoc: (tl as any).aadharDoc || '',
      aadharDocName: (tl as any).aadharDoc ? 'Uploaded' : '',
      panNumber: (tl as any).panNumber || '',
      panDoc: (tl as any).panDoc || '',
      panDocName: (tl as any).panDoc ? 'Uploaded' : '',
      joiningLetterDoc: (tl as any).joiningLetterDoc || '',
      joiningLetterDocName: (tl as any).joiningLetterDoc ? 'Uploaded' : '',
      bankName: (tl as any).bankName || '', accountHolderName: (tl as any).accountHolderName || '',
      accountNumber: (tl as any).accountNumber || '', ifscCode: (tl as any).ifscCode || '',
      pfAccountNumber: (tl as any).pfAccountNumber || '', uanNumber: (tl as any).uanNumber || '',
      offerLetterDoc: (tl as any).offerLetterDoc || '',
      offerLetterDocName: (tl as any).offerLetterDoc ? 'Uploaded' : '',
      address: (tl as any).address || '',
      emergencyContactName: (tl as any).emergencyContactName || '',
      emergencyContactPhone: (tl as any).emergencyContactPhone || '',
      monthlyGrossSalary: String((tl as any).monthlyGrossSalary || 0),
      salaryEffectiveDate: (tl as any).salaryEffectiveDate || '',
    });
    setContingency(!!(tl as any).contingencyAccess);
    setShowEmp(true); setShowBank(false); setShowContact(false); setShowComp(false); setShowAssign(false);
    setModal(true);
  };

  const openView = (tl: User) => { setSelected(tl); setViewModal(true); };
  const openDelete = (tl: User) => { setSelected(tl); setDeleteModal(true); };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      const linkedIds: string[] = (selected as any).linkedExecutiveIds || ((selected as any).reportingExecutiveId ? [(selected as any).reportingExecutiveId] : []);
      for (const execId of linkedIds) {
        const exec = executives.find(e => e.id === execId);
        if (exec) {
          const updatedTLs = ((exec as any).assignedTeamLeaderIds || []).filter((id: string) => id !== selected.id);
          await updateDoc(doc(db, 'users', execId), { assignedTeamLeaderIds: updatedTLs });
        }
      }
      await updateDoc(doc(db, 'users', selected.id), { isActive: false, status: 'Inactive' });
      notifyTeamLeaderDeactivated(selected.name || '', (selected as any).companyId || null, linkedIds, masterAdmins.map(m => m.id));
      setDeleteModal(false);
      setSelected(null);
    } catch { Alert.alert('Error', 'Failed to deactivate team leader'); }
  };

  const toggleExec = (id: string) => {
    setForm(prev => ({
      ...prev,
      executiveIds: prev.executiveIds.includes(id)
        ? prev.executiveIds.filter(e => e !== id)
        : [...prev.executiveIds, id],
    }));
  };

  const toggleContingency = (tl: User) => {
    const next = !(tl as any).contingencyAccess;
    Alert.alert('Contingency Access', `${next ? 'Enable' : 'Disable'} contingency access for ${tl.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: next ? 'Enable' : 'Disable', onPress: async () => {
        try {
          await updateDoc(doc(db, 'users', tl.id), { contingencyAccess: next });
        } catch { Alert.alert('Error', 'Failed to update contingency access'); }
      }},
    ]);
  };

  const pickDocument = async (field: keyof TLForm, nameField: keyof TLForm) => {
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

  const removeDocument = (field: keyof TLForm, nameField: keyof TLForm) => {
    setForm(f => ({ ...f, [field]: '', [nameField]: '' }));
  };

  const uploadTLDoc = async (uid: string, field: string, file: { uri: string; name: string }) => {
    const safeName = (file.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
    const sRef = ref(storage, `team-leaders/${uid}/${field}/${Date.now()}_${safeName}`);
    const response = await fetch(file.uri);
    const blob = await response.blob();
    await uploadBytes(sRef, blob, { contentType: 'application/octet-stream' });
    return getDownloadURL(sRef);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) { Alert.alert('Validation', 'Name and email are required'); return; }
    setSaving(true);
    try {
      const docFields: [keyof TLForm, keyof TLForm, string][] = [
        ['aadharDoc', 'aadharDocName', 'aadharDoc'],
        ['panDoc', 'panDocName', 'panDoc'],
        ['joiningLetterDoc', 'joiningLetterDocName', 'joiningLetterDoc'],
        ['offerLetterDoc', 'offerLetterDocName', 'offerLetterDoc'],
      ];
      const uploaded: Record<string, string> = {};

      const basePayload: any = {
        name: form.name, email: form.email, username: form.username.trim(),
        phone: form.phone, companyId: form.companyId,
        linkedExecutiveIds: form.executiveIds,
        reportingExecutiveId: form.executiveIds[0] || null,
        reportingExecutiveName: form.executiveIds[0] ? getExecName(form.executiveIds[0]) : null,
        designation: form.designation, department: form.departmentName,
        departmentId: form.departmentId,
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
        contingencyAccess: contingency,
      };

      if (editing) {
        const current = teamLeaders.find(t => t.id === editing);
        const prevLinkedIds: string[] = current ? ((current as any).linkedExecutiveIds || ((current as any).reportingExecutiveId ? [(current as any).reportingExecutiveId] : [])) : [];
        const newIds = form.executiveIds;
        const toRemove = prevLinkedIds.filter(id => !newIds.includes(id));
        const toAdd = newIds.filter(id => !prevLinkedIds.includes(id));

        for (const execId of toRemove) {
          const exec = executives.find(e => e.id === execId);
          if (exec) {
            const updatedTLs = ((exec as any).assignedTeamLeaderIds || []).filter((id: string) => id !== editing);
            await updateDoc(doc(db, 'users', execId), { assignedTeamLeaderIds: updatedTLs });
          }
        }
        for (const execId of toAdd) {
          const exec = executives.find(e => e.id === execId);
          if (exec) {
            const currentTLs = (exec as any).assignedTeamLeaderIds || [];
            if (!currentTLs.includes(editing)) {
              await updateDoc(doc(db, 'users', execId), { assignedTeamLeaderIds: [...currentTLs, editing] });
            }
          }
        }

        await updateDoc(doc(db, 'users', editing), { ...basePayload, username: (current as any)?.username || basePayload.username });

        for (const [field, nameField, storageField] of docFields) {
          const uri = form[field] as string;
          const name = form[nameField] as string;
          if (uri && !uri.startsWith('https://')) {
            uploaded[storageField] = await uploadTLDoc(editing, storageField, { uri, name: name || storageField });
          }
        }
        if (Object.keys(uploaded).length > 0) {
          await updateDoc(doc(db, 'users', editing), uploaded);
        }
        notifyTeamLeaderUpdated(form.name || (current as any)?.name || '', form.companyId, newIds, masterAdmins.map(m => m.id));
        setModal(false);
      } else {
        if (!form.username.trim() || form.username.trim().length < 3) {
          Alert.alert('Validation', 'System username must be at least 3 characters');
          setSaving(false);
          return;
        }
        if (!form.password || form.password.length < 6) {
          Alert.alert('Validation', 'Temporary password must be at least 6 characters');
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
          role: 'team-leader',
          companyId: form.companyId || undefined,
          departmentId: form.departmentId || undefined,
          departmentName: form.departmentName || '',
          designation: form.designation || '',
          contingencyAccess: contingency,
          linkedExecutiveIds: form.executiveIds,
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
            uploaded[storageField] = await uploadTLDoc(uid, storageField, { uri, name: name || storageField });
          }
        }
        if (Object.keys(uploaded).length > 0) {
          await updateDoc(doc(db, 'users', uid), uploaded);
        }

        notifyTeamLeaderCreated(form.name, form.companyId, form.executiveIds, masterAdmins.map(m => m.id));
        setModal(false);
      }
    } catch (err: any) {
      const code = err.code || '';
      if (code === 'auth/email-already-in-use') Alert.alert('Error', 'This email is already registered. Please use a different email.');
      else if (code === 'auth/weak-password') Alert.alert('Error', 'Password must be at least 6 characters.');
      else if (code === 'auth/invalid-email') Alert.alert('Error', 'The email address is not valid.');
      else Alert.alert('Error', err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
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
      const headers = ['Name,Email,Designation,Status,Company,Executive,Contingency'];
      const rows = filtered.map(tl => {
        const execNames = (tl as any).linkedExecutiveIds?.map((id: string) => getExecName(id)).join('; ') || '';
        return `${tl.name},${tl.email},${(tl as any).designation || ''},${(tl as any).status || 'Active'},${getDerivedCompany(tl)},${execNames},${(tl as any).contingencyAccess ? 'Yes' : 'No'}`;
      });
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'teamleaders_export.csv');
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
      <ScreenHeader title="Team Leaders" onBack={() => navigation.goBack()} />
      <View style={s.header}>
        <Text style={s.title}>Team Leaders</Text>
        <Text style={s.count}>{filtered.length} total</Text>
      </View>

      <View style={s.statsRow}>
        {[
          { label: 'Total Team Leaders', value: teamLeaders.length, icon: 'people-outline', color: '#FF6600' },
          { label: 'Active Executives', value: execOptions.length, icon: 'briefcase-outline', color: '#3b82f6' },
          { label: 'Linked to Executive', value: teamLeaders.filter(tl => ((tl as any).linkedExecutiveIds || ((tl as any).reportingExecutiveId ? [(tl as any).reportingExecutiveId] : [])).length > 0).length, icon: 'git-network-outline', color: '#8b5cf6' },
          { label: 'Contingency Active', value: teamLeaders.filter(tl => (tl as any).contingencyAccess).length, icon: 'flash-outline', color: '#ef4444' },
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
          <TextInput style={s.searchInput} placeholder="Search team leaders..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
        </View>
        <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
        <TouchableOpacity style={s.addBtn} onPress={openCreate}>
          <Icon name="add-outline" size={18} color="#fff" />
          {isWide ? <Text style={s.addBtnText}>Add Team Leader</Text> : null}
        </TouchableOpacity>
      </View>

      <FilterChips
        options={execOptions.map(e => ({ label: e.name, value: e.id }))}
        selected={execFilter}
        allLabel="All Executives"
        onSelect={setExecFilter}
      />

      {loading ? (
        <Text style={s.emptyText}>Loading...</Text>
      ) : (
        <ScrollView style={{ flex: 1 }}>
          <View style={s.list}>
            {paginated.length === 0 ? (
              <Text style={s.emptyText}>{search || execFilter ? 'No team leaders match your filters.' : 'No team leaders yet.'}</Text>
            ) : paginated.map(tl => {
              const execIds: string[] = (tl as any).linkedExecutiveIds || ((tl as any).reportingExecutiveId ? [(tl as any).reportingExecutiveId] : []);
              const execNames = execIds.map((id: string) => executives.find(e => e.id === id)?.name).filter((n): n is string => !!n);
              const compNames = Array.from(new Set(execIds.map((id: string) => executives.find(e => e.id === id)?.companyId).filter((cid): cid is string => !!cid).map(cid => getCompanyName(cid))));
              const active = (tl as any).status === 'Active' || (tl as any).status === undefined;
              const MAX_VISIBLE = 3;
              return (
                <View key={tl.id} style={s.card}>
                  <View style={s.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.empName}>{tl.name}</Text>
                      <Text style={s.roleText}>{(tl as any).designation || 'Team Leader'} • {tl.email}</Text>
                    </View>
                    <View style={[s.badge, { backgroundColor: active ? '#10b98120' : '#ef444420' }]}>
                      <Text style={[s.badgeText, { color: active ? '#10b981' : '#ef4444' }]}>{(tl as any).status || 'Active'}</Text>
                    </View>
                  </View>

                  {execNames.length > 0 ? (
                    <View style={s.tagBlock}>
                      <Text style={s.tagLabel}>Assigned Executive</Text>
                      <View style={s.tagRow}>
                        {execNames.slice(0, MAX_VISIBLE).map(n => (
                          <Text key={n} style={[s.tag, s.tagExecutive]}>{n}</Text>
                        ))}
                        {execNames.length > MAX_VISIBLE && <Text style={[s.tag, s.tagMore]}>+{execNames.length - MAX_VISIBLE}</Text>}
                      </View>
                    </View>
                  ) : null}

                  {compNames.length > 0 ? (
                    <View style={s.tagBlock}>
                      <Text style={s.tagLabel}>Companies Handled</Text>
                      <View style={s.tagRow}>
                        {compNames.slice(0, MAX_VISIBLE).map(n => (
                          <Text key={n} style={[s.tag, s.tagCompany]}>{n}</Text>
                        ))}
                        {compNames.length > MAX_VISIBLE && <Text style={[s.tag, s.tagMore]}>+{compNames.length - MAX_VISIBLE}</Text>}
                      </View>
                    </View>
                  ) : null}

                  <View style={s.tagBlock}>
                    <Text style={s.tagLabel}>Contingency Access</Text>
                    <TouchableOpacity
                      style={[s.tag, (tl as any).contingencyAccess ? s.tagContingencyOn : s.tagContingencyOff]}
                      onPress={() => toggleContingency(tl)}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '600', color: (tl as any).contingencyAccess ? '#fff' : '#64748b' }}>
                        {(tl as any).contingencyAccess ? 'Enabled' : 'Disabled'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={s.cardActions}>
                    <TouchableOpacity style={s.viewBtn} onPress={() => openView(tl)}>
                      <Icon name="eye-outline" size={15} color="#64748b" />
                      <Text style={s.viewBtnText}>View</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.editBtn} onPress={() => openEdit(tl)}>
                      <Icon name="create-outline" size={15} color="#3b82f6" />
                      <Text style={s.editBtnText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.delBtn} onPress={() => openDelete(tl)}>
                      <Icon name="trash-outline" size={15} color="#ef4444" />
                      <Text style={s.delBtnText}>Deact.</Text>
                    </TouchableOpacity>
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
                <Text style={s.modalTitle}>{editing ? 'Edit Team Leader' : 'Add Team Leader'}</Text>
                <TouchableOpacity onPress={() => setModal(false)}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>

              <Text style={s.formSectionTitle}>Personal Information</Text>
              <Text style={s.fieldLabel}>Full Name *</Text>
              <TextInput style={s.input} placeholder="Full Name" placeholderTextColor={colors.textTertiary} value={form.name} onChangeText={(t) => setForm({...form, name: t})} />
              <Text style={s.fieldLabel}>Corporate Email *</Text>
              <TextInput style={s.input} placeholder="teamleader@company.com" placeholderTextColor={colors.textTertiary} value={form.email} onChangeText={(t) => setForm({...form, email: t})} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
              <Text style={s.fieldLabel}>Phone Number</Text>
              <TextInput style={s.input} placeholder="+91 98765 43210" placeholderTextColor={colors.textTertiary} value={form.phone} onChangeText={(t) => setForm({...form, phone: t})} keyboardType="phone-pad" />

              <Text style={s.formSectionTitle}>Account Credentials</Text>
              {!editing && (
                <>
                  <Text style={s.fieldLabel}>System Username *</Text>
                  <TextInput style={s.input} placeholder="e.g. rohitk" placeholderTextColor={colors.textTertiary} value={form.username} onChangeText={(t) => setForm({...form, username: t})} autoCapitalize="none" autoCorrect={false} />
                  <Text style={s.fieldLabel}>Temporary Password *</Text>
                  <TextInput style={s.input} placeholder="Min 6 characters" placeholderTextColor={colors.textTertiary} value={form.password} onChangeText={(t) => setForm({...form, password: t})} />
                </>
              )}

              {sectionToggle('Reporting Hierarchy', showAssign, setShowAssign)}
              {showAssign && (
                <>
                  <Text style={s.fieldLabel}>Assign to Executive(s)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12, flexWrap: 'wrap' }}>
                    {execOptions.length === 0 ? (
                      <Text style={s.emptyText}>No active executives available</Text>
                    ) : execOptions.map(ex => {
                      const selected = form.executiveIds.includes(ex.id);
                      return (
                        <TouchableOpacity key={ex.id} style={[s.chip, selected && s.chipActive]} onPress={() => toggleExec(ex.id)}>
                          <Text style={[s.chipText, selected && { color: '#fff' }]}>{ex.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <View style={s.switchRow}>
                    <Text style={s.switchLabel}>Contingency Access (works across companies)</Text>
                    <Switch value={contingency} onValueChange={setContingency} />
                  </View>
                </>
              )}

              {sectionToggle('Employment Details', showEmp, setShowEmp)}
              {showEmp && (
                <>
                  <TextInput style={s.input} placeholder="Designation" placeholderTextColor={colors.textTertiary} value={form.designation} onChangeText={(t) => setForm({...form, designation: t})} />
                  <TextInput style={s.input} placeholder="Department" placeholderTextColor={colors.textTertiary} value={form.departmentName} onChangeText={(t) => setForm({...form, departmentName: t})} />
                  <TextInput style={s.input} placeholder="Join Date (YYYY-MM-DD)" placeholderTextColor={colors.textTertiary} value={form.joinDate} onChangeText={(t) => setForm({...form, joinDate: t})} />
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

              {sectionToggle('Bank Details', showBank, setShowBank)}
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

              {sectionToggle('Compensation', showComp, setShowComp)}
              {showComp && (
                <>
                  <TextInput style={s.input} placeholder="Monthly Gross Salary" placeholderTextColor={colors.textTertiary} value={form.monthlyGrossSalary} onChangeText={(t) => setForm({...form, monthlyGrossSalary: t})} keyboardType="decimal-pad" />
                  <TextInput style={s.input} placeholder="Salary Effective Date (YYYY-MM-DD)" placeholderTextColor={colors.textTertiary} value={form.salaryEffectiveDate} onChangeText={(t) => setForm({...form, salaryEffectiveDate: t})} />
                </>
              )}

              {sectionToggle('Emergency Contact', showContact, setShowContact)}
              {showContact && (
                <>
                  <TextInput style={s.input} placeholder="Emergency Contact Name" placeholderTextColor={colors.textTertiary} value={form.emergencyContactName} onChangeText={(t) => setForm({...form, emergencyContactName: t})} />
                  <TextInput style={s.input} placeholder="Emergency Contact Phone" placeholderTextColor={colors.textTertiary} value={form.emergencyContactPhone} onChangeText={(t) => setForm({...form, emergencyContactPhone: t})} keyboardType="phone-pad" />
                  <TextInput style={[s.input, s.textArea]} placeholder="Address" placeholderTextColor={colors.textTertiary} value={form.address} onChangeText={(t) => setForm({...form, address: t})} multiline numberOfLines={2} />
                </>
              )}

              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setModal(false)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
                  <Text style={s.saveBtnText}>{saving ? 'Saving...' : editing ? 'Save Changes' : 'Save Team Leader'}</Text>
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
                <Text style={s.modalTitle}>Team Leader Details</Text>
                <TouchableOpacity onPress={() => { setViewModal(false); setSelected(null); }}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>
              {selected && (
                <>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Basic Information</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Name</Text><Text style={s.detailValue}>{selected.name}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Email</Text><Text style={s.detailValue}>{selected.email}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Designation</Text><Text style={s.detailValue}>{(selected as any).designation || 'Team Leader'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Phone</Text><Text style={s.detailValue}>{(selected as any).phone || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Status</Text><Text style={[s.detailValue, { color: (selected as any).status === 'Active' || !(selected as any).status ? '#10b981' : '#ef4444' }]}>{(selected as any).status || 'Active'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Contingency</Text><Text style={s.detailValue}>{(selected as any).contingencyAccess ? 'Yes' : 'No'}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Organization</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Company</Text><Text style={s.detailValue}>{getDerivedCompany(selected)}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Department</Text><Text style={s.detailValue}>{(selected as any).department || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Employment Type</Text><Text style={s.detailValue}>{(selected as any).employmentType || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Join Date</Text><Text style={s.detailValue}>{(selected as any).joinDate || 'N/A'}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Executive Assignment</Text>
                    <Text style={s.detailValue}>{(selected as any).linkedExecutiveIds?.length ? (selected as any).linkedExecutiveIds.map((id: string) => getExecName(id)).join(', ') : 'None'}</Text>
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
                    <View style={s.detailRow}><Text style={s.detailLabel}>Aadhar Card</Text><Text style={s.detailValue}>{(selected as any).aadharDoc ? 'Uploaded' : 'Not uploaded'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>PAN</Text><Text style={s.detailValue}>{(selected as any).panNumber || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>PAN Card</Text><Text style={s.detailValue}>{(selected as any).panDoc ? 'Uploaded' : 'Not uploaded'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Joining Letter</Text><Text style={s.detailValue}>{(selected as any).joiningLetterDoc ? 'Uploaded' : 'Not uploaded'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Offer Letter</Text><Text style={s.detailValue}>{(selected as any).offerLetterDoc ? 'Uploaded' : 'Not uploaded'}</Text></View>
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
              <Text style={s.modalTitle}>Deactivate Team Leader</Text>
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
  searchRow: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInputWrap: { flex: 1, minWidth: 0, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  statsRow: { paddingHorizontal: 16, marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  statCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 8, width: '31%', alignItems: 'center', justifyContent: 'center', height: 95 },
  statIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '700', color: c.text },
  statLabel: { fontSize: 11, color: c.textSecondary, marginTop: 2, textAlign: 'center' },
  addBtn: { backgroundColor: '#FF6600', borderRadius: 12, height: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, flexShrink: 0, minWidth: 44 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  list: {},
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 16, marginHorizontal: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  empName: { fontSize: 16, fontWeight: '600', color: c.text },
  roleText: { color: '#FF6600', fontSize: 13, marginTop: 2 },
  badge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  tagBlock: { marginTop: 8 },
  tagLabel: { fontSize: 11, color: c.textTertiary, textTransform: 'uppercase', fontWeight: '700', marginBottom: 4 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, fontSize: 11, fontWeight: '600', overflow: 'hidden' },
  tagExecutive: { backgroundColor: '#fef3c7', color: '#d97706' },
  tagCompany: { backgroundColor: '#eff6ff', color: '#2563eb' },
  tagMore: { backgroundColor: '#f1f5f9', color: '#64748b' },
  tagContingencyOn: { backgroundColor: '#ef4444', color: '#fff' },
  tagContingencyOff: { backgroundColor: '#f1f5f9', color: '#64748b' },
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
  modalSmall: { backgroundColor: c.card, padding: 24, marginHorizontal: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, color: c.text, fontSize: 15, marginBottom: 12 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  fieldLabel: { color: c.textSecondary, fontSize: 14, marginBottom: 8, fontWeight: '600' },
  formSectionTitle: { fontSize: 17, fontWeight: '700', color: c.text, marginTop: 18, marginBottom: 12, borderTopWidth: 1, borderTopColor: c.borderLight, paddingTop: 14 },
  uploadWrap: { marginBottom: 12 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#3b82f6', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#3b82f610' },
  uploadBtnText: { color: '#3b82f6', fontSize: 13, fontWeight: '600', flex: 1 },
  uploadHint: { color: c.textTertiary, fontSize: 11, marginTop: 6 },
  uploadRemove: { color: '#ef4444', fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'right' },
  optionRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  option: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center' },
  optionActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  optionText: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginRight: 8, backgroundColor: '#F3F4F6' },
  chipActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  chipText: { color: '#1F2937', fontSize: 13, fontWeight: '600' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingVertical: 4 },
  switchLabel: { color: c.text, fontSize: 14, flex: 1, marginRight: 12 },
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
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.borderLight },
  detailLabel: { fontSize: 13, color: c.textTertiary, flex: 1 },
  detailValue: { fontSize: 13, color: c.text, flex: 1, textAlign: 'right' },
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
