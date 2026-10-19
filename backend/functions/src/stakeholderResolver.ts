import * as admin from 'firebase-admin';

const db = admin.firestore();

/**
 * The full recipient chain for an employee-driven event (leave application,
 * missed punch / attendance alert). Scoped strictly to the employee's company
 * and its permission hierarchy:
 *   - the employee themselves
 *   - their direct Reporting Manager
 *   - the assigned Executive(s) for that company
 *   - the Team Leaders linked to those Executives (plus any TL scoped to the company)
 *   - the Company Admin(s) for that company
 *   - all Master Admins (platform-wide)
 */
export interface ManagementStakeholders {
  employeeUserId: string;
  employeeName: string;
  reportingManagerId: string | null;
  executiveIds: string[];
  teamLeaderIds: string[];
  companyAdminIds: string[];
  masterAdminIds: string[];
}

/**
 * Single source of truth for resolving the management recipient chain of an
 * employee action. Used by BOTH the leave triggers and the attendance /
 * missed-punch triggers so the two paths can never drift apart.
 */
export async function resolveManagementStakeholders(
  companyId: string,
  employeeUserId: string,
  employeeName: string,
): Promise<ManagementStakeholders> {
  const result: ManagementStakeholders = {
    employeeUserId,
    employeeName,
    reportingManagerId: null,
    executiveIds: [],
    teamLeaderIds: [],
    companyAdminIds: [],
    masterAdminIds: [],
  };

  // ---- Employee doc -> reporting manager ----
  const empSnap = await db.collection('employees')
    .where('userId', '==', employeeUserId)
    .limit(1)
    .get();
  if (!empSnap.empty) {
    const emp = empSnap.docs[0].data();
    if (emp.reportingManagerId) result.reportingManagerId = String(emp.reportingManagerId);
    if (emp.name) result.employeeName = String(emp.name);
  }
  // Fall back to the user doc if the employees record was not found.
  if (!result.reportingManagerId) {
    const userDoc = await db.collection('users').doc(employeeUserId).get();
    if (userDoc.exists) {
      const u = userDoc.data() || {};
      if (u.reportingManagerId) result.reportingManagerId = String(u.reportingManagerId);
      if (!result.employeeName && u.name) result.employeeName = String(u.name);
    }
  }

  // reportingManagerId is stored as the manager's employee-document-id (not the
  // auth user uid). Resolve to the auth uid so it matches users collection docs.
  if (result.reportingManagerId) {
    const directUserDoc = await db.collection('users').doc(result.reportingManagerId).get();
    if (!directUserDoc.exists) {
      // Not a user doc — try resolving as employee-document-id → auth uid
      const rmEmpDoc = await db.collection('employees').doc(result.reportingManagerId).get();
      if (rmEmpDoc.exists) {
        const rmEmp = rmEmpDoc.data() || {};
        if (rmEmp.userId) result.reportingManagerId = String(rmEmp.userId);
      } else {
        result.reportingManagerId = null;
      }
    }
  }

  // Confirm the reporting manager is actually a manager.
  if (result.reportingManagerId) {
    const rmDoc = await db.collection('users').doc(result.reportingManagerId).get();
    if (!rmDoc.exists) {
      result.reportingManagerId = null;
    } else {
      const rm = rmDoc.data() || {};
      const isManager = rm.role === 'reporting-manager' || rm.isReportingManager === true;
      if (!isManager) result.reportingManagerId = null;
    }
  }

  // ---- Company doc -> assigned executive / company admin ----
  const companyDoc = await db.collection('companies').doc(companyId).get();
  const execIds: string[] = [];
  if (companyDoc.exists) {
    const company = companyDoc.data() || {};
    if (company.assignedExecutiveId) {
      result.executiveIds.push(String(company.assignedExecutiveId));
      execIds.push(String(company.assignedExecutiveId));
    }
    if (company.assignedExecutiveIds && Array.isArray(company.assignedExecutiveIds)) {
      for (const eid of company.assignedExecutiveIds) {
        if (eid && !result.executiveIds.includes(String(eid))) {
          result.executiveIds.push(String(eid));
          execIds.push(String(eid));
        }
      }
    }
    if (company.adminId) result.companyAdminIds.push(String(company.adminId));
  }

  // Fall back: find executives assigned to this company via users.assignedCompanyIds.
  if (execIds.length === 0) {
    try {
      const execSnap = await db.collection('users')
        .where('role', '==', 'executive')
        .get();
      for (const d of execSnap.docs) {
        const u = d.data() || {};
        const assigned: string[] = Array.isArray(u.assignedCompanyIds) ? u.assignedCompanyIds : [];
        if (assigned.includes(companyId)) {
          result.executiveIds.push(d.id);
          execIds.push(d.id);
        }
      }
    } catch {
      /* index fallback only */
    }
  }

  // ---- Team leaders scoped to the company ----
  // Primary: executives' assignedTeamLeaderIds. Secondary: TLs whose linked
  // executive / reportingExecutiveId belongs to this company's executive, or
  // whose assignedCompanyIds includes this company.
  const tls = new Set<string>();
  for (const eid of execIds) {
    const execDoc = await db.collection('users').doc(eid).get();
    if (execDoc.exists) {
      const e = execDoc.data() || {};
      const assignedTLs: string[] = Array.isArray(e.assignedTeamLeaderIds) ? e.assignedTeamLeaderIds : [];
      for (const t of assignedTLs) if (t) tls.add(String(t));
    }
  }
  try {
    const tlSnap = await db.collection('users')
      .where('role', '==', 'team-leader')
      .get();
    for (const d of tlSnap.docs) {
      const u = d.data() || {};
      const linked: string[] = Array.isArray(u.linkedExecutiveIds) ? u.linkedExecutiveIds : [];
      const reportingExec = u.reportingExecutiveId ? [String(u.reportingExecutiveId)] : [];
      const execSet = new Set([...linked, ...reportingExec].map(String));
      if (execSet.size && [...execSet].some(e => execIds.includes(e))) {
        tls.add(d.id);
      }
      const assignedCompanies: string[] = Array.isArray(u.assignedCompanyIds) ? u.assignedCompanyIds : [];
      if (assignedCompanies.includes(companyId)) tls.add(d.id);
    }
  } catch {
    /* fallback best-effort */
  }
  result.teamLeaderIds = [...tls];

  // ---- Company admins (role-based, same company) ----
  try {
    const caSnap = await db.collection('users')
      .where('companyId', '==', companyId)
      .where('role', '==', 'company-admin')
      .get();
    for (const d of caSnap.docs) {
      if (!result.companyAdminIds.includes(d.id)) result.companyAdminIds.push(d.id);
    }
  } catch {
    /* best-effort */
  }

  // ---- Master admins (platform-wide) ----
  try {
    const maSnap = await db.collection('users')
      .where('role', '==', 'master-admin')
      .get();
    for (const d of maSnap.docs) result.masterAdminIds.push(d.id);
  } catch {
    /* best-effort */
  }

  return result;
}