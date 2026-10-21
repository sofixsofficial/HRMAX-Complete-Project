# Migration Checklist — Firebase → AWS (HR MAX)

Status as of **2026-10-20**. ✅ = done & verified · 🟡 = done, one pending
external step · ⬜ = not done / deliberately deferred.

## Phase 1 — Inventory & safety

- ✅ Inspection reports: collections, backend functions, auth/storage
  (`docs/migration/inventory-*.md`)
- ✅ Safety baseline commit `2aeacb7` in HRM-Main preserved
- ✅ Read-only probe: 1,462 docs / 21 non-empty collections, 14 auth users,
  Storage bucket empty (0 objects — nothing to migrate to S3)

## Phase 2 — Migration execution

- ✅ `tools/migrate/export.mjs` — all 1,462 docs + 14 auth users exported
  (manifest counts verified; export/ is git-ignored)
- ✅ `import-cognito.mjs` — 14/14 users in pool `ap-southeast-2_DUe0sfFOx`
- ✅ Temp passwords rotated → `export/credentials.txt` (git-ignored, never logged)
- ✅ All 14 users flipped to **permanent** passwords (`permanent-passwords.mjs`,
  14/14 CONFIRMED)
- ✅ `import-dynamodb.mjs` — **1,462/1,462 written, 0 failures**, 1,362 uid
  refs remapped `firebaseUid → cognitoSub` (values + keys)
- ✅ Partition normalization: notifications/adminAlerts/emails/
  corporateInquiries → `companyId:'global'`; `email_logs` empty → `global` +
  `globalList`; audit_logs `tsField:'timestamp'`; emails `userId` derived
- ✅ `verify.mjs` — **11/11 checks PASS**; 1,477 items; pool = 14 →
  `docs/migration/MIGRATION_VERIFICATION.md`
- ✅ Orphan test account deleted (Firebase side, pre-cleanup)
- ⬜ Firebase data **kept** until sign-off (non-destructive by requirement)

## Phase 3 — Code migration

- ✅ Firebase surface removed: 69 files, commit `648969d`
  (alias anchors `frontend/src/firebase/config.ts`, `mobile-app/src/firebase.ts`
  map legacy imports → AWS shims)
- ✅ Frontend AWS shims (`frontend/src/aws/*`): auth, firestore, storage,
  functions
- ✅ Backend SAM stack `hrmax-api`: API + 4 Lambdas + Cognito + DynamoDB + S3 +
  CloudFront + EventBridge
- ✅ Smoke-test suite `0129415` — 17/17 pass (`npm test`)
- ✅ Login/password gap fixed: `reauthenticateWithCredential` stashes verified
  password as `user._pw` so Cognito ChangePassword gets a valid previous
  password (`frontend/src/aws/auth.ts`)

## Phase 4 — Parity fixes (this session)

- ✅ Super-admin unfiltered list parity — `queryEntitiesAcross` +
  `readPartitions`: crud list, `/api/users`, leave list, attendance list
  (root cause: defaults collapsed every master-admin list to the empty
  `COMPANY#master-admin` partition)
- ✅ By-id handlers stop trusting the shim's `?companyId=<docid>` — generic
  GET/PUT/PATCH/DELETE, leave GET/PATCH/DELETE/:id, attendance
  GET/PATCH/DELETE/:id all **locate across the caller's partitions**
  (fixes: `exists()=false` reads, silent delete no-ops, PATCH 404s,
  PUT creating docs under bogus `COMPANY#<docid>` partitions, master-admin
  leave review being unable to find company leave requests)
- ✅ `PATCH /api/leave-requests/:id` — the route both web review flows
  (`reviewLeaveRequest`, `reviewTierLeaveRequest`) call (was 404)
- ✅ `POST /api/notifications` — 27 frontend `createNotification` call sites
  (was 404); runtime notifications normalized to the `global` partition so
  mark-read/delete land (`lib/notify.ts` `keyCompanyId:'global'`)
- ✅ `GET/POST/PATCH/DELETE /api/admin-alerts` — management-readable,
  super-admin-mutable, ignores bogus `?companyId=` (Firestore rules 574-604)
- ✅ `GET/POST/PATCH/DELETE /api/roles` — authenticated read, scoped write
  (rules 1162-1169); `'roles'` was empty in Firebase → empty list = parity
- ✅ Generic `?field=value` string-equality → server-side filter
  (`equalityFilters`) — fixes `reportingManagerId`, `status`, `roleType`,
  `__name__='scope-empty'` sentinel etc. (shim never post-filters these)
- ✅ `orderBy`/`desc` params honoured (matters where `limit` is applied
  server-side)
- ✅ Notifications GET: non-super-admin querying another user's `userId`
  returns `[]` (rules parity)

## Phase 5 — Verification

- ✅ Backend typecheck (`tsc --noEmit`) · build (`tsc`) · **17/17 unit tests**
- ✅ Frontend `vite build` clean
- ✅ Backend deployed — stack `hrmax-api` UPDATE_COMPLETE (ApiFn et al.)
- ✅ Frontend deployed — S3 sync + CloudFront invalidation
- ✅ Browser E2E: master-admin login → `/master-admin/dashboard`, full
  auth→JWT→pretoken→resolveCaller→API→DynamoDB pipeline (session 1)
- ✅ Post-fix browser E2E (2026-10-21): dashboard counts (2 companies, 9
  employees, 6 departments, 39 payroll, 14 pending leaves, roles 0, users 14),
  leaves 21/21 with formatted dates, approval-status modal, `/api/roles` +
  `/api/admin-alerts` 200, leave GET/PATCH round-trip + 412 negative gate,
  notification mark-read round-trip — see `FINAL_REPORT.md`
- ✅ Intermittent API GW `503`s **root-caused & resolved** — account-level
  Lambda concurrency quota was 10 (reduced new-account default); raised to
  1000 (quota request approved 2026-10-21). Zero 5xx on fresh loads.

## Phase 6 — Deliverables

- ✅ `docs/migration/MIGRATION_VERIFICATION.md` (11/11)
- ✅ `docs/migration/COST_ESTIMATE.md`
- ✅ `docs/deployment.md` (manual deploy + rollback + OIDC/CI setup)
- ✅ This checklist + `FINAL_REPORT.md`
- ✅ Updated package manifests / CI rewritten for AWS (`0129415`, `648969d`)
- ⬜ Push local commits (main ahead: `dfacf5e`, `472105f`, `648969d`,
  `0129415` + this session's commit) — **awaiting user approval**

## Pending **your** action

1. 🟡 **SES identity** `no-reply@hrmax.in` is PENDING — click the confirmation
   link in that mailbox; emails stay blocked until then.
2. ⬜ **Revoke the leaked Firebase service-account key in GCP Console**
   (mandatory — the key still exists there; the repo copy was deleted).
3. ⬜ Optional: GitHub repo secrets + OIDC role (only when CI is wanted —
   manual deploy works today; see `docs/deployment.md` §4).
4. ⬜ Optional: force-push history purge of the leaked key — user decision.
5. ⬜ `git push` when you've reviewed the commits.
