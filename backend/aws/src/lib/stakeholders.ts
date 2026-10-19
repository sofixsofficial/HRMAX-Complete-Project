/**
 * Stakeholder resolution — single source of truth for notification fan-out
 * (port of backend/functions/src/stakeholderResolver.ts).
 */

import { queryEntities, getUserDoc, getEntity, usersByRole } from './db.js';

export interface Stakeholders {
  employeeUserId: string;
  employeeName: string;
  reportingManagerId: string | null;
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
  let rmId = (employees[0]?.reportingManagerId as string) ?? null;
  if (rmId) {
    // If it points at an employee-doc id, resolve to the auth uid
    const rmDoc = employees.find((e) => e.id === rmId);
    if (rmDoc) rmId = String(rmDoc.userId ?? rmId);
    const rmUser = await getUserDoc(rmId);
    if (rmUser && rmUser.role === 'reporting-manager') {
      out.reportingManagerId = rmId;
    } else if (rmUser?.isReportingManager) {
      out.reportingManagerId = rmId;
    }
  }
  if (!out.reportingManagerId) {
    const userDoc = await getUserDoc(employeeUserId);
    const fallbackRm = (userDoc?.reportingManagerId as string) ?? null;
    if (fallbackRm) {
      const rmUser = await getUserDoc(fallbackRm);
      if (rmUser && (rmUser.role === 'reporting-manager' || rmUser.isReportingManager)) {
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
