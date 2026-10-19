import {
  collection, 
  getDocs, 
  doc, 
  getDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../config/firebase';
import type { Company, CompanyAttendanceSettings, CompanyPayrollSettings } from '../types/user';
import { generateUniqueCode } from './codeGenerator';

const COLLECTION_NAME = 'companies';
const companiesRef = collection(db, COLLECTION_NAME);

// Get all companies
export const getAllCompanies = async (): Promise<Company[]> => {
  const snapshot = await getDocs(companiesRef);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdOn: doc.data().createdOn?.toDate() || new Date()
  })) as Company[];
};

// Real-time subscription to companies
export const subscribeToCompanies = (
  onCompanies: (companies: Company[]) => void,
  onError?: (error: Error) => void
): (() => void) => {
  const unsubscribe = onSnapshot(
    companiesRef,
    (snapshot) => {
      const companies = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdOn: doc.data().createdOn?.toDate() || new Date()
      })) as Company[];
      onCompanies(companies);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
  return unsubscribe;
};

// Get companies by status
export const getCompaniesByStatus = async (status: string): Promise<Company[]> => {
  const q = query(companiesRef, where('status', '==', status));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    createdOn: doc.data().createdOn?.toDate() || new Date()
  })) as Company[];
};

// Get single company
export const getCompanyById = async (id: string): Promise<Company | null> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return {
    id: snapshot.id,
    ...snapshot.data(),
    createdOn: snapshot.data().createdOn?.toDate() || new Date()
  } as Company;
};

// Helper: strip undefined values for Firestore
const stripUndefined = (obj: Record<string, any>) => {
  return Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined));
};

// Create company
export const createCompany = async (company: Omit<Company, 'id' | 'createdOn' | 'code'> & { code?: string; createdBy?: string }): Promise<Company> => {
  const code = company.code || await generateUniqueCode('companies', 'COMP');
  const docRef = await addDoc(companiesRef, {
    ...stripUndefined({ ...company, code } as any),
    createdOn: serverTimestamp()
  });

  return {
    ...company,
    code,
    id: docRef.id,
    createdOn: new Date()
  } as Company;
};

// Update company
export const updateCompany = async (id: string, updates: Partial<Company>): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await updateDoc(docRef, stripUndefined({ ...updates, updatedAt: serverTimestamp() }));
};

// Delete company
export const deleteCompany = async (id: string): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);
};

// Delete a company AND all of its data (employees, users/accounts, departments,
// attendance, leave, payroll, assets, etc.) — runs server-side as Master Admin.
export const deleteCompanyData = async (companyId: string): Promise<any> => {
  const fn = httpsCallable(functions, 'deleteCompanyData');
  const { data } = await fn({ companyId });
  return data;
};

// Delete ALL staff of a company (executives, team-leaders, reporting-managers,
// employees + their login accounts), keeping the company itself — server-side,
// Master Admin only.
export const deleteAllCompanyStaff = async (companyId: string): Promise<any> => {
  const fn = httpsCallable(functions, 'deleteAllCompanyStaff');
  const { data } = await fn({ companyId });
  return data;
};



// Onboard a new company with embedded attendance configs in a single atomic batch
export const onboardCompany = async (data: {
  name: string
  domain: string
  phone?: string
  address?: string
  adminName: string
  adminEmail: string
  status?: 'Active' | 'Inactive'
  createdBy?: string
  createdByName?: string
  createdByRole?: string
  parentCompanyId?: string
  parentCompanyName?: string
  attendanceSettings: CompanyAttendanceSettings
}): Promise<Company> => {
  const code = await generateUniqueCode('companies', 'COMP')
  const companyId = doc(collection(db, 'companies')).id

  const batch = writeBatch(db)

  // 1. Company document with embedded configs
  const companyRef = doc(db, 'companies', companyId)
  batch.set(companyRef, {
    name: data.name,
    domain: data.domain,
    code,
    adminName: data.adminName,
    adminEmail: data.adminEmail,
    employees: 0,
    status: data.status || 'Active',
    createdOn: serverTimestamp(),
    createdBy: data.createdBy || '',
    createdByName: data.createdByName || '',
    createdByRole: data.createdByRole || '',
    logoColor: '#f97316',
    address: data.address || '',
    phone: data.phone || '',
    parentCompanyId: data.parentCompanyId || '',
    parentCompanyName: data.parentCompanyName || '',
    attendanceSettings: data.attendanceSettings,
  })

  // 2. Default departments
  const defaultDepts = [
    { name: 'HR', color: '#3b82f6', description: 'Human Resources department' },
    { name: 'Finance', color: '#10b981', description: 'Finance department' },
    { name: 'IT', color: '#8b5cf6', description: 'Information Technology department' },
    { name: 'Operations', color: '#f59e0b', description: 'Operations department' },
    { name: 'Administration', color: '#ef4444', description: 'Administration department' },
  ]
  for (const dept of defaultDepts) {
    const deptRef = doc(collection(db, 'departments'))
    batch.set(deptRef, {
      name: dept.name,
      code: dept.name.substring(0, 3).toUpperCase(),
      color: dept.color,
      companyId,
      description: dept.description,
      employeeCount: 0,
      createdBy: data.createdBy || '',
      createdByName: data.createdByName || '',
      createdByRole: data.createdByRole || '',
      teamLeaderName: data.createdByRole === 'Team Leader' ? (data.createdByName || '') : '',
      executiveName: data.createdByRole === 'Executive' ? (data.createdByName || '') : '',
      createdAt: serverTimestamp(),
    })
  }

  // 3. Default attendance policy document (backward compatibility with existing services)
  const policyRef = doc(collection(db, 'attendanceSettings'))
  batch.set(policyRef, {
    companyId,
    mode: 'gps-only',
    officeLocation: {
      name: data.attendanceSettings.officeAddress,
      address: data.attendanceSettings.officeAddress,
      latitude: data.attendanceSettings.latitude,
      longitude: data.attendanceSettings.longitude,
      radiusMeters: data.attendanceSettings.radiusInMeters,
    },
    allowedWifis: data.attendanceSettings.requireWifi
      ? [{ ssid: data.attendanceSettings.wifiSSID || '' }]
      : [],
    wifiOnly: data.attendanceSettings.requireWifi,
    mobileDataAllowed: data.attendanceSettings.allowMobileData,
    requireSelfie: data.attendanceSettings.requireSelfie,
    selfieExpirySeconds: 30,
    gracePeriodMinutes: 15,
    lateThresholdMinutes: 60,
    autoCheckoutMinutes: 0,
    enableAutoCheckout: false,
    defaultShiftStart: '09:00',
    defaultShiftEnd: '18:00',
    weekendDays: [0, 6],
    holidayCalendarId: null,
    enableGeofence: true,
    enableNetworkGuard: data.attendanceSettings.requireWifi,
    enableAntiSpoofing: true,
    enableSelfie: data.attendanceSettings.requireSelfie,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: '',
    updatedBy: '',
  })

  await batch.commit()

  return {
    id: companyId,
    name: data.name,
    domain: data.domain,
    code,
    adminName: data.adminName,
    adminEmail: data.adminEmail,
    employees: 0,
    status: data.status || 'Active',
    createdOn: new Date(),
    logoColor: '#f97316',
    address: data.address,
    phone: data.phone,
    parentCompanyId: data.parentCompanyId,
    parentCompanyName: data.parentCompanyName,
    attendanceSettings: data.attendanceSettings,
  } as Company
}

// Get company stats
export const getCompanyStats = async () => {
  const companies = await getAllCompanies();
  
  return {
    total: companies.length,
    active: companies.filter(c => c.status === 'Active').length,
    totalEmployees: companies.reduce((sum, c) => sum + (c.employees || 0), 0)
  };
};
