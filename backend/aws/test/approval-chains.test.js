/**
 * Default approval-chain tests (node:test, offline, no AWS calls).
 *
 * The product's required sequential chains, asserted against the ONE server
 * function that builds them (computeInitialApproval — the same code path
 * POST /api/leave-requests runs, so the UI can never diverge from it):
 *
 *   employee           -> reporting manager -> HR -> company admin -> executive -> team leader
 *   reporting manager  -> HR -> company admin -> executive -> team leader
 *   HR                 -> company admin -> executive -> team leader
 *   executive          -> team leader -> master-admin gate
 *   team leader        -> (all auto-approved) -> master-admin gate
 *
 * Tiers beyond the last required approver must be Skipped, never Pending —
 * that is what makes the x/N progress and "who approves next" correct.
 *
 * Usage: npm test --prefix backend/aws   (requires: npm run build)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TABLE_NAME = process.env.TABLE_NAME ?? 'HRMAX';
process.env.COGNITO_USER_POOL_ID ??= 'ap-southeast-2_TESTPOOL';
process.env.HRMAX_DISABLE_RATE_LIMIT ??= '1';

const { computeInitialApproval } = await import('../dist/handlers/leave.js');
const { TIER_ORDER, resolveApprovalChain, DEFAULT_APPROVAL_CHAINS, REQUESTER_ROLES } = await import('../dist/lib/types.js');

const input = {
  companyId: 'comp1',
  userId: 'emp1',
  type: 'casual',
  startDate: '2026-11-02',
  endDate: '2026-11-03',
  totalDays: 2,
  reason: 'family work',
};

/** Fully staffed company: every tier has exactly one approver. */
const staffed = {
  employeeUserId: 'emp1',
  employeeName: 'Test Employee',
  reportingManagerId: 'rm1',
  hrIds: ['hr1'],
  companyAdminIds: ['ca1'],
  executiveIds: ['ex1'],
  teamLeaderIds: ['tl1'],
  masterAdminIds: ['ma1'],
};

test('employee chain: RM -> HR -> company admin -> executive -> team leader (5 tiers)', async () => {
  const r = await computeInitialApproval(input, 'employee', staffed);
  assert.equal(r.approvalStatus.reportingManager, 'Pending');
  assert.equal(r.approvalStatus.hr, 'Pending');
  assert.equal(r.approvalStatus.companyAdmin, 'Pending');
  assert.equal(r.approvalStatus.executive, 'Pending', 'executive tier is live in the employee chain (system-level)');
  assert.equal(r.approvalStatus.teamLeader, 'Pending', 'team-leader tier is live in the employee chain (system-level)');
  assert.equal(r.approverIds.hr, 'hr1');
  assert.equal(r.masterAdminRequired, false);
  assert.equal(r.applicantRole, 'employee');
});

test('reporting manager chain: HR -> company admin -> executive -> team leader (4 tiers, own tier skipped)', async () => {
  const r = await computeInitialApproval(input, 'reporting-manager', staffed);
  assert.equal(r.approvalStatus.reportingManager, 'Skipped', 'an RM does not approve their own leave');
  assert.equal(r.approvalStatus.hr, 'Pending');
  assert.equal(r.approvalStatus.companyAdmin, 'Pending');
  assert.equal(r.approvalStatus.executive, 'Pending');
  assert.equal(r.approvalStatus.teamLeader, 'Pending');
  assert.equal(r.masterAdminRequired, false);
});

test('reporting manager chain is stable even with no manager configured above', async () => {
  const r = await computeInitialApproval(input, 'reporting-manager', { ...staffed, reportingManagerId: null });
  assert.equal(r.approvalStatus.reportingManager, 'Skipped');
  assert.equal(r.approvalStatus.hr, 'Pending');
  assert.equal(r.approvalStatus.companyAdmin, 'Pending');
  assert.equal(r.approvalStatus.executive, 'Pending');
  assert.equal(r.approvalStatus.teamLeader, 'Pending');
});

test('HR chain: company admin -> executive -> team leader (3 tiers)', async () => {
  const r = await computeInitialApproval(input, 'hr', staffed);
  assert.equal(r.approvalStatus.reportingManager, 'Skipped');
  assert.equal(r.approvalStatus.hr, 'Skipped', 'no self-approval of your own HR tier');
  assert.equal(r.approvalStatus.companyAdmin, 'Pending');
  assert.equal(r.approvalStatus.executive, 'Pending');
  assert.equal(r.approvalStatus.teamLeader, 'Pending');
  assert.equal(r.masterAdminRequired, false);
});

test('executive chain: team leader -> master-admin gate', async () => {
  const r = await computeInitialApproval(input, 'executive', staffed);
  assert.equal(r.approvalStatus.reportingManager, 'Approved');
  assert.equal(r.approvalStatus.hr, 'Approved');
  assert.equal(r.approvalStatus.companyAdmin, 'Approved');
  assert.equal(r.approvalStatus.executive, 'Approved');
  assert.equal(r.approvalStatus.teamLeader, 'Pending');
  assert.equal(r.masterAdminRequired, true);
  assert.equal(r.masterAdminApproveStatus, 'Pending');
});

test('team leader chain: all tiers auto-approved -> master-admin gate', async () => {
  const r = await computeInitialApproval(input, 'team-leader', staffed);
  for (const t of TIER_ORDER) assert.equal(r.approvalStatus[t], 'Approved');
  assert.equal(r.masterAdminRequired, true);
  assert.equal(r.masterAdminApproveStatus, 'Pending');
});

test('unassigned HR account: EVERY chain tier still stays Pending (nothing is ever skipped)', async () => {
  const r = await computeInitialApproval(input, 'employee', { ...staffed, hrIds: [] });
  assert.equal(r.approvalStatus.hr, 'Pending', 'an unassigned slot must remain Pending, not Skipped');
  assert.equal(r.approvalStatus.companyAdmin, 'Pending');
  assert.equal(r.approvalStatus.executive, 'Pending');
  assert.equal(r.approvalStatus.teamLeader, 'Pending');
  assert.equal(r.approverIds.hr ?? null, null);
});

test('TIER_ORDER has the HR tier between the reporting manager and the company admin', () => {
  assert.deepEqual(TIER_ORDER, ['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader']);
});

// ── Configurable approval chains (company policy override) ──────────────────

test('company override replaces the employee chain (skip RM + HR, company admin only)', async () => {
  const chains = { employee: ['companyAdmin'] };
  const r = await computeInitialApproval(input, 'employee', staffed, chains);
  assert.equal(r.approvalStatus.reportingManager, 'Skipped');
  assert.equal(r.approvalStatus.hr, 'Skipped');
  assert.equal(r.approvalStatus.companyAdmin, 'Pending');
  assert.equal(r.approvalStatus.executive, 'Skipped');
  assert.equal(r.approvalStatus.teamLeader, 'Skipped');
});

test('override is de-duplicated and re-ordered into canonical TIER_ORDER', async () => {
  // Authored out of order + with a duplicate; must resolve to the canonical subset.
  const chains = { employee: ['companyAdmin', 'hr', 'companyAdmin', 'bogus-tier'] };
  const chain = resolveApprovalChain('employee', chains);
  assert.deepEqual(chain, ['hr', 'companyAdmin']);
});

test('an empty or non-array override falls back to the shipped default', () => {
  assert.deepEqual(resolveApprovalChain('employee', { employee: [] }), DEFAULT_APPROVAL_CHAINS.employee);
  assert.deepEqual(resolveApprovalChain('employee', { employee: 'nope' }), DEFAULT_APPROVAL_CHAINS.employee);
  assert.deepEqual(resolveApprovalChain('employee', null), DEFAULT_APPROVAL_CHAINS.employee);
});

test('an override cannot grant company-admin or master-admin a personal chain', () => {
  // They have no personal leave (create routes 403 them); resolveApprovalChain
  // must always return an empty chain regardless of config.
  assert.deepEqual(resolveApprovalChain('company-admin', { 'company-admin': ['hr'] }), []);
  assert.deepEqual(resolveApprovalChain('master-admin', { 'master-admin': ['hr'] }), []);
});

test('safety: nothing in the chain is ever skipped, even a self-assigned slot stays Pending', async () => {
  // Product rule: the applicant IS the stamped company-admin approver — the
  // tier still shows Pending (the approve path + admin oversight handle it;
  // no silent skip ever shortens the chain).
  const r = await computeInitialApproval(
    { ...input, userId: 'ca1' },
    'employee',
    { ...staffed, companyAdminIds: ['ca1'] },
    { employee: ['companyAdmin'] },
  );
  assert.equal(r.approvalStatus.companyAdmin, 'Pending');
});

test('every configurable requester role resolves a chain (and admin roles do not)', () => {
  for (const role of REQUESTER_ROLES) {
    assert.ok(Array.isArray(resolveApprovalChain(role, null)), `${role} must resolve to an array`);
  }
  assert.deepEqual(resolveApprovalChain('company-admin', null), []);
  assert.deepEqual(resolveApprovalChain('master-admin', null), []);
});
