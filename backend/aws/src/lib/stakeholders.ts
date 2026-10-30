/**
 * Stakeholder resolution — single source of truth for notification fan-out
 * (port of backend/functions/src/stakeholderResolver.ts).
 */

import { queryEntities, getUserDoc, getEntity, usersByRole } from './db.js';

/**
 * Roles the employee form's Manager section may select (frontend
 * MANAGER_ROLES). A Company Admin or HR chosen as manager IS the employee's
 * attendance/leave approver — rejecting them here silently dropped the
 * check-in/out + leave notification fan-out to the manager inbox.
 */
const MANAGER_ROLES = new Set(['reporting-manager', 'company-admin', 'hr']);

export interface Stakeholders {
  employeeUserId: string;
  employeeName: string;
  reportingManagerId: string | null;
  /** HR accounts of the company — the tier between the reporting manager and the company admin. */
  hrIds: string[];
  executiveIds: string[];
  teamLeaderIds: string[];
  companyAdminIds: string[];
  masterAdminIds: string[];
}

export async function resolveStakeholders(
  companyId: string,
  employeeUserId: string,
  employeeName = '',
): Promise<Stakeholders> {
  const out: Stakeholders = {
    employeeUserId,
    employeeName,
    reportingManagerId: null,
    hrIds: [],
    executiveIds: [],
    teamLeaderIds: [],
    companyAdminIds: [],
    masterAdminIds: [],
  };

  // Employee record → reporting manager
  const employees = await queryEntities<Record<string, unknown>>({
    entity: 'employee',
    companyId,
    filters: { userId: employeeUserId },
    limit: 1,
  });
  let empDoc: Record<string, unknown> | undefined = employees[0];

  // Fallback: employee rows created before Create Employee provisioned the
  // login carry `userId: ""`, so the lookup above misses and the fan-out
  // silently falls back to the (often stale) user-doc manager. Match the row
  // by the account's email / username instead — same human, same company.
  if (!empDoc) {
    const acct = await getUserDoc(employeeUserId);
    const raw = [acct?.email, acct?.username].map((v) => String(v ?? '').trim()).filter(Boolean);
    const keys = [...new Set([...raw, ...raw.map((v) => v.toLowerCase())])];
    for (const key of keys) {
      for (const field of ['email', 'username'] as const) {
        const hits = await queryEntities<Record<string, unknown>>({
          entity: 'employee',
          companyId,
          filters: { [field]: key },
          limit: 1,
        }).catch(() => [] as Record<string, unknown>[]);
        if (hits[0]) { empDoc = hits[0]; break; }
      }
      if (empDoc) break;
    }
  }

  let rmId = (empDoc?.reportingManagerId as string) ?? null;
  if (rmId) {
    // If it points at an employee-doc id, resolve to the auth uid
    if (empDoc && empDoc.id === rmId) rmId = String(empDoc.userId ?? rmId);
    const rmUser = await getUserDoc(rmId);
    if (rmUser && (MANAGER_ROLES.has(String(rmUser.role ?? '')) || rmUser.isReportingManager)) {
      out.reportingManagerId = rmId;
    }
  }
  if (!out.reportingManagerId) {
    const userDoc = await getUserDoc(employeeUserId);
    const fallbackRm = (userDoc?.reportingManagerId as string) ?? null;
    if (fallbackRm) {
      const rmUser = await getUserDoc(fallbackRm);
      if (rmUser && (MANAGER_ROLES.has(String(rmUser.role ?? '')) || rmUser.isReportingManager)) {
        out.reportingManagerId = fallbackRm;
      }
    }
  }

  // Executives — from company assignment, else all users with role whose
  // assignedCompanyIds contains company.
  // Companies are stored at their own-id partition (companyId === id), not 'global'.
  const companyDoc = await getEntity<Record<string, unknown>>('company', companyId, companyId).catch(() => null);

  const execSet = new Set<string>();
  const assignedExec = (companyDoc?.assignedExecutiveId as string) ?? null;
  if (assignedExec) execSet.add(assignedExec);
  for (const e of ((companyDoc?.assignedExecutiveIds as string[]) ?? [])) execSet.add(e);

  if (execSet.size === 0) {
    // GSI2 role lookup (usersByRole) — non-MA users live in their own
    // company partition, so a 'global'-partition query would never see them.
    const executives = await usersByRole('executive').catch(() => [] as Record<string, unknown>[]);
    for (const u of executives) {
      const assigned = (u.assignedCompanyIds as string[]) ?? [];
      if (assigned.includes(companyId)) execSet.add(String(u.id));
    }
  }
  out.executiveIds = [...execSet];

  // Team leaders — via executives' assignedTeamLeaderIds + users linked to those execs
  const tlSet = new Set<string>();
  for (const execId of out.executiveIds) {
    const execUser = await getUserDoc(execId);
    for (const tl of ((execUser?.assignedTeamLeaderIds as string[]) ?? [])) tlSet.add(tl);
  }
  const allTLs = await usersByRole('team-leader').catch(() => [] as Record<string, unknown>[]);
  for (const tl of allTLs) {
    const linked = (tl.linkedExecutiveIds as string[]) ?? [];
    const repExec = (tl.reportingExecutiveId as string) ?? null;
    if (linked.some((e) => execSet.has(e)) || (repExec && execSet.has(repExec))) tlSet.add(String(tl.id));
    const assigned = (tl.assignedCompanyIds as string[]) ?? [];
    if (assigned.includes(companyId)) tlSet.add(String(tl.id));
    // Company-bound TL (own companyId): TLs are system-level MA-created
    // accounts that punch/serve a company — without this, a TL holding no
    // executive links would never resolve and the Team Leader tier of every
    // chain would silently skip.
    const ownCid = String((tl.companyId as string) ?? '');
    if (ownCid && ownCid !== 'global' && ownCid === companyId) tlSet.add(String(tl.id));
  }
  out.teamLeaderIds = [...tlSet];

  // Company admins
  const admins = await queryEntities<Record<string, unknown>>({
    entity: 'user',
    companyId,
    filters: { role: 'company-admin' },
    limit: 50,
  }).catch(() => [] as Record<string, unknown>[]);
  out.companyAdminIds = admins.map((a) => String(a.id));
  const adminId = (companyDoc?.adminId as string) ?? null;
  if (adminId && !out.companyAdminIds.includes(adminId)) out.companyAdminIds.push(adminId);

  // HR accounts of this company (the approval tier between the reporting
  // manager and the company admin). HR users live in their own company
  // partition, exactly like company admins — same role query, same shape.
  const hrs = await queryEntities<Record<string, unknown>>({
    entity: 'user',
    companyId,
    filters: { role: 'hr' },
    limit: 50,
  }).catch(() => [] as Record<string, unknown>[]);
  out.hrIds = hrs.map((h) => String(h.id));

  // Master admins (platform-wide)
  const masters = await queryEntities<Record<string, unknown>>({
    entity: 'user',
    companyId: 'global',
    filters: { role: 'master-admin' },
    limit: 100,
  }).catch(() => [] as Record<string, unknown>[]);
  out.masterAdminIds = masters.map((m) => String(m.id));

  return out;
}
