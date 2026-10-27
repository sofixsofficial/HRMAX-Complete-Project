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
  setDoc,
  serverTimestamp,
  onSnapshot
} from '../aws/firestore-compat';
import { httpsCallable } from '../aws/functions-compat';
import { auth, db, functions } from '../aws/clients';
import type { Employee } from '../types/user';
import { generateUniqueId } from './codeGenerator';
import { createNotification } from './notificationService';
import { logAudit } from './auditLogService';
import { toDate } from '../utils/dateUtils';

const COLLECTION_NAME = 'employees';
const employeesRef = collection(db, COLLECTION_NAME);

export const generateSlug = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employee';

const mapToEmployee = (id: string, data: any): Employee => ({
  id,
  slug: data.slug || generateSlug(data.name || ''),
  ...data,
  // Firestore stores joinDate as a Timestamp; normalize to a real Date so
  // consumers never render the raw {seconds, nanoseconds} object.
  joinDate: data.joinDate ? toDate(data.joinDate) : data.joinDate,
});

// Get all employees
export const getAllEmployees = async (): Promise<Employee[]> => {
  const snapshot = await getDocs(employeesRef);
  return snapshot.docs.map(doc => mapToEmployee(doc.id, doc.data()));
};

// Get employees by company
export const getEmployeesByCompany = async (companyId: string): Promise<Employee[]> => {
  const q = query(employeesRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => mapToEmployee(doc.id, doc.data()));
};

// Get employees by multiple companies (batches of 10 for Firestore `in` limit)
export const getEmployeesByCompanies = async (companyIds: string[]): Promise<Employee[]> => {
  const ids = [...new Set(companyIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 10) {
    batches.push(ids.slice(i, i + 10));
  }
  const results = await Promise.all(
    batches.map(async (batch) => {
      const q = query(employeesRef, where('companyId', 'in', batch));
      const snapshot = await getDocs(q);
      return snapshot.docs.map(d => mapToEmployee(d.id, d.data()));
    })
  );
  return results.flat();
};

// Get employees by department
export const getEmployeesByDepartment = async (departmentId: string): Promise<Employee[]> => {
  const q = query(employeesRef, where('departmentId', '==', departmentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => mapToEmployee(doc.id, doc.data()));
};

// A manager may be referenced on employee records by their employee-document-id
// (e.g. `cpxNm...`) OR by their auth user-uid — never assume one form. This set
// resolves both identifiers for the current manager.
export interface TeamOptions {
  companyIds?: string[]
  includeScope?: boolean
}

// Every field an employee record may use to point at its manager. Older entries
// used `reportingManagerId`; some use `managerId`; a few `supervisorId`. Matching
// all three makes the team query robust to the field-name mismatch.
const managerRefsOf = (emp: any): string[] => {
  const refs: string[] = []
  if (emp.reportingManagerId) refs.push(emp.reportingManagerId)
  if (emp.managerId) refs.push(emp.managerId)
  if (emp.supervisorId) refs.push(emp.supervisorId)
  return refs
}

// Resolve the employee-document-id(s) that belong to a manager's auth user-uid,
// so we can find reports stored under either identifier.
const resolveManagerEmployeeIds = async (managerId: string): Promise<string[]> => {
  try {
    const q = query(employeesRef, where('userId', '==', managerId))
    const snapshot = await getDocs(q)
    return snapshot.docs.map(d => d.id)
  } catch (err) {
    console.error('resolveManagerEmployeeIds error:', err)
    return []
  }
}

// Breadth-first aggregation of direct + indirect reports. Because employee
// records reference their manager by the manager's employee-document-id, walking
// the manager fields from the root identifiers collects the full reporting
// subtree (Team Leader -> Executive -> Reporting Manager -> Employees) in one pass.
export function aggregateTeam(all: any[], rootIds: string[]): Employee[] {
  const reached = new Map<string, Employee>()
  const frontier = new Set<string>(rootIds)
  let added = true
  while (added) {
    added = false
    for (const e of all) {
      if (reached.has(e.id)) continue
      if (managerRefsOf(e).some(r => frontier.has(r))) {
        reached.set(e.id, mapToEmployee(e.id, e))
        frontier.add(e.id)
        added = true
      }
    }
  }
  return Array.from(reached.values())
}

const buildCompanyEmployeeQuery = (companyIds: string[]) => {
  const ids = [...new Set((companyIds || []).filter(Boolean))]
  if (ids.length === 0) return null
  if (ids.length === 1) return query(employeesRef, where('companyId', '==', ids[0]))
  return query(employeesRef, where('companyId', 'in', ids.slice(0, 10)))
}

const fetchScopedEmployees = async (companyIds: string[]): Promise<any[]> => {
  const q = buildCompanyEmployeeQuery(companyIds)
  if (!q) return []
  try {
    const snapshot = await getDocs(q)
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('fetchScopedEmployees error:', err)
    return []
  }
}

// Real-time, hierarchy-aware subscription for a manager's team.
// Resolves the manager's employee-doc-id(s) then aggregates direct + indirect
// reports within the active company scope. Scope owners (TL / Executive /
// company-admin / master-admin) see their whole scoped team when they have no
// subtree of their own.
export const subscribeToTeamByManager = (
  managerId: string,
  callback: (employees: Employee[]) => void,
  options?: TeamOptions
): (() => void) => {
  const companyIds = options?.companyIds || []
  const includeScope = options?.includeScope ?? false
  let rootIds: string[] = [managerId]
  let unsubscribe: (() => void) | null = null
  let cancelled = false

  const start = () => {
    if (cancelled) return
    const q = buildCompanyEmployeeQuery(companyIds)
    if (!q) { callback([]); return }
    unsubscribe = onSnapshot(q, (snapshot) => {
      const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      const team = aggregateTeam(all, rootIds)
      if (team.length > 0) return callback(team)
      callback(includeScope ? all.map(e => mapToEmployee(e.id, e)) : [])
    }, (err) => {
      console.error('Team subscription error:', err)
      callback([])
    })
  }

  resolveManagerEmployeeIds(managerId)
    .then(ids => { rootIds = [managerId, ...ids]; start() })
    .catch(() => start())

  return () => {
    cancelled = true
    if (unsubscribe) { try { unsubscribe() } catch {} }
  }
};

// Get the full team (direct + indirect) by manager, within the active scope.
export const getEmployeesByManagerId = async (managerId: string, options?: TeamOptions): Promise<Employee[]> => {
  const companyIds = options?.companyIds || []
  const rootIds = [managerId, ...(await resolveManagerEmployeeIds(managerId))]
  const all = await fetchScopedEmployees(companyIds)
  const team = aggregateTeam(all, rootIds)
  if (team.length > 0) return team
  if (options?.includeScope) return all.map(e => mapToEmployee(e.id, e))
  return []
};

// Roles offered as direct-manager options for an EMPLOYEE: dedicated Reporting
// Managers plus the Company Admin of the same company (the RM -> Company Admin
// approval hierarchy), strictly scoped to the selected company. Executives and
// Team Leaders are never offered.
const MANAGER_ROLES = ['reporting-manager', 'company-admin'];
const MANAGER_ROLE_LABELS: Record<string, string> = {
  'company-admin': 'Company Admin',
  'team-leader': 'Team Leader',
  executive: 'Executive',
  'reporting-manager': 'Reporting Manager',
};

const mapUserToEmployee = (u: any, companyId: string): Employee => ({
  id: u.id,
  userId: u.id,
  slug: u.slug || '',
  name: u.name || u.email || MANAGER_ROLE_LABELS[u.role] || u.role || 'Select',
  email: u.email || '',
  avatar: u.avatar || '',
  employeeId: u.employeeId || u.designation || MANAGER_ROLE_LABELS[u.role] || (u.role || 'Manager'),
  department: u.department || '',
  departmentId: u.departmentId || '',
  departmentColor: '#f97316',
  designation: u.designation || '',
  phone: u.phone || '',
  status: u.isActive === false ? 'Inactive' : 'Active',
  joinDate: u.createdAt ? new Date(u.createdAt) : new Date(),
  companyId: String(u.companyId || companyId),
  employmentType: 'Full-time',
  role: u.role || '',
} as Employee);

const normalizeScopeKey = (val: any): string =>
  String(val || '').trim().toLowerCase().replace(/\s+/g, '');

const isUserInCompanyScope = (u: any, companyId: string, companyName?: string): boolean => {
  if (!u || !u.id || u.role === 'master-admin' || u.isActive === false) return false;
  const idMatch =
    normalizeScopeKey(u.companyId) === normalizeScopeKey(companyId) ||
    (Array.isArray(u.assignedCompanyIds) && u.assignedCompanyIds.includes(companyId)) ||
    normalizeScopeKey(u.parentCompanyId) === normalizeScopeKey(companyId);
  // Legacy records sometimes pinned the user's companyId to the company NAME
  // instead of its document id — accept that form too when the name is known.
  const nameMatch = !!companyName && (
    normalizeScopeKey(u.companyId) === normalizeScopeKey(companyName) ||
    normalizeScopeKey(u.parentCompanyId) === normalizeScopeKey(companyName)
  );
  return idMatch || nameMatch;
};

// Get the assignable manager options for an EMPLOYEE's direct manager field:
// dedicated Reporting Managers of the exact same company plus that company's
// Company Admin (RM -> Company Admin hierarchy). Never Executives or Team
// Leaders, and always scoped to the selected company.
export const getReportingManagersByCompany = async (companyId: string): Promise<Employee[]> => {
  const q = query(employeesRef, where('companyId', '==', companyId));
  const snapshot = await getDocs(q);
  const all = snapshot.docs.map(d => mapToEmployee(d.id, d.data()));

  // Dedicated reporting-manager employees of this company.
  const rmEmployees = all.filter(
    e => e.isReportingManager === true && e.status === 'Active'
  );

  // Company-scoped Reporting-Manager + Company-Admin user accounts, mapped so
  // the Company Admin appears as a selectable manager/approver for onboarding.
  let rmUsers: Employee[] = [];
  try {
    const uq = query(collection(db, 'users'), where('role', 'in', MANAGER_ROLES));
    const usnap = await getDocs(uq);
    rmUsers = usnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => isUserInCompanyScope(u, companyId))
      .map(u => mapUserToEmployee(u, companyId));
  } catch { /* users read unavailable — fall back to employee-based candidates */ }

  // Dedupe by user identity (user id when present, otherwise employee doc id).
  const seen = new Set<string>();
  const candidates: Employee[] = [];
  const push = (e: Employee) => {
    const key = e.userId || e.id;
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(e);
  };

  rmEmployees.forEach(push);
  rmUsers.forEach(push);
  return candidates;
};

// Get the Company Admins assigned to a company's scope so Reporting Manager
// profiles can select a valid admin from the selected company.
export const getCompanyAdmins = async (companyId: string, companyName?: string): Promise<Employee[]> => {
  if (!companyId) return [];
  // Accept legacy role-string drift ('Company Admin', 'company_admin') alongside
  // the canonical 'company-admin' when older onboarding paths wrote them.
  const q = query(collection(db, 'users'), where('role', 'in', ['company-admin', 'Company Admin', 'company_admin']));
  const snapshot = await getDocs(q);
  const found = snapshot.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(u => isUserInCompanyScope(u, companyId, companyName))
    .map(u => mapUserToEmployee(u, companyId));
  if (found.length > 0) return found;

  // Fallback: surface the company document's recorded admin (companies whose
  // admin account predates dedicated company-admin role accounts, or was never
  // mirrored into the users collection with a matching companyId).
  // 'global' is the master-admin scope sentinel, not a real company document —
  // fetching it only produces a pointless 404 (console noise on every
  // Employees page load for master-admin).
  if (companyId !== 'global') {
    try {
      const compSnap = await getDoc(doc(db, 'companies', companyId));
      if (compSnap.exists()) {
        const comp = compSnap.data();
        if (comp.adminId) {
          return [{
            id: comp.adminId,
            userId: comp.adminId,
            slug: '',
            name: comp.adminName || 'Company Admin',
            email: '',
            avatar: '',
            employeeId: 'Company Admin',
            department: '',
            departmentId: '',
            departmentColor: '#f97316',
            designation: '',
            phone: '',
            status: 'Active',
            joinDate: new Date(),
            companyId,
            employmentType: 'Full-time',
          } as Employee];
        }
      }
    } catch { /* company read unavailable — leave the dropdown empty */ }
  }
  return [];
};

// Get single employee by id
export const getEmployeeById = async (id: string): Promise<Employee | null> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) return null;
  return mapToEmployee(snapshot.id, snapshot.data());
};

// Get single employee by slug
export const getEmployeeBySlug = async (slug: string): Promise<Employee | null> => {
  const q = query(employeesRef, where('slug', '==', slug));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) return mapToEmployee(snapshot.docs[0].id, snapshot.docs[0].data());
  // The list's View link falls back to the document id when a record has no
  // slug yet, and older records also key on their printed employeeId - without
  // these two lookups the profile page dead-ended on "Employee not found".
  const byId = await getEmployeeById(slug);
  if (byId) return byId;
  const byEmployeeId = query(employeesRef, where('employeeId', '==', slug));
  const snapshot2 = await getDocs(byEmployeeId);
  if (snapshot2.empty) return null;
  return mapToEmployee(snapshot2.docs[0].id, snapshot2.docs[0].data());
};

// Get employee by userId
export const getEmployeeByUserId = async (userId: string): Promise<Employee | null> => {
  const q = query(employeesRef, where('userId', '==', userId));
  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return mapToEmployee(doc.id, doc.data());
};

// Generate username from employeeId (e.g., "EMP-0001" -> "EMP0001")
const generateUsername = (employeeId: string): string => {
  return employeeId.replace(/-/g, '').toUpperCase();
};

// Generate random temporary password
const generateTempPassword = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let password = 'HRM@';
  for (let i = 0; i < 4; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

// Create employee with admin-provided or auto-generated credentials
export const createEmployee = async (employee: Omit<Employee, 'id' | 'employeeId'> & { employeeId?: string }, createdBy?: { id: string; name: string; role?: string }, companyCode?: string): Promise<Employee & { tempPassword?: string }> => {
  // Permission check: verify caller has employees.create permission and company scope
  const currentUser = auth.currentUser;
  // Tag the new employee under the caller's parent company (if any). This walks
  // the parent chain: explicit parent on the caller -> caller's own company.
  let parentCompanyId: string | undefined;
  let parentCompanyName: string | undefined;
  if (currentUser && createdBy) {
    const callerDoc = await getDoc(doc(db, 'users', currentUser.uid));
    if (callerDoc.exists()) {
      const callerData = callerDoc.data();
      parentCompanyId = callerData.parentCompanyId || callerData.companyId || undefined;
      parentCompanyName = callerData.parentCompanyName || undefined;
      const isMasterAdmin = callerData.role === 'master-admin';
      // Reporting Managers can onboard staff within their own company.
      const isRmCaller = callerData.role === 'reporting-manager';
      const callerPerms: string[] = callerData.permissions || [];
      const hasCreatePerm = isMasterAdmin || isRmCaller || callerPerms.includes('employees.create') || callerPerms.includes('*');
      if (!hasCreatePerm) {
        throw new Error('Permission denied: you do not have employees.create permission');
      }
      // Company scope check for non-master-admin
      if (!isMasterAdmin && employee.companyId) {
        if (isRmCaller) {
          if (employee.companyId !== callerData.companyId) {
            throw new Error(`Permission denied: you can only add employees inside your own company`);
          }
        } else {
          const assignedCompanies: string[] = callerData.assignedCompanyIds || [];
          if (assignedCompanies.length > 0 && !assignedCompanies.includes(employee.companyId)) {
            throw new Error(`Permission denied: company ${employee.companyId} is not in your authorized scope`);
          }
        }
      }
    }
  }

  const prefix = companyCode ? `${companyCode}-${new Date().getFullYear()}` : 'EMP';
  const employeeId = employee.employeeId || await generateUniqueId('employees', prefix, 'employeeId', employee.companyId);
  const username = employee.username || generateUsername(employeeId);
  const effectivePassword = employee.password || generateTempPassword();

  // Create the auth account + users/{uid} document via the
  // createStaffUser cloud function (Admin SDK). This keeps the caller's
  // session intact — client-side createUserWithEmailAndPassword would sign
  // the admin out and break every subsequent Firestore write.
  let authUserId = employee.userId;
  // The employees document is written server-authoritatively by the same
  // callable (Admin SDK), so a client rules denial can never abort onboarding.
  const employeeProfile = Object.fromEntries(
    Object.entries({
      name: employee.name,
      email: employee.email,
      phone: (employee as any).phone || '',
      role: (employee as any).role || 'employee',
      companyId: employee.companyId,
      departmentId: employee.departmentId || null,
      department: (employee as any).department || '',
      designation: (employee as any).designation || '',
      status: employee.status || 'Active',
      joinDate: (employee.joinDate ? new Date(employee.joinDate).toISOString() : new Date().toISOString()) as string,
      birthDate: (employee as any).birthDate || '',
      employmentType: (employee as any).employmentType || 'Full-time',
      address: (employee as any).address || '',
      emergencyContactName: (employee as any).emergencyContactName || '',
      emergencyContactPhone: (employee as any).emergencyContactPhone || '',
      aadharDoc: (employee as any).aadharDoc || '',
      panDoc: (employee as any).panDoc || '',
      joiningLetterDoc: (employee as any).joiningLetterDoc || '',
      avatar: employee.avatar || '',
      isReportingManager: !!(employee as any).isReportingManager,
      reportingManagerId: (employee as any).reportingManagerId || (employee as any).managerId || '',
      reportingManagerName: (employee as any).reportingManagerName || (employee as any).managerName || '',
      monthlyLeaveEntitlements: (employee as any).monthlyLeaveEntitlements || null,
      leaveEntitlementYear: (employee as any).leaveEntitlementYear || null,
    })
      .filter(([, v]) => v !== undefined && v !== null)
  );
  let empDocId: string | undefined;
  try {
    const createStaffUser = httpsCallable(functions, 'createStaffUser');
    const { data: fnResult } = await createStaffUser({
      email: employee.email,
      password: effectivePassword,
      name: employee.name,
      username,
      phone: (employee as any).phone || '',
      role: (employee as any).role || 'employee',
      companyId: employee.companyId || undefined,
      departmentId: employee.departmentId || undefined,
      departmentName: (employee as any).department || '',
      employmentType: (employee as any).employmentType || 'Full-time',
      status: (employee as any).status || 'Active',
      joinDate: employee.joinDate ? new Date(employee.joinDate).toISOString().split('T')[0] : '',
      designation: (employee as any).designation || '',
      isReportingManager: !!(employee as any).isReportingManager,
      reportingManagerId: (employee as any).reportingManagerId || '',
      reportingManagerName: (employee as any).reportingManagerName || '',
      employeeId,
      parentCompanyId,
      parentCompanyName,
      employeeProfile,
    }) as { data: { success?: boolean; uid?: string; empId?: string | null; error?: string } };
    if (!fnResult?.success || !fnResult.uid) {
      throw new Error(fnResult?.error || 'Failed to create staff account');
    }
    authUserId = fnResult.uid;
    empDocId = fnResult.empId || undefined;
  } catch (authError: any) {
    const msg = String(authError?.message || '');
    if (msg.includes('already-exists') || msg.includes('already registered')) {
      console.warn('Email already exists in Auth, using existing userId');
      // Look up the existing Auth user's UID by email
      try {
        const userQuery = query(collection(db, 'users'), where('email', '==', employee.email));
        const userSnap = await getDocs(userQuery);
        if (!userSnap.empty) {
          authUserId = userSnap.docs[0].id;
        } else {
          throw new Error('This email is already registered but no matching user was found.');
        }
      } catch (lookupErr: any) {
        if (lookupErr?.message?.includes('already registered')) throw lookupErr;
        throw new Error(lookupErr?.message || 'Failed to look up existing user for this email.');
      }
    } else if (authError?.code === 'functions/failed-precondition' || msg.includes('assigned companies')) {
      throw new Error(msg.includes('assigned companies')
        ? 'You can only create staff inside your assigned companies'
        : 'Failed to create staff account');
    } else if (authError?.code === 'unavailable' || msg.toLowerCase().includes('network')) {
      console.error('Auth account creation failed (network):', authError.message);
      throw new Error('Network error while creating the staff login. Please try again.');
    } else {
      console.error('CRITICAL: staff account creation FAILED for', employee.email, ':', msg);
      throw new Error(msg || 'Failed to create staff login account');
    }
  }

  const slug = generateSlug(employee.name);

  const creatorRole = createdBy?.role === 'team-leader' ? 'Team Leader'
    : createdBy?.role === 'executive' ? 'Executive'
    : createdBy?.role === 'master-admin' ? 'Master Admin'
    : createdBy?.role === 'company-admin' ? 'Company Admin'
    : createdBy?.role === 'reporting-manager' ? 'Reporting Manager'
    : 'Admin'

  // Strip undefined/null values before Firestore write (addDoc rejects undefined)
  const cleanData = Object.fromEntries(
    Object.entries({
      ...employee,
      slug,
      employeeId,
      userId: authUserId,
      username,
      password: effectivePassword,
      joinDate: employee.joinDate || new Date(),
      status: employee.status || 'Active',
      parentCompanyId,
      parentCompanyName,
      createdBy: createdBy?.id || '',
      createdByName: createdBy?.name || '',
      createdByRole: creatorRole,
    })
      .filter(([, v]) => v !== undefined && v !== null)
  );

  const docRefEmployees = employeesRef;
  // Server-authoritative write: the callable already created the employees doc.
  // Fall back to a client addDoc only when hitting a function build that did not
  // return an empId (e.g. rolled-back deployment or duplicate-email reuse path).
  let employeeDocId: string;
  if (empDocId) {
    employeeDocId = empDocId;
  } else {
    try {
      const docRef = await addDoc(docRefEmployees, cleanData);
      employeeDocId = docRef.id;
    } catch (fbErr: any) {
      // A Firestore rules denial here must not surface as a raw "Missing or
      // insufficient permissions". The cloud function already created the
      // Auth + users/{uid} records, so a client-side employee write failing
      // leaves the record orphaned — report that clearly instead.
      const isPermErr =
        String(fbErr?.code || '').includes('permission') ||
        String(fbErr?.message || '').includes('Missing or insufficient permissions');
      if (isPermErr) {
        console.error('Client addDoc fallback denied by rules:', fbErr);
        throw new Error(
          `The employee login was created, but the employee record could not be finalized due to a permission issue. ` +
          `Please refresh and check the employee list — if missing, contact a Master Admin to finalize the record.`
        );
      }
      throw new Error(fbErr?.message || 'Failed to create the employee record');
    }
  }

  // Send notification to admin about new credentials
  if (createdBy) {
    try {
      await createNotification(
        createdBy.id,
        'general',
        'New Employee Created',
        `${employee.name} has been added. Username: ${username}, Password: ${effectivePassword}`,
        `/employees`,
        employee.companyId || ''
      );
    } catch (notifError) {
      console.warn('Notification creation failed:', notifError);
    }
  }

  return {
    ...employee,
    employeeId,
    userId: authUserId,
    username,
    id: employeeDocId,
    tempPassword: effectivePassword
  } as Employee & { tempPassword?: string };
};

// Remove undefined values — Firestore updateDoc rejects them outright
const stripUndefined = (obj: Record<string, any>): Record<string, any> => {
  const out: Record<string, any> = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined) out[k] = v;
  });
  return out;
};

// Update employee with audit logging
export const updateEmployee = async (
  id: string,
  updates: Partial<Employee>,
  auditInfo?: { userId: string; userName: string; userRole: string; companyId: string }
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);
  const sanitized = stripUndefined(updates as Record<string, any>);
  delete sanitized.password; // passwords are managed by the auth service only
  await updateDoc(docRef, sanitized);

  if (auditInfo) {
    logAudit({
      userId: auditInfo.userId,
      userName: auditInfo.userName,
      userRole: auditInfo.userRole,
      action: `Updated employee ${id}`,
      actionType: 'update',
      module: 'Employees',
      targetEntity: 'Employee',
      targetId: id,
      companyId: auditInfo.companyId,
      details: `Updated fields: ${Object.keys(sanitized).join(', ')}`,
      status: 'success',
    });
  }
};

// Delete employee with audit logging
export const deleteEmployee = async (
  id: string,
  auditInfo?: { userId: string; userName: string; userRole: string; companyId: string }
): Promise<void> => {
  const docRef = doc(db, COLLECTION_NAME, id);

  // Read the doc before deleting for audit context
  let employeeName = '';
  let companyId = auditInfo?.companyId || '';
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data();
      employeeName = data.name || '';
      companyId = companyId || data.companyId || '';
    }
  } catch { /* silent */ }

  await deleteDoc(docRef);

  if (auditInfo) {
    logAudit({
      userId: auditInfo.userId,
      userName: auditInfo.userName,
      userRole: auditInfo.userRole,
      action: `Deleted employee ${employeeName || id}`,
      actionType: 'delete',
      module: 'Employees',
      targetEntity: 'Employee',
      targetId: id,
      companyId,
      details: `Deleted employee: ${employeeName || 'Unknown'}`,
      status: 'success',
    });
  }
};

// Get employee stats
export const getEmployeeStats = async (companyId?: string) => {
  if (!companyId) return { total: 0, active: 0, inactive: 0, onLeave: 0 };
  const employees = await getEmployeesByCompany(companyId);
  
  return {
    total: employees.length,
    active: employees.filter(e => e.status === 'Active').length,
    inactive: employees.filter(e => e.status === 'Inactive').length,
    onLeave: employees.filter(e => e.status === 'On Leave').length
  };
};
