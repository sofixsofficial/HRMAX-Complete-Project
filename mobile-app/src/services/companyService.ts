import {
  collection, getDocs, getDoc, doc, query, where,
  onSnapshot,
} from '../aws/firestore-compat';
import { ref, uploadBytes, getDownloadURL } from '../aws/storage-compat';
import type { ApprovalChainConfig } from '../utils/approvalChains';
import { db, storage } from '../aws/clients';
import { httpsCallable } from '../aws/functions-compat';
import { functions } from '../aws/clients';

const COLLECTION_NAME = 'companies';
const companiesRef = collection(db, COLLECTION_NAME);

export interface Company {
  id: string;
  name: string;
  code: string;
  domain?: string;
  phone?: string;
  website?: string;
  address?: string;
  country?: string;
  state?: string;
  city?: string;
  zipCode?: string;
  establishmentDate?: string;
  timezone?: string;
  currency?: string;
  dateFormat?: string;
  language?: string;
  adminName: string;
  adminEmail: string;
  adminPhone?: string;
  employeeLimit?: number;
  employees?: number;
  status: string;
  logoColor?: string;
  logoUrl?: string;
  description?: string;
  averageSalary?: number;
  mandatoryAttendanceDays?: number;
  panNumber?: string;
  panDoc?: string;
  gstNumber?: string;
  gstDoc?: string;
  agreementDoc?: string;
  assignedExecutiveId?: string;
  assignedExecutiveName?: string;
  createdAt?: any;
  updatedAt?: any;
}

const mapCompany = (d: any): Company => ({
  id: d.id,
  ...d.data(),
  createdAt: d.data().createdOn?.toDate?.() || d.data().createdAt?.toDate?.() || new Date(),
});

export const getAllCompanies = async (): Promise<Company[]> => {
  const snap = await getDocs(companiesRef);
  return snap.docs.map(mapCompany);
};

export const subscribeToCompanies = (
  callback: (companies: Company[]) => void,
  onError?: (error: Error) => void
): (() => void) => {
  const unsub = onSnapshot(
    companiesRef,
    (snap) => callback(snap.docs.map(mapCompany)),
    (error) => { if (onError) onError(error); }
  );
  return unsub;
};

export const getCompanyById = async (id: string): Promise<Company | null> => {
  const snap = await getDoc(doc(db, COLLECTION_NAME, id));
  if (!snap.exists()) return null;
  return mapCompany(snap);
};

export const createCompany = async (data: Partial<Company>): Promise<Company> => {
  const callableFn = httpsCallable(functions, 'mobileCreateCompany');
  const result = await callableFn({
    ...data,
    employees: data.employees || 0,
    status: data.status || 'Active',
  });
  return { ...data, id: result.data as string } as Company;
};

export const updateCompany = async (id: string, data: Partial<Company>): Promise<void> => {
  const { id: _ignore, createdOn: _c, createdAt: _ca, ...clean } = data as any;
  const callableFn = httpsCallable(functions, 'mobileUpdateCompany');
  await callableFn({ companyId: id, ...clean });
};

export const deleteCompany = async (id: string): Promise<void> => {
  const callableFn = httpsCallable(functions, 'mobileDeleteCompany');
  await callableFn({ companyId: id });
};

export const uploadCompanyDocument = async (
  companyId: string,
  folder: 'pan' | 'gst' | 'agreement',
  file: { uri: string; name: string; mimeType?: string }
): Promise<string> => {
  const safeName = (file.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
  const storageRef = ref(storage, `company-docs/${companyId}/${folder}/${Date.now()}_${safeName}`);
  const response = await fetch(file.uri);
  const blob = await response.blob();
  await uploadBytes(storageRef, blob, { contentType: file.mimeType || blob.type || 'application/octet-stream' });
  return getDownloadURL(storageRef);
};

export const onboardCompany = async (data: {
  companyId?: string;
  name: string;
  code?: string;
  domain: string;
  phone?: string;
  address?: string;
  adminName: string;
  adminEmail: string;
  status?: 'Active' | 'Inactive';
  description?: string;
  website?: string;
  country?: string;
  state?: string;
  city?: string;
  zipCode?: string;
  adminPhone?: string;
  establishmentDate?: string;
  employeeLimit?: number;
  employees?: number;
  timezone?: string;
  currency?: string;
  language?: string;
  averageSalary?: number;
  mandatoryAttendanceDays?: number;
  panNumber?: string;
  gstNumber?: string;
  panDoc?: string;
  gstDoc?: string;
  agreementDoc?: string;
  logoColor?: string;
  approvalChains?: ApprovalChainConfig;
  attendanceSettings: {
    officeAddress: string;
    latitude: number;
    longitude: number;
    radiusInMeters: number;
    allowMobileData: boolean;
    requireWifi: boolean;
    wifiSSID?: string;
    requireSelfie: boolean;
    requireGps?: boolean;
    requireQr?: boolean;
    defaultShiftStart?: string;
    defaultShiftEnd?: string;
    gracePeriodMinutes?: number;
  };
}): Promise<Company> => {
  const callableFn = httpsCallable(functions, 'mobileOnboardCompany');
  const result = await callableFn({ ...data });
  const companyId = result.data as string;
  return {
    id: companyId,
    name: data.name,
    code: data.code || '',
    domain: data.domain,
    adminName: data.adminName,
    adminEmail: data.adminEmail,
    employees: 0,
    status: data.status || 'Active',
    phone: data.phone || '',
    address: data.address || '',
    description: data.description || '',
    logoColor: data.logoColor || '#FF6600',
  } as Company;
};

export const getCompanyStats = async () => {
  const companies = await getAllCompanies();
  return {
    total: companies.length,
    active: companies.filter(c => c.status === 'Active').length,
    totalEmployees: companies.reduce((sum, c) => sum + (c.employees || 0), 0),
  };
};
