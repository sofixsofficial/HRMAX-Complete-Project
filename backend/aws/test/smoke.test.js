/**
 * Backend smoke tests (node:test, no dependencies, offline).
 *
 * Runs against backend/aws/dist/ — the exact compiled code Lambda executes.
 * Covers the contracts the whole migration depends on:
 *   - single-table key/GSI builders (readers key off these)
 *   - storage normalization (Dates → ISO)
 *   - role/permission authorization matrix
 *   - leave-tier sequential-order constants
 *
 * Live-stack behaviour (auth → data rendering) is covered by
 * tools/migrate/verify.mjs + the staging E2E checklist in docs/deployment.md.
 *
 * Usage: npm test --prefix backend/aws   (requires: npm run build --prefix backend/aws)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TABLE_NAME = process.env.TABLE_NAME ?? 'HRMAX';

const db = await import('../dist/lib/db.js');
const auth = await import('../dist/lib/auth.js');
const types = await import('../dist/lib/types.js');

const caller = (over = {}) => ({
  uid: 'u-1', email: 'a@b.c', name: 'T', role: 'employee', companyId: 'acme',
  assignedCompanyIds: [], linkedExecutiveIds: [], reportingExecutiveId: null,
  isReportingManager: false, permissions: [], permissionsConfigured: true,
  ip: '127.0.0.1', userAgent: 'test', ...over,
});

// ---------------------------------------------------------------------------
// 1. Single-table key contract — what pretoken/resolveCaller/queryEntities read
// ---------------------------------------------------------------------------

test('companyPK / userPK shape', () => {
  assert.equal(db.companyPK('acme'), 'COMPANY#acme');
  assert.equal(db.userPK('cognito-sub-1'), 'USER#cognito-sub-1');
});

test('entityKeys → partition + sort key', () => {
  assert.deepEqual(
    db.entityKeys('employee', 'acme', 'emp-9'),
    { PK: 'COMPANY#acme', SK: 'employee#emp-9' },
  );
});

test('userGsi → GSI1 (per-user lists)', () => {
  assert.deepEqual(
    db.userGsi('u-1', 'attendance', '2026-09-01', 'att-7'),
    { GSI1PK: 'USER#u-1', GSI1SK: 'attendance#2026-09-01#att-7' },
  );
  // Sortable by ts: lexicographic order of the ts segment drives list order.
  assert.ok('attendance#2026-09-01#a' < 'attendance#2026-09-02#a');
});

test('roleGsi → GSI2 (role lookups)', () => {
  assert.deepEqual(
    db.roleGsi('company-admin', 'acme', 'u-1'),
    { GSI2PK: 'ROLE#company-admin', GSI2SK: 'acme#u-1' },
  );
});

test('globalGsi → GSI3 (global lists: companies, audit, email logs)', () => {
  assert.deepEqual(
    db.globalGsi('company', '2026-01-01T00:00:00.000Z', 'co-1'),
    { GSI3PK: 'company', GSI3SK: '2026-01-01T00:00:00.000Z#co-1' },
  );
});

// ---------------------------------------------------------------------------
// 2. Storage normalization
// ---------------------------------------------------------------------------

test('normalizeForStorage: Dates → ISO, undefined dropped, nested converted', () => {
  const d = new Date('2026-03-04T05:06:07.000Z');
  const out = db.normalizeForStorage({
    createdAt: d, keep: 'x', drop: undefined, nested: { at: d, gone: undefined },
    list: [d, 1, null], deep: [{ inner: d }],
  });
  assert.deepEqual(out, {
    createdAt: '2026-03-04T05:06:07.000Z', keep: 'x',
    nested: { at: '2026-03-04T05:06:07.000Z' },
    list: ['2026-03-04T05:06:07.000Z', 1, null],
    deep: [{ inner: '2026-03-04T05:06:07.000Z' }],
  });
});

// ---------------------------------------------------------------------------
// 3. Authorization matrix
// ---------------------------------------------------------------------------

test('VALID_ROLES matches the roles in migrated data (HR added as the 7th)', () => {
  assert.deepEqual(types.VALID_ROLES, [
    'master-admin', 'company-admin', 'team-leader',
    'executive', 'reporting-manager', 'hr', 'employee',
  ]);
});

test('assertRole: allows member, denies non-member with permission-denied', () => {
  auth.assertRole(caller({ role: 'company-admin' }), ['master-admin', 'company-admin']);
  assert.throws(
    () => auth.assertRole(caller({ role: 'employee' }), ['master-admin', 'company-admin']),
    (e) => e.code === 'permission-denied' && e.httpStatus === 403,
  );
});

test('isSuperAdmin / isManagement', () => {
  assert.equal(auth.isSuperAdmin(caller({ role: 'master-admin' })), true);
  assert.equal(auth.isSuperAdmin(caller({ role: 'company-admin' })), false);
  assert.equal(auth.isManagement(caller({ role: 'executive' })), true);
  assert.equal(auth.isManagement(caller({ role: 'employee' })), false);
  assert.equal(auth.isManagement(caller({ role: 'reporting-manager' })), false);
});

test('hasPermission: master-admin wildcard', () => {
  const ma = caller({ role: 'master-admin', permissions: ['*'] });
  assert.equal(auth.hasPermission(ma, 'payroll.manage'), true);
  assert.equal(auth.hasPermission(ma, 'anything.at.all'), true);
});

test('hasPermission: company-admin view-biased, leave allowed, manage denied', () => {
  const ca = caller({ role: 'company-admin', permissions: [] });
  assert.equal(auth.hasPermission(ca, 'employees.view'), true);
  assert.equal(auth.hasPermission(ca, 'leave.approve'), true);
  assert.equal(auth.hasPermission(ca, 'payroll.manage'), false);
  assert.equal(auth.hasPermission(ca, 'employees.delete'), false);
});

test('hasPermission: employee hard-coded subset', () => {
  const emp = caller({ role: 'employee', permissions: [] });
  assert.equal(auth.hasPermission(emp, 'leave.apply'), true);
  assert.equal(auth.hasPermission(emp, 'attendance.view'), true);
  assert.equal(auth.hasPermission(emp, 'payroll.view'), false);
  assert.equal(auth.hasPermission(emp, 'employees.view'), false);
});

test('hasPermission: reporting-manager leave + scoped views', () => {
  const rm = caller({ role: 'reporting-manager', permissions: [] });
  assert.equal(auth.hasPermission(rm, 'leave.approve'), true);
  assert.equal(auth.hasPermission(rm, 'employees.view'), true);
  assert.equal(auth.hasPermission(rm, 'attendance.view'), true);
  assert.equal(auth.hasPermission(rm, 'payroll.manage'), false);
});

test('assertPermission throws permission-denied when missing', () => {
  assert.throws(
    () => auth.assertPermission(caller({ role: 'employee', permissions: [] }), 'payroll.view'),
    (e) => e.code === 'permission-denied' && e.httpStatus === 403,
  );
});

test('scopedCompanyIds: master-admin unscoped, employee single-company', () => {
  assert.deepEqual(auth.scopedCompanyIds(caller({ role: 'master-admin' })), []);
  assert.deepEqual(auth.scopedCompanyIds(caller({ role: 'employee', companyId: 'acme' })), ['acme']);
  assert.deepEqual(auth.scopedCompanyIds(caller({ role: 'executive', companyId: 'x', assignedCompanyIds: [] })), ['x']);
  assert.deepEqual(auth.scopedCompanyIds(caller({ role: 'executive', companyId: 'x', assignedCompanyIds: ['a', 'b'] })), ['a', 'b']);
});

// ---------------------------------------------------------------------------
// 4. Leave-tier contract (sequential approval chain with an HR tier)
// ---------------------------------------------------------------------------

test('TIER_ORDER is the exact sequential chain the gates enforce', () => {
  assert.deepEqual(types.TIER_ORDER, ['reportingManager', 'hr', 'companyAdmin', 'executive', 'teamLeader']);
  assert.equal(new Set(types.TIER_ORDER).size, 5, 'no duplicate tiers');
});

test('ApiError carries machine-readable code (error contract used by shims)', () => {
  const e = new types.ApiError('failed-precondition', 'x');
  assert.equal(e.code, 'failed-precondition');
  assert.equal(e.httpStatus, 412);
  assert.equal(new types.ApiError('permission-denied', 'y').httpStatus, 403);
});
