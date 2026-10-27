import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TextInput, TouchableOpacity, Modal, Alert, Switch, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, query, where, onSnapshot, getDocs } from '../../aws/firestore-compat';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import { db } from '../../aws/clients';
import { Paths, File, Directory } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../../context/AuthContext';
import { useCompany } from '../../context/CompanyContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { subscribeToCompanies, createCompany, updateCompany, deleteCompany, onboardCompany, uploadCompanyDocument, type Company } from '../../services/companyService';
import { scopedCompanyIdsForRole } from '../../utils/companyScope';
import { subscribeEmployees, type Employee } from '../../services/employeeService';
import { Icon } from '../../utils/icons';
import { ScreenHeader } from '../../components/ScreenHeader';
import type { User } from '../../types/user';

const STATUS_OPTIONS = ['Active', 'Inactive', 'Pending', 'Suspended'] as const;
const TIMEZONE_OPTIONS = ['Asia/Kolkata'];
const CURRENCY_OPTIONS = ['INR'];
const LANGUAGE_OPTIONS = ['English'];
const ACCEPTED_DOC_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const ACCEPTED_DOC_EXTS = ['jpg', 'jpeg', 'png', 'pdf'];
const MAX_DOC_SIZE = 5 * 1024 * 1024;

interface CompanyFormData {
  name: string;
  code: string;
  domain: string;
  phone: string;
  website: string;
  address: string;
  country: string;
  state: string;
  city: string;
  zipCode: string;
  establishmentDate: string;
  timezone: string;
  currency: string;
  language: string;
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  employeeLimit: string;
  description: string;
  status: string;
  averageSalary: string;
  mandatoryAttendanceDays: string;
  employees: string;
  panNumber: string;
  gstNumber: string;
  panDoc: string;
  panDocName: string;
  gstDoc: string;
  gstDocName: string;
  agreementDoc: string;
  agreementDocName: string;
  officeAddress: string;
  latitude: string;
  longitude: string;
  radiusInMeters: string;
  allowMobileData: boolean;
  requireWifi: boolean;
  wifiSSID: string;
  requireSelfie: boolean;
}

const emptyForm: CompanyFormData = {
  name: '', code: '', domain: '', phone: '', website: '', address: '',
  country: 'India', state: '', city: '', zipCode: '', establishmentDate: '',
  timezone: 'Asia/Kolkata', currency: 'INR', language: 'English',
  adminName: '', adminEmail: '', adminPhone: '',
  employeeLimit: '50', description: '', status: 'Active',
  averageSalary: '0', mandatoryAttendanceDays: '22', employees: '0',
  panNumber: '', gstNumber: '',
  panDoc: '', panDocName: '', gstDoc: '', gstDocName: '', agreementDoc: '', agreementDocName: '',
  officeAddress: '', latitude: '0', longitude: '0', radiusInMeters: '100',
  allowMobileData: true, requireWifi: false, wifiSSID: '', requireSelfie: false,
};

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
];

const INDIA_CITIES_MAP: Record<string, string[]> = {
  'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Rajahmundry', 'Tirupati', 'Kakinada', 'Kadapa', 'Anantapur', 'Eluru', 'Ongole', 'Machilipatnam', 'Tenali', 'Proddatur', 'Chittoor', 'Hindupur'],
  'Maharashtra': ['Mumbai', 'Pune', 'Nagpur', 'Thane', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Amravati', 'Navi Mumbai', 'Sangli', 'Malegaon', 'Jalgaon', 'Akola', 'Latur', 'Ahmednagar', 'Dhule', 'Chandrapur', 'Parbhani', 'Ichalkaranji', 'Jalna', 'Nanded', 'Wardha', 'Satara', 'Ratnagiri'],
  'Gujarat': ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Junagadh', 'Gandhinagar', 'Anand', 'Nadiad', 'Morbi', 'Mehsana', 'Bharuch', 'Navsari', 'Bhuj', 'Palanpur', 'Porbandar', 'Gandhidham', 'Surendranagar'],
  'Karnataka': ['Bengaluru', 'Mysuru', 'Hubli', 'Mangaluru', 'Belagavi', 'Davanagere', 'Bellary', 'Tumkur', 'Shivamogga', 'Raichur', 'Bidar', 'Hospet', 'Gadag', 'Hassan', 'Udupi', 'Chitradurga', 'Robertson Pet', 'Kolar'],
  'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Tiruppur', 'Erode', 'Vellore', 'Thoothukudi', 'Dindigul', 'Thanjavur', 'Ranipet', 'Sivakasi', 'Karur', 'Udhagamandalam', 'Hosur', 'Nagercoil', 'Kanchipuram', 'Kumbakonam', 'Cuddalore', 'Rajapalayam', 'Pollachi'],
  'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Agra', 'Varanasi', 'Meerut', 'Allahabad', 'Ghaziabad', 'Noida', 'Bareilly', 'Aligarh', 'Moradabad', 'Gorakhpur', 'Saharanpur', 'Jhansi', 'Firozabad', 'Mathura', 'Muzaffarnagar', 'Shahjahanpur', 'Rampur', 'Ayodhya'],
  'West Bengal': ['Kolkata', 'Howrah', 'Asansol', 'Siliguri', 'Durgapur', 'Bardhaman', 'Malda', 'Baharampur', 'Habra', 'Kharagpur', 'Shantiniketan', 'Darjeeling', 'Haldia', 'Krishnanagar', 'Balurghat', 'Basirhat', 'Jalpaiguri', 'Cooch Behar'],
  'Rajasthan': ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Bikaner', 'Ajmer', 'Bhilwara', 'Alwar', 'Sikar', 'Bharatpur', 'Sri Ganganagar', 'Pali', 'Tonk', 'Chittorgarh', 'Kishangarh', 'Jhunjhunu', 'Sawai Madhopur', 'Beawar', 'Nagaur', 'Bundi', 'Churu'],
  'Bihar': ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Darbhanga', 'Purnia', 'Arrah', 'Begusarai', 'Chhapra', 'Katihar', 'Munger', 'Sasaram', 'Hajipur', 'Saharsa', 'Motihari', 'Bettiah', 'Samastipur', 'Siwan', 'Buxar', 'Madhubani'],
  'Madhya Pradesh': ['Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Ujjain', 'Dewas', 'Sagar', 'Satna', 'Ratlam', 'Rewa', 'Murwara', 'Singrauli', 'Burhanpur', 'Khandwa', 'Morena', 'Bhind', 'Chhindwara', 'Guna', 'Mandsaur', 'Damoh', 'Shivpuri', 'Vidisha', 'Chhatarpur', 'Datia', 'Hoshangabad', 'Itarsi', 'Neemuch', 'Pithampur'],
  'Delhi': ['New Delhi', 'Delhi', 'Dwarka', 'Rohini', 'Saket', 'Karol Bagh', 'Connaught Place', 'Lajpat Nagar', 'Hauz Khas', 'Vasant Kunj', 'Pitampura', 'Janakpuri', 'Patel Nagar', 'Malviya Nagar', 'Green Park', 'Greater Kailash', 'Defence Colony'],
  'Haryana': ['Chandigarh', 'Faridabad', 'Gurugram', 'Panipat', 'Ambala', 'Karnal', 'Sonipat', 'Yamunanagar', 'Panchkula', 'Bhiwani', 'Rohtak', 'Hisar', 'Rewari', 'Sirsa', 'Kaithal', 'Jind', 'Kurukshetra', 'Bahadurgarh'],
  'Punjab': ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Hoshiarpur', 'Batala', 'Pathankot', 'Moga', 'Abohar', 'Malerkotla', 'Khanna', 'Phagwara', 'Muktsar', 'Barnala', 'Rajpura', 'Firozpur', 'Kapurthala', 'Sangrur', 'Ropar'],
  'Telangana': ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Ramagundam', 'Mahbubnagar', 'Nalgonda', 'Adilabad', 'Suryapet', 'Jagtial', 'Miryalaguda', 'Nirmal', 'Mancherial', 'Siddipet', 'Wanaparthy', 'Bhadrachalam'],
  'Kerala': ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Alappuzha', 'Palakkad', 'Kannur', 'Kottayam', 'Malappuram', 'Kasaragod', 'Pathanamthitta', 'Idukki', 'Wayanad', 'Munnar', 'Guruvayur', 'Chalakudy'],
};

export const CompaniesScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation();
  const { user, hasPermission } = useAuth();
  const { effectiveCompanyId, availableCompanies } = useCompany();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [executives, setExecutives] = useState<User[]>([]);
  const [teamLeaders, setTeamLeaders] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [empFilter, setEmpFilter] = useState(false);
  const [modal, setModal] = useState(false);
  const [viewModal, setViewModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [selected, setSelected] = useState<Company | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<CompanyFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [showAttendance, setShowAttendance] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showPolicies, setShowPolicies] = useState(false);
  const [filterModal, setFilterModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);
  const { width: screenWidth } = useWindowDimensions();
  const isWide = screenWidth >= 480;

  const isMasterAdmin = user?.role === 'master-admin';
  const isRestrictedScope = user?.role === 'executive' || user?.role === 'team-leader';
  const scopeIds = useMemo(
    () => scopedCompanyIdsForRole(user?.role, effectiveCompanyId, availableCompanies),
    [user?.role, effectiveCompanyId, availableCompanies]
  );

  useEffect(() => {
    const unsubComp = subscribeToCompanies(
      (data) => {
        setCompanies(isRestrictedScope && scopeIds.length > 0 ? data.filter(c => scopeIds.includes(c.id)) : data);
        setLoading(false);
      },
      () => setLoading(false)
    );
    const unsubEmp = subscribeEmployees(null, (emps) => setEmployees(emps));
    const qExec = query(collection(db, 'users'), where('role', '==', 'executive'));
    const unsubExec = onSnapshot(qExec, (snap) => {
      setExecutives(snap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
    }, () => {});
    const qTL = query(collection(db, 'users'), where('role', '==', 'team-leader'));
    const unsubTL = onSnapshot(qTL, (snap) => {
      setTeamLeaders(snap.docs.map(d => ({ id: d.id, ...d.data() } as User)));
    }, () => {});
    return () => { unsubComp(); unsubEmp(); unsubExec(); unsubTL(); };
  }, [scopeIds, isRestrictedScope]);

  const empCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of employees) {
      const cid = e.companyId;
      if (cid) counts[cid] = (counts[cid] || 0) + 1;
    }
    return counts;
  }, [employees]);

  const stats = {
    total: companies.length,
    active: companies.filter(c => c.status === 'Active').length,
    totalEmployees: companies.reduce((sum, c) => sum + (empCounts[c.id] || 0), 0),
  };  const filtered = useMemo(() => {
    return companies.filter(c => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (empFilter && !(empCounts[c.id] > 0)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!c.name?.toLowerCase().includes(q) && !c.code?.toLowerCase().includes(q) &&
            !c.domain?.toLowerCase().includes(q) && !c.adminName?.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [companies, search, statusFilter, empFilter, empCounts]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => {
    return filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  }, [filtered, currentPage, pageSize]);

  const getAssigneeName = (companyId: string) => {
    const c = companies.find(c => c.id === companyId);
    const execId = (c as any)?.assignedExecutiveId;
    if (!execId) return '';
    const exec = executives.find(e => e.id === execId);
    return exec?.name || '';
  };

  const getReportingTLs = (companyId: string): string[] => {
    const c = companies.find(c => c.id === companyId);
    const execId = (c as any)?.assignedExecutiveId;
    if (!execId) return [];
    const exec = executives.find(e => e.id === execId);
    const tlIds: string[] = (exec as any)?.assignedTeamLeaderIds || [];
    return tlIds.map((tid: string) => teamLeaders.find(t => t.id === tid)?.name || '').filter(Boolean);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, empFilter]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(1);
  }, [totalPages]);

  const openCreate = () => {
    if (!hasPermission('companies.create')) {
      Alert.alert('Access denied', 'You do not have permission to create companies');
      return;
    }
    setEditing(null);
    setForm(emptyForm);
    setShowAttendance(false);
    setShowLocation(false);
    setShowDocs(false);
    setShowPolicies(false);
    setModal(true);
  };

  const openEdit = (company: Company) => {
    if (!hasPermission('companies.edit')) {
      Alert.alert('Access denied', 'You do not have permission to edit companies');
      return;
    }
    setEditing(company.id);
    setForm({
      name: company.name || '',
      code: company.code || '',
      domain: company.domain || '',
      phone: company.phone || '',
      website: company.website || '',
      address: company.address || '',
      country: company.country || 'India',
      state: company.state || '',
      city: company.city || '',
      zipCode: company.zipCode || '',
      establishmentDate: company.establishmentDate || '',
      timezone: company.timezone || 'Asia/Kolkata',
      currency: company.currency || 'INR',
      language: company.language || 'English',
      adminName: company.adminName || '',
      adminEmail: company.adminEmail || '',
      adminPhone: company.adminPhone || '',
      employeeLimit: String(company.employeeLimit || 50),
      description: company.description || '',
      status: company.status || 'Active',
      averageSalary: String(company.averageSalary || 0),
      mandatoryAttendanceDays: String(company.mandatoryAttendanceDays || 22),
      employees: String(company.employees ?? 0),
      panNumber: company.panNumber || '',
      gstNumber: company.gstNumber || '',
      panDoc: (company as any).panDoc || '',
      panDocName: (company as any).panDoc ? (company as any).panDocName || 'Uploaded' : '',
      gstDoc: (company as any).gstDoc || '',
      gstDocName: (company as any).gstDoc ? (company as any).gstDocName || 'Uploaded' : '',
      agreementDoc: (company as any).agreementDoc || '',
      agreementDocName: (company as any).agreementDoc ? (company as any).agreementDocName || 'Uploaded' : '',
      officeAddress: (company as any).officeAddress || (company as any).attendanceSettings?.officeAddress || '',
      latitude: String((company as any).latitude ?? (company as any).attendanceSettings?.latitude ?? 0),
      longitude: String((company as any).longitude ?? (company as any).attendanceSettings?.longitude ?? 0),
      radiusInMeters: String((company as any).radiusInMeters ?? (company as any).attendanceSettings?.radiusInMeters ?? 100),
      allowMobileData: (company as any).allowMobileData !== false && (company as any).attendanceSettings?.allowMobileData !== false,
      requireWifi: !!(company as any).requireWifi || !!(company as any).attendanceSettings?.requireWifi,
      wifiSSID: (company as any).wifiSSID || (company as any).attendanceSettings?.wifiSSID || '',
      requireSelfie: !!(company as any).requireSelfie || !!(company as any).attendanceSettings?.requireSelfie,
    });
    setShowAttendance(false);
    setShowLocation(false);
    setShowDocs(false);
    setShowPolicies(false);
    setModal(true);
  };

  const openView = (company: Company) => { setSelected(company); setViewModal(true); };

  const openDelete = (company: Company) => {
    if (!hasPermission('companies.delete')) {
      Alert.alert('Access denied', 'You do not have permission to delete companies');
      return;
    }
    setSelected(company); setDeleteModal(true);
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      await deleteCompany(selected.id);
      setDeleteModal(false);
      setSelected(null);
    } catch {
      Alert.alert('Error', 'Failed to delete company');
    }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.adminName.trim() || !form.adminEmail.trim()) {
      Alert.alert('Validation', 'Company name, admin name, and admin email are required');
      return;
    }
    if (!editing && !form.officeAddress.trim()) {
      Alert.alert('Validation', 'Office full address is required in Attendance Configuration');
      return;
    }
    setSaving(true);
    try {
      const companyId = editing || doc(collection(db, 'companies')).id;

      let panDoc = form.panDoc;
      let gstDoc = form.gstDoc;
      let agreementDoc = form.agreementDoc;
      if (panDoc && !panDoc.startsWith('https://')) {
        panDoc = await uploadCompanyDocument(companyId, 'pan', { uri: panDoc, name: form.panDocName || 'pan' });
      }
      if (gstDoc && !gstDoc.startsWith('https://')) {
        gstDoc = await uploadCompanyDocument(companyId, 'gst', { uri: gstDoc, name: form.gstDocName || 'gst' });
      }
      if (agreementDoc && !agreementDoc.startsWith('https://')) {
        agreementDoc = await uploadCompanyDocument(companyId, 'agreement', { uri: agreementDoc, name: form.agreementDocName || 'agreement' });
      }

      const payload: any = {
        name: form.name,
        code: form.code,
        domain: form.domain,
        phone: form.phone,
        website: form.website,
        address: form.address,
        country: form.country,
        state: form.state,
        city: form.city,
        zipCode: form.zipCode,
        establishmentDate: form.establishmentDate,
        timezone: form.timezone,
        currency: form.currency,
        language: form.language,
        adminName: form.adminName,
        adminEmail: form.adminEmail,
        adminPhone: form.adminPhone,
        employeeLimit: Number(form.employeeLimit) || 50,
        employees: Number(form.employees) || 0,
        description: form.description,
        status: form.status,
        averageSalary: Number(form.averageSalary) || 0,
        mandatoryAttendanceDays: Number(form.mandatoryAttendanceDays) || 22,
        panNumber: form.panNumber,
        gstNumber: form.gstNumber,
        panDoc,
        gstDoc,
        agreementDoc,
        officeAddress: form.officeAddress,
        latitude: Number(form.latitude) || 0,
        longitude: Number(form.longitude) || 0,
        radiusInMeters: Number(form.radiusInMeters) || 100,
        allowMobileData: form.allowMobileData,
        requireWifi: form.requireWifi,
        wifiSSID: form.requireWifi ? form.wifiSSID : '',
        requireSelfie: form.requireSelfie,
      };

      if (editing) {
        const { code, ...updatePayload } = payload;
        await updateCompany(editing, {
          ...updatePayload,
          attendanceSettings: {
            officeAddress: form.officeAddress,
            latitude: Number(form.latitude) || 0,
            longitude: Number(form.longitude) || 0,
            radiusInMeters: Number(form.radiusInMeters) || 100,
            allowMobileData: form.allowMobileData,
            requireWifi: form.requireWifi,
            wifiSSID: form.requireWifi ? form.wifiSSID : '',
            requireSelfie: form.requireSelfie,
          },
        });
      } else {
        await onboardCompany({
          companyId,
          ...payload,
          attendanceSettings: {
            officeAddress: form.officeAddress,
            latitude: Number(form.latitude) || 0,
            longitude: Number(form.longitude) || 0,
            radiusInMeters: Number(form.radiusInMeters) || 100,
            allowMobileData: form.allowMobileData,
            requireWifi: form.requireWifi,
            wifiSSID: form.requireWifi ? form.wifiSSID : '',
            requireSelfie: form.requireSelfie,
          },
        });
      }
      setModal(false);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save company');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatusFilter = (status: string) => {
    setStatusFilter(prev => prev === status ? '' : status);
  };

  const pickDocument = async (field: 'panDoc' | 'gstDoc' | 'agreementDoc', nameField: 'panDocName' | 'gstDocName' | 'agreementDocName') => {
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

  const removeDocument = (field: 'panDoc' | 'gstDoc' | 'agreementDoc', nameField: 'panDocName' | 'gstDocName' | 'agreementDocName') => {
    setForm(f => ({ ...f, [field]: '', [nameField]: '' }));
  };

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Location permission is required to fetch current coordinates.');
        return;
      }
      setLocating(true);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setForm(f => ({
        ...f,
        latitude: pos.coords.latitude.toFixed(6),
        longitude: pos.coords.longitude.toFixed(6),
      }));
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Could not get current location');
    } finally {
      setLocating(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const headers = ['Company,Code,Admin,Email,Assigned Executive,Reporting TL,Employees,Status'];
      const rows = filtered.map(c => {
        const execName = getAssigneeName(c.id);
        const tlNames = getReportingTLs(c.id).join('; ');
        return `${c.name},${c.code || ''},${c.adminName},${c.adminEmail},${execName},${tlNames},${empCounts[c.id] || 0},${c.status}`;
      });
      const csv = [...headers, ...rows].join('\n');
      const file = new File(Paths.cache, 'companies_export.csv');
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
        <TouchableOpacity
          style={[s.pageBtn, currentPage === 1 && s.pageBtnDisabled]}
          disabled={currentPage === 1}
          onPress={() => setCurrentPage(p => Math.max(1, p - 1))}
        >
          <Icon name="chevron-back-outline" size={16} color={currentPage === 1 ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={s.pageInfo}>{currentPage} / {totalPages}</Text>
        <TouchableOpacity
          style={[s.pageBtn, currentPage === totalPages && s.pageBtnDisabled]}
          disabled={currentPage === totalPages}
          onPress={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
        >
          <Icon name="chevron-forward-outline" size={16} color={currentPage === totalPages ? colors.textTertiary : colors.text} />
        </TouchableOpacity>
        <Text style={s.pageSizeText}>Show:</Text>
        <TouchableOpacity style={s.pageSizeBtn} onPress={() => {
          const sizes = [5, 10, 20, 50];
          const idx = sizes.indexOf(pageSize);
          setPageSize(sizes[(idx + 1) % sizes.length]);
        }}>
          <Text style={s.pageSizeBtnText}>{pageSize}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Companies" onBack={() => navigation.goBack()} />
      <View style={s.header}>
        <Text style={s.title}>Companies</Text>
        <Text style={s.count}>{filtered.length} total</Text>
      </View>

      <View style={s.statsRow}>
        {[
          { key: '', label: 'Total Companies', value: stats.total, icon: 'business-outline', color: '#3b82f6' },
          { key: '__emp', label: 'Total Employees', value: stats.totalEmployees, icon: 'people-outline', color: '#8b5cf6' },
          { key: 'Active', label: 'Active', value: companies.filter(c => c.status === 'Active').length, icon: 'checkmark-circle-outline', color: '#10b981' },
          { key: 'Inactive', label: 'Inactive', value: companies.filter(c => c.status === 'Inactive').length, icon: 'close-circle-outline', color: '#ef4444' },
          { key: 'Suspended', label: 'Suspended', value: companies.filter(c => c.status === 'Suspended').length, icon: 'ban-outline', color: '#dc2626' },
          { key: 'Pending', label: 'Pending', value: companies.filter(c => c.status === 'Pending').length, icon: 'time-outline', color: '#FF6600' },
        ].map(card => (
          <TouchableOpacity
            key={card.key}
            style={[s.statCard, (statusFilter === card.key || (card.key === '__emp' && empFilter)) && { borderColor: card.color, borderWidth: 2 }]}
            onPress={() => {
              if (card.key === '__emp') { setEmpFilter(prev => !prev); return; }
              toggleStatusFilter(card.key);
            }}
          >
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
          <TextInput style={s.searchInput} placeholder="Search companies..." placeholderTextColor={colors.textTertiary} value={search} onChangeText={setSearch} />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Icon name="close-outline" size={18} color={colors.textTertiary} /></TouchableOpacity> : null}
        </View>
        <TouchableOpacity
          style={[s.iconBtn, (statusFilter || empFilter) && s.iconBtnActive]}
          onPress={() => setFilterModal(true)}>
          <Icon name="filter-outline" size={18} color={(statusFilter || empFilter) ? '#FF6600' : colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={s.exportBtn} onPress={handleExport} disabled={exporting}>
          {exporting ? <ActivityIndicator size={18} color="#fff" /> : <Icon name="download-outline" size={18} color="#fff" />}
        </TouchableOpacity>
        {hasPermission('companies.create') && (
        <TouchableOpacity style={s.addBtn} onPress={openCreate}>
          <Icon name="add-outline" size={18} color="#fff" />
          {isWide ? <Text style={s.addBtnText}>Add New Company</Text> : null}
        </TouchableOpacity>
      )}
      </View>

      {loading ? (
        <Text style={s.emptyText}>Loading...</Text>
      ) : (
        <ScrollView style={{ flex: 1 }}>
          <View style={s.list}>
            {paginated.length === 0 ? (
              <Text style={s.emptyText}>{search || statusFilter || empFilter ? 'No companies match your filters.' : 'No companies yet.'}</Text>
            ) : paginated.map(company => {
              const execName = getAssigneeName(company.id);
              const tlNames = getReportingTLs(company.id);
              return (
                <View key={company.id} style={s.card}>
                  <View style={s.cardTop}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[s.logoCircle, { backgroundColor: company.logoColor || '#FF6600' }]}>
                          <Text style={s.logoText}>{(company.name || 'C')[0]}</Text>
                        </View>
                        <View>
                          <Text style={s.compName}>{company.name}</Text>
                          <Text style={s.compCode}>{company.code || 'N/A'}</Text>
                        </View>
                      </View>
                    </View>
                    <View style={[s.badge, { backgroundColor: company.status === 'Active' ? '#10b98120' : company.status === 'Pending' ? '#FF660020' : company.status === 'Suspended' ? '#dc262620' : '#ef444420' }]}>
                      <Text style={[s.badgeText, { color: company.status === 'Active' ? '#10b981' : company.status === 'Pending' ? '#FF6600' : company.status === 'Suspended' ? '#dc2626' : '#ef4444' }]}>{company.status}</Text>
                    </View>
                  </View>
                  <View style={s.infoGrid}>
                    <View style={s.infoRow}>
                      <Text style={s.infoLabel}>Email</Text>
                      <Text style={s.infoValue} numberOfLines={1}>{company.adminEmail || company.domain || 'N/A'}</Text>
                    </View>
                    <View style={s.infoRow}>
                      <Text style={s.infoLabel}>Code</Text>
                      <Text style={s.infoValue}>{company.code || 'N/A'}</Text>
                    </View>
                    <View style={s.infoRow}>
                      <Text style={s.infoLabel}>Admin</Text>
                      <Text style={s.infoValue} numberOfLines={1}>{company.adminName || 'N/A'}</Text>
                    </View>
                    <View style={s.infoRow}>
                      <Text style={s.infoLabel}>Assigned Executive</Text>
                      <Text style={s.infoValue} numberOfLines={1}>{execName || 'Unassigned'}</Text>
                    </View>
                    <View style={s.infoRow}>
                      <Text style={s.infoLabel}>Reporting TL</Text>
                      <Text style={s.infoValue} numberOfLines={1}>{tlNames.length ? tlNames.join(', ') : '—'}</Text>
                    </View>
                    <View style={s.infoRow}>
                      <Text style={s.infoLabel}>Employees</Text>
                      <Text style={s.infoValue}>{empCounts[company.id] || 0}</Text>
                    </View>
                  </View>
                  <View style={s.cardActions}>
                    <TouchableOpacity style={s.viewBtn} onPress={() => openView(company)}>
                      <Icon name="eye-outline" size={15} color="#64748b" />
                      <Text style={s.viewBtnText}>View</Text>
                    </TouchableOpacity>
                    {hasPermission('companies.edit') && (
                    <TouchableOpacity style={s.editBtn} onPress={() => openEdit(company)}>
                      <Icon name="create-outline" size={15} color="#3b82f6" />
                      <Text style={s.editBtnText}>Edit</Text>
                    </TouchableOpacity>
                  )}
                    {hasPermission('companies.delete') && (
                    <TouchableOpacity style={s.delBtn} onPress={() => openDelete(company)}>
                      <Icon name="trash-outline" size={15} color="#ef4444" />
                      <Text style={s.delBtnText}>Delete</Text>
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
                <Text style={s.modalTitle}>{editing ? 'Edit Company' : 'Add New Company'}</Text>
                <TouchableOpacity onPress={() => setModal(false)}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>

              <Text style={s.sectionTitle}>Company Information</Text>
              <TextInput style={s.input} placeholder="Company Name *" placeholderTextColor={colors.textTertiary} value={form.name} onChangeText={(t) => setForm({...form, name: t})} />
              <TextInput style={s.input} placeholder="Company Code (auto if empty)" placeholderTextColor={colors.textTertiary} value={form.code} onChangeText={(t) => setForm({...form, code: t})} editable={!editing} />
              <TextInput style={s.input} placeholder="Company Email / Domain *" placeholderTextColor={colors.textTertiary} value={form.domain} onChangeText={(t) => setForm({...form, domain: t})} keyboardType="email-address" autoCapitalize="none" />
              <TextInput style={s.input} placeholder="Company Phone" placeholderTextColor={colors.textTertiary} value={form.phone} onChangeText={(t) => setForm({...form, phone: t})} keyboardType="phone-pad" />
              <TextInput style={s.input} placeholder="Website" placeholderTextColor={colors.textTertiary} value={form.website} onChangeText={(t) => setForm({...form, website: t})} />
              <TextInput style={s.input} placeholder="Address" placeholderTextColor={colors.textTertiary} value={form.address} onChangeText={(t) => setForm({...form, address: t})} />

              <TouchableOpacity style={s.sectionToggle} onPress={() => setShowLocation(!showLocation)}>
                <Text style={s.sectionToggleText}>Location Details</Text>
                <Icon name={showLocation ? 'chevron-up-outline' : 'chevron-down-outline'} size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              {showLocation && (
                <>
                  <Text style={s.fieldLabel}>Country</Text>
                  <TextInput style={s.input} placeholder="Country" placeholderTextColor={colors.textTertiary} value={form.country} onChangeText={(t) => { setForm({...form, country: t, state: t === 'India' ? form.state : '', city: t === 'India' ? form.city : '' }); }} />
                  {form.country === 'India' && (
                    <>
                      <Text style={s.fieldLabel}>State</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                        {INDIAN_STATES.map(st => (
                          <TouchableOpacity key={st} style={[s.chipSmall, form.state === st && s.chipSmallActive]} onPress={() => setForm({...form, state: st, city: ''})}>
                            <Text style={[s.chipSmallText, form.state === st && { color: '#fff' }]}>{st}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                      {form.state ? (
                        <>
                          <Text style={s.fieldLabel}>City</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                            {(INDIA_CITIES_MAP[form.state] || []).map(ct => (
                              <TouchableOpacity key={ct} style={[s.chipSmall, form.city === ct && s.chipSmallActive]} onPress={() => setForm({...form, city: ct})}>
                                <Text style={[s.chipSmallText, form.city === ct && { color: '#fff' }]}>{ct}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        </>
                      ) : null}
                    </>
                  )}
                  <TextInput style={s.input} placeholder="ZIP Code" placeholderTextColor={colors.textTertiary} value={form.zipCode} onChangeText={(t) => setForm({...form, zipCode: t})} />
                </>
              )}

              <Text style={s.sectionTitle}>Company Settings</Text>
              <Text style={s.fieldLabel}>Status</Text>
              <View style={s.optionRow}>
                {STATUS_OPTIONS.map(st => (
                  <TouchableOpacity key={st} style={[s.option, form.status === st && s.optionActive]} onPress={() => setForm({...form, status: st})}>
                    <Text style={[s.optionText, form.status === st && { color: '#fff' }]}>{st}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={s.settingRow}>
                <View style={s.settingIcon}><Icon name="time-outline" size={16} color="#FF6600" /></View>
                <Text style={s.settingLabel}>Timezone</Text>
                <Text style={s.settingValue}>IST (Asia/Kolkata)</Text>
              </View>
              <View style={s.settingRow}>
                <View style={s.settingIcon}><Icon name="cash-outline" size={16} color="#10b981" /></View>
                <Text style={s.settingLabel}>Currency</Text>
                <Text style={s.settingValue}>INR (₹)</Text>
              </View>
              <View style={s.settingRow}>
                <View style={s.settingIcon}><Icon name="language-outline" size={16} color="#8b5cf6" /></View>
                <Text style={s.settingLabel}>Language</Text>
                <Text style={s.settingValue}>English</Text>
              </View>

              <Text style={s.sectionTitle}>Company Administrator</Text>
              <TextInput style={s.input} placeholder="Admin Full Name *" placeholderTextColor={colors.textTertiary} value={form.adminName} onChangeText={(t) => setForm({...form, adminName: t})} />
              <TextInput style={s.input} placeholder="Admin Email *" placeholderTextColor={colors.textTertiary} value={form.adminEmail} onChangeText={(t) => setForm({...form, adminEmail: t})} keyboardType="email-address" autoCapitalize="none" />
              <TextInput style={s.input} placeholder="Admin Phone" placeholderTextColor={colors.textTertiary} value={form.adminPhone} onChangeText={(t) => setForm({...form, adminPhone: t})} keyboardType="phone-pad" />

              <TouchableOpacity style={s.sectionToggle} onPress={() => setShowDocs(!showDocs)}>
                <Text style={s.sectionToggleText}>Company Details & Documentation</Text>
                <Icon name={showDocs ? 'chevron-up-outline' : 'chevron-down-outline'} size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              {showDocs && (
                <>
                  <TextInput style={s.input} placeholder="Establishment Date (YYYY-MM-DD)" placeholderTextColor={colors.textTertiary} value={form.establishmentDate} onChangeText={(t) => setForm({...form, establishmentDate: t})} />
                  <TextInput style={s.input} placeholder="PAN Number" placeholderTextColor={colors.textTertiary} value={form.panNumber} onChangeText={(t) => setForm({...form, panNumber: t})} />
                  <DocumentUploadField
                    label="PAN Card Document"
                    fileName={form.panDocName}
                    onPick={() => pickDocument('panDoc', 'panDocName')}
                    onRemove={() => removeDocument('panDoc', 'panDocName')}
                  />
                  <TextInput style={s.input} placeholder="GST Number" placeholderTextColor={colors.textTertiary} value={form.gstNumber} onChangeText={(t) => setForm({...form, gstNumber: t})} />
                  <DocumentUploadField
                    label="GST Certificate Document"
                    fileName={form.gstDocName}
                    onPick={() => pickDocument('gstDoc', 'gstDocName')}
                    onRemove={() => removeDocument('gstDoc', 'gstDocName')}
                  />
                  <DocumentUploadField
                    label="Company Agreement Documents"
                    fileName={form.agreementDocName}
                    onPick={() => pickDocument('agreementDoc', 'agreementDocName')}
                    onRemove={() => removeDocument('agreementDoc', 'agreementDocName')}
                  />
                </>
              )}

              <TouchableOpacity style={s.sectionToggle} onPress={() => setShowPolicies(!showPolicies)}>
                <Text style={s.sectionToggleText}>Operational Policies</Text>
                <Icon name={showPolicies ? 'chevron-up-outline' : 'chevron-down-outline'} size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              {showPolicies && (
                <>
                  <TextInput style={s.input} placeholder="Average Salary (Monthly)" placeholderTextColor={colors.textTertiary} value={form.averageSalary} onChangeText={(t) => setForm({...form, averageSalary: t})} keyboardType="decimal-pad" />
                  <TextInput style={s.input} placeholder="Mandatory Attendance Days" placeholderTextColor={colors.textTertiary} value={form.mandatoryAttendanceDays} onChangeText={(t) => setForm({...form, mandatoryAttendanceDays: t})} keyboardType="number-pad" />
                  <TextInput style={s.input} placeholder="Employee Limit" placeholderTextColor={colors.textTertiary} value={form.employeeLimit} onChangeText={(t) => setForm({...form, employeeLimit: t})} keyboardType="number-pad" />
                  <TextInput style={s.input} placeholder="Employee Count" placeholderTextColor={colors.textTertiary} value={form.employees} onChangeText={(t) => setForm({...form, employees: t})} keyboardType="number-pad" />
                </>
              )}

              <TextInput style={[s.input, s.textArea]} placeholder="Company Description" placeholderTextColor={colors.textTertiary} value={form.description} onChangeText={(t) => setForm({...form, description: t})} multiline numberOfLines={3} />

              <TouchableOpacity style={s.sectionToggle} onPress={() => setShowAttendance(!showAttendance)}>
                <Text style={s.sectionToggleText}>Attendance Configuration</Text>
                <Icon name={showAttendance ? 'chevron-up-outline' : 'chevron-down-outline'} size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              {showAttendance && (
                <>
                  <TextInput style={s.input} placeholder="Office Full Address *" placeholderTextColor={colors.textTertiary} value={form.officeAddress} onChangeText={(t) => setForm({...form, officeAddress: t})} />
                  <TextInput style={s.input} placeholder="Latitude" placeholderTextColor={colors.textTertiary} value={form.latitude} onChangeText={(t) => setForm({...form, latitude: t})} keyboardType="decimal-pad" />
                  <TextInput style={s.input} placeholder="Longitude" placeholderTextColor={colors.textTertiary} value={form.longitude} onChangeText={(t) => setForm({...form, longitude: t})} keyboardType="decimal-pad" />
                  <TouchableOpacity style={s.locationBtn} onPress={getCurrentLocation} disabled={locating}>
                    {locating ? <ActivityIndicator size={16} color="#3b82f6" /> : <Icon name="navigate-outline" size={16} color="#3b82f6" />}
                    <Text style={s.locationBtnText}>{locating ? 'Detecting...' : 'Get Current Location'}</Text>
                  </TouchableOpacity>
                  <TextInput style={s.input} placeholder="Attendance Radius (meters)" placeholderTextColor={colors.textTertiary} value={form.radiusInMeters} onChangeText={(t) => setForm({...form, radiusInMeters: t})} keyboardType="number-pad" />
                  <View style={s.switchRow}>
                    <Text style={s.switchLabel}>Allow Mobile Data</Text>
                    <Switch value={form.allowMobileData} onValueChange={(v) => setForm({...form, allowMobileData: v})} />
                  </View>
                  <View style={s.switchRow}>
                    <Text style={s.switchLabel}>Require Office Wi-Fi</Text>
                    <Switch value={form.requireWifi} onValueChange={(v) => setForm({...form, requireWifi: v})} />
                  </View>
                  {form.requireWifi && (
                    <TextInput style={s.input} placeholder="Wi-Fi SSID" placeholderTextColor={colors.textTertiary} value={form.wifiSSID} onChangeText={(t) => setForm({...form, wifiSSID: t})} />
                  )}
                  <View style={s.switchRow}>
                    <Text style={s.switchLabel}>Require Selfie</Text>
                    <Switch value={form.requireSelfie} onValueChange={(v) => setForm({...form, requireSelfie: v})} />
                  </View>
                </>
              )}

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
                <Text style={s.modalTitle}>Company Details</Text>
                <TouchableOpacity onPress={() => { setViewModal(false); setSelected(null); }}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
              </View>
              {selected && (
                <>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Company Overview</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Name</Text><Text style={s.detailValue}>{selected.name}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Code</Text><Text style={s.detailValue}>{selected.code}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Domain</Text><Text style={s.detailValue}>{selected.domain || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Website</Text><Text style={s.detailValue}>{selected.website || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Timezone</Text><Text style={s.detailValue}>{selected.timezone || 'Asia/Kolkata'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Currency</Text><Text style={s.detailValue}>{selected.currency || 'INR'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Employees</Text><Text style={s.detailValue}>{empCounts[selected.id] || 0}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Status</Text><Text style={[s.detailValue, { color: selected.status === 'Active' ? '#10b981' : '#ef4444' }]}>{selected.status}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Contact Information</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Admin Name</Text><Text style={s.detailValue}>{selected.adminName}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Admin Email</Text><Text style={s.detailValue}>{selected.adminEmail}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Phone</Text><Text style={s.detailValue}>{selected.phone || 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Address</Text><Text style={s.detailValue}>{selected.address || 'N/A'}</Text></View>
                    {selected.description ? (
                      <View style={s.detailRow}><Text style={s.detailLabel}>Description</Text><Text style={s.detailValue}>{selected.description}</Text></View>
                    ) : null}
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Assigned Executive & Team Leader</Text>
                    <View style={s.detailRow}>
                      <Text style={s.detailLabel}>Executive</Text>
                      <Text style={s.detailValue}>{getAssigneeName(selected.id) || 'Unassigned'}</Text>
                    </View>
                    <View style={s.detailRow}>
                      <Text style={s.detailLabel}>Team Leader(s)</Text>
                      <Text style={s.detailValue}>{getReportingTLs(selected.id).join(', ') || '—'}</Text>
                    </View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Attendance & Security</Text>
                    {(() => {
                      const att = (selected as any).attendanceSettings;
                      if (att) {
                        return (
                          <>
                            <View style={s.detailRow}><Text style={s.detailLabel}>Office Location</Text><Text style={s.detailValue}>{att.officeAddress || 'N/A'}</Text></View>
                            <View style={s.detailRow}><Text style={s.detailLabel}>Geo-fence Radius</Text><Text style={s.detailValue}>{att.radiusInMeters || 100}m</Text></View>
                            <View style={s.detailRow}><Text style={s.detailLabel}>Office Wi-Fi</Text><Text style={s.detailValue}>{att.requireWifi ? (att.wifiSSID || 'Required') : 'Not Required'}</Text></View>
                            <View style={s.detailRow}><Text style={s.detailLabel}>Mobile Data</Text><Text style={s.detailValue}>{att.allowMobileData ? 'Allowed' : 'Blocked'}</Text></View>
                            <View style={s.detailRow}><Text style={s.detailLabel}>Selfie</Text><Text style={s.detailValue}>{att.requireSelfie ? 'Required' : 'Optional'}</Text></View>
                          </>
                        );
                      }
                      return <View style={s.detailRow}><Text style={s.detailLabel}>Status</Text><Text style={[s.detailValue, { color: '#9ca3af' }]}>Not Configured</Text></View>;
                    })()}
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Payroll & Operational Rules</Text>
                    {(() => {
                      const pay = (selected as any).payrollSettings;
                      if (pay) {
                        return (
                          <>
                            <View style={s.detailRow}><Text style={s.detailLabel}>Salary Cycle</Text><Text style={s.detailValue}>{pay.salaryCycle || 'N/A'}</Text></View>
                            <View style={s.detailRow}><Text style={s.detailLabel}>Working Days / Month</Text><Text style={s.detailValue}>{pay.workingDaysPerMonth || 'N/A'} days</Text></View>
                            <View style={s.detailRow}><Text style={s.detailLabel}>Weekends</Text><Text style={s.detailValue}>{Array.isArray(pay.weekends) ? pay.weekends.join(', ') : 'N/A'}</Text></View>
                            <View style={s.detailRow}><Text style={s.detailLabel}>Overtime Rate</Text><Text style={s.detailValue}>{pay.overtimeRatePerHour ? `${pay.overtimeRatePerHour}× base pay` : 'N/A'}</Text></View>
                          </>
                        );
                      }
                      return <View style={s.detailRow}><Text style={s.detailLabel}>Status</Text><Text style={[s.detailValue, { color: '#9ca3af' }]}>Not Configured</Text></View>;
                    })()}
                    <View style={s.detailRow}><Text style={s.detailLabel}>Avg Salary (Monthly)</Text><Text style={s.detailValue}>{selected.averageSalary ? `₹${selected.averageSalary}` : 'N/A'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Mandatory Attendance</Text><Text style={s.detailValue}>{selected.mandatoryAttendanceDays !== undefined ? `${selected.mandatoryAttendanceDays} days/month` : 'N/A'}</Text></View>
                  </View>
                  <View style={s.detailSection}>
                    <Text style={s.detailSectionTitle}>Documents</Text>
                    <View style={s.detailRow}><Text style={s.detailLabel}>PAN</Text><Text style={s.detailValue}>{selected.panNumber || (selected as any).panDoc ? 'Uploaded' : 'Not provided'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>GST</Text><Text style={s.detailValue}>{selected.gstNumber || (selected as any).gstDoc ? 'Uploaded' : 'Not provided'}</Text></View>
                    <View style={s.detailRow}><Text style={s.detailLabel}>Agreement</Text><Text style={s.detailValue}>{(selected as any).agreementDoc ? 'Uploaded' : 'Not provided'}</Text></View>
                  </View>
                </>
              )}
              <View style={s.modalActions}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => { setViewModal(false); setSelected(null); }}><Text style={s.cancelBtnText}>Close</Text></TouchableOpacity>
                {selected && hasPermission('companies.edit') && (
                  <TouchableOpacity style={s.editBtn} onPress={() => { setViewModal(false); openEdit(selected); }}><Icon name="create-outline" size={16} color="#fff" /><Text style={{ color: '#fff', marginLeft: 4 }}>Edit</Text></TouchableOpacity>
                )}
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Filter Modal */}
      <Modal visible={filterModal} transparent animationType="fade" onRequestClose={() => setFilterModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSmall}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Filter Companies</Text>
              <TouchableOpacity onPress={() => setFilterModal(false)}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
            </View>
            <Text style={s.fieldLabel}>Status</Text>
            <View style={s.optionRow}>
              {STATUS_OPTIONS.map(st => (
                <TouchableOpacity key={st} style={[s.option, statusFilter === st && s.optionActive]} onPress={() => setStatusFilter(prev => prev === st ? '' : st)}>
                  <Text style={[s.optionText, statusFilter === st && { color: '#fff' }]}>{st}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.filterSwitchRow} onPress={() => setEmpFilter(prev => !prev)}>
              <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>Companies with employees</Text>
              <Switch value={empFilter} onValueChange={setEmpFilter} />
            </TouchableOpacity>
            <View style={s.modalActions}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => { setStatusFilter(''); setEmpFilter(false); }}>
                <Text style={s.cancelBtnText}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.saveBtn} onPress={() => setFilterModal(false)}>
                <Text style={s.saveBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal visible={deleteModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalSmall}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Delete Company</Text>
              <TouchableOpacity onPress={() => setDeleteModal(false)}><Icon name="close-outline" size={22} color={colors.text} /></TouchableOpacity>
            </View>
            {selected && (
              <>
                <Icon name="alert-circle-outline" size={48} color="#ef4444" style={{ alignSelf: 'center', marginBottom: 12 }} />
                <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 20 }}>
                  Are you sure you want to delete <Text style={{ fontWeight: 'bold' }}>{selected.name}</Text>? This action cannot be undone.
                </Text>
                <View style={s.modalActions}>
                  <TouchableOpacity style={s.cancelBtn} onPress={() => setDeleteModal(false)}><Text style={s.cancelBtnText}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={s.deleteConfirmBtn} onPress={handleDelete}><Text style={s.deleteConfirmBtnText}>Delete</Text></TouchableOpacity>
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
  statsRow: { paddingHorizontal: 16, marginBottom: 10, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  statCard: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 8, width: '31%', alignItems: 'center', justifyContent: 'center', height: 95 },
  statIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '700', color: c.text },
  statLabel: { fontSize: 11, color: c.textSecondary, marginTop: 2, textAlign: 'center' },
  searchRow: { marginHorizontal: 16, marginBottom: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchInputWrap: { flex: 1, minWidth: 0, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, paddingVertical: 10, color: c.text, fontSize: 15 },
  iconBtn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconBtnActive: { borderColor: '#FF6600', borderWidth: 2, backgroundColor: '#FF660015' },
  addBtn: { backgroundColor: '#FF6600', borderRadius: 12, height: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, flexShrink: 0, minWidth: 44 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  exportBtn: { backgroundColor: '#10b981', borderRadius: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  list: {},
  emptyText: { color: c.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 14, padding: 16, marginHorizontal: 16, marginBottom: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  logoCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  compName: { color: c.text, fontSize: 16, fontWeight: '600' },
  compCode: { color: c.textSecondary, fontSize: 12 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  infoGrid: { gap: 7, marginBottom: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoLabel: { color: c.textTertiary, fontSize: 12, width: 110 },
  infoValue: { flex: 1, color: c.text, fontSize: 13, fontWeight: '500' },
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderTopWidth: 1, borderTopColor: c.borderLight, paddingTop: 10, marginTop: 10 },
  viewBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#64748b15', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  viewBtnText: { color: '#64748b', fontWeight: '600', fontSize: 12 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#3b82f615', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  editBtnText: { color: '#3b82f6', fontWeight: '600', fontSize: 12 },
  delBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#ef444415', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
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
  modal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: c.card, borderRadius: 18, padding: 24 },
  modalSmall: { backgroundColor: c.card, borderRadius: 18, padding: 24, marginHorizontal: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: c.text },
  input: { backgroundColor: c.background, borderWidth: 1, borderColor: c.borderLight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, color: c.text, fontSize: 15, marginBottom: 12 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  fieldLabel: { color: c.textSecondary, fontSize: 14, marginBottom: 8, fontWeight: '600' },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: c.text, marginTop: 18, marginBottom: 12 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 10 },
  settingIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#FF660015', alignItems: 'center', justifyContent: 'center' },
  settingLabel: { color: c.textSecondary, fontSize: 13, flex: 1 },
  settingValue: { color: c.text, fontSize: 14, fontWeight: '600' },
  locationBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#3b82f615', borderWidth: 1, borderColor: '#3b82f640', borderRadius: 12, paddingVertical: 11, marginBottom: 12 },
  locationBtnText: { color: '#3b82f6', fontWeight: '700', fontSize: 14 },
  uploadWrap: { marginBottom: 12 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.background, borderWidth: 1, borderColor: c.borderLight, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  uploadBtnText: { color: '#3b82f6', fontSize: 14, fontWeight: '600', flex: 1 },
  uploadHint: { color: c.textTertiary, fontSize: 11, marginTop: 5, marginLeft: 2 },
  uploadRemove: { color: '#ef4444', fontSize: 12, fontWeight: '600', marginTop: 6, marginLeft: 2 },
  optionRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  option: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center' },
  optionActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  optionText: { color: c.textSecondary, fontSize: 14, fontWeight: '600' },
  chipSmall: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: c.borderLight, marginRight: 6, marginBottom: 4 },
  chipSmallActive: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  chipSmallText: { color: c.textSecondary, fontSize: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingVertical: 4 },
  switchLabel: { color: c.text, fontSize: 14 },
  filterSwitchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingVertical: 4 },
  sectionToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, marginBottom: 8, borderTopWidth: 1, borderTopColor: c.borderLight },
  sectionToggleText: { color: c.text, fontSize: 15, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.borderLight, alignItems: 'center' },
  cancelBtnText: { color: c.textSecondary, fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#FF6600', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold' },
  deleteConfirmBtn: { flex: 1, backgroundColor: '#ef4444', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  deleteConfirmBtnText: { color: '#fff', fontWeight: 'bold' },
  detailSection: { marginBottom: 20 },
  detailSectionTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: c.borderLight, paddingBottom: 6 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.borderLight },
  detailLabel: { fontSize: 13, color: c.textTertiary, flex: 1 },
  detailValue: { fontSize: 14, color: c.text, fontWeight: '500', flex: 1, textAlign: 'right' },
  descText: { color: c.textSecondary, fontSize: 14, lineHeight: 20 },
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
