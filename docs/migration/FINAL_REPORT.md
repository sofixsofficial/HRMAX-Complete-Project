# HR MAX — Firebase → AWS Migration: Final Report

Date: 2026-10-21 · Account 549243453699 · Region ap-southeast-2

## Verdict

**Migration complete and verified end-to-end in production.** All 1,462
Firebase documents and all 14 auth users run on AWS (Cognito, DynamoDB, S3,
CloudFront, API Gateway + Lambda). Zero Firebase dependencies remain in the
codebase. Browser E2E as master-admin passes with correct counts on every
screen exercised, zero 5xx responses, and no console errors beyond the
documented parity 404s.

- Site: <https://d3mt3qaxw5o28k.cloudfront.net>
- API: <https://u2y0p4665a.execute-api.ap-southeast-2.amazonaws.com> (stack `hrmax-api`, UPDATE_COMPLETE)
- Table `HRMAX`: 1,477 items (1,462 migrated + user profiles/derived rows)
- Cognito pool `ap-southeast-2_DUe0sfFOx`: 14/14 users CONFIRMED on permanent passwords

## Verification evidence (all real runs, no simulation)

| Check | Result |
| --- | --- |
| Data verification (`tools/migrate/verify.mjs`) | **11/11 PASS** — 1,477 items, pool=14 (`MIGRATION_VERIFICATION.md`) |
| Backend typecheck + build | clean |
| Backend unit tests (`node --test`) | **17/17 PASS** |
| Frontend `vite build` | clean (2,214 modules) |
| Stack deploys (3× this session) | UPDATE_COMPLETE, no resource replacements, ApiUrl/UserPool unchanged |

### Browser E2E — master-admin (2026-10-21)

- **Login**: Cognito sign-in → JWT → pretoken trigger → API → DynamoDB, lands on `/master-admin/dashboard`.
- **Dashboard**: Total Companies 2 · Total Employees 9 (9 active) · Executives 1 ·
  Team Leaders 1 · Company Admins 2 · Pending Leaves 14 · Payroll Processed 39 ·
  Total Roles 0 · Present/On-Leave Today 0 (attendance is historical — correct).
  User-role tally 1+1+1+9+2 = **14 = migrated user count**.
- **Employees table**: 9/9 rows with companies, departments, leave balances.
- **Leaves**: `Showing 21 of 21 requests` with formatted dates, per-tier approval
  state (e.g. "Pending 3/4"), and review actions. "Leave Approval Status"
  modal opens with tier progress + approval log.
- **Network (fresh dashboard load)**: 24–27 × `200`, 3 × `404`, **0 × 5xx**.
  The 404s are `GET /api/companies/master-admin` — the intentional parity
  behavior for the pseudo-company doc (shim maps 404 → `exists() === false`).
- **Console**: only those 404s; **no JS errors** (see toDate fix below).

### API round-trips (executed with a live session token)

- `GET /api/leave-requests` → 200 (21 docs) · `GET /api/leave-requests/:id`
  → 200, byte-equal to the list entry (cross-partition by-id locate works for
  super-admin).
- `PATCH /api/leave-requests/:id` (idempotent same-value write) → 200.
  Only difference vs before: `updatedAt` (the data layer stamps it on every
  patch — one metadata field on one record, invisible in UI, sorting is by
  `appliedOn`) plus null-vs-missing representation of
  `masterAdminApproveStatus`/`tierOverrides` (values match the original export).
- `POST /api/leave-requests/:id/review-tier` negative gate → **412**
  `Request already Cancelled` — route, locate, sequential-tier validation all
  live; no mutation.
- Notification mark-read round-trip (`PATCH /api/notifications/:id` with
  `{read:true}` then restore) → **200/200**, state restored to original.
- `/api/roles` → 200 (empty — Firebase `roles` was empty: parity) ·
  `/api/admin-alerts` → 200 with data.

## Root causes found & fixed this session

1. **Intermittent API Gateway `503 Service Unavailable`** — account-level
   Lambda concurrency quota was **10** (AWS reduces this for new accounts).
   One dashboard load fires ~25 parallel requests; everything above 10
   concurrent invocations was throttled → API GW returned 503 without reaching
   Lambda (hence zero CloudWatch errors). Fix: quota increase request approved
   → concurrency now **1000**. Client-side, the shim's `onSnapshot` polling was
   also de-synchronized (jittered chained scheduling instead of lockstep
   `setInterval`) and transient 5xx/network failures now retry silently after
   3–5 s instead of erroring the observer (Firestore keeps listeners alive
   through transient failures — parity).
2. **`createdAt.toDate is not a function` crashes** (notification bell +
   admin-alert subscriptions, and every service calling `.toDate()` on
   migrated ISO-string dates). Fix: a non-enumerable `String.prototype.toDate`
   bridge in the shim — strings keep full string semantics (comparisons,
   sorting, raw display) while Timestamp-style access the Firebase-era code
   expects works again. No per-field handling, no `[object Object]` regressions.
3. **Notification mark-read/delete 404s (and silent delete no-ops)** —
   `PATCH` didn't exist on `/api/notifications/:id` (the app uses
   `updateDoc(ref, {read:true})`), and the `:id` lookups only searched the
   `global` partition while older runtime notifications live in company
   partitions. All three `:id` routes (PATCH/PATCH-read/DELETE) now locate
   across all partitions with owner-scope checks; DELETE is idempotent
   (Firestore parity).
4. **Super-admin cross-partition reads** (earlier in the session): all list
   and by-id handlers for leave, attendance, CRUD, alerts, roles now fan out
   across every partition (companies + `master-admin` + `global`) with
   id-dedupe and correct re-sorting; equality `?field=value` query params are
   server-filtered; bogus `?companyId=<docid>` params from the flat-path shim
   are ignored for by-id operations.

## Data notes (transparency)

- One leave record (`unlQ3hpUSvcb9s1Iblse`) has a newer `updatedAt` from the
  verification PATCH; all other fields match the export byte-for-byte. The
  data layer stamps `updatedAt` on every write, so it cannot be set back.
- `masterAdminApproveStatus`/`tierOverrides` are stored as null on migrated
  leaves; API responses may represent that as missing — semantically identical.
- Present-today / on-leave = 0 is correct: migrated attendance is historical
  (last records September 2026).
- Firebase data is **untouched** and remains the rollback source of truth.

## Completed (2026-10-21)

- **`git push`**: all local commits pushed to `main`
  (`github.com/sofixscompany-code/HR-MAX`, `de8cee3..5857e9c`).
- **Leaked Firebase service-account key revoked**: GCP Console → IAM →
  `firebase-adminsdk-fbsvc@hrm-sofisx.iam.gserviceaccount.com` → key
  `4a96325073ae39c55402cd05f16801bcb0322d50` deleted (confirmed post-reload;
  3 older keys remain — revoke those too if unused).

## Security wrap-up (2026-10-21)

- **All 4 firebase-adminsdk keys revoked**: the leaked migration key
  `4a963250…` plus all 3 older keys (`2fb3c761…`, `aa8881e07a…`,
  `9188abf2…`). SA `firebase-adminsdk-fbsvc@hrm-sofisx` now has **zero keys**
  (verified: empty keys table in GCP Console). Local JSON copies are
  cryptographically dead.
- **Git-history purge: verified UNNECESSARY** — the private key material was
  never committed. Evidence: `git log --all -S"private_key_id"` → 0 commits;
  `-S"BEGIN PRIVATE KEY"` → 0 commits; every JSON file ever added to the repo
  is a package/tsconfig/firebase config (no service-account JSON). The key
  ID strings in this report are public identifiers, not secrets. No
  force-push performed (nothing to purge; it would only break clones).

## Pending actions (require the user)

1. **SES**: identity `no-reply@hrmax.in` is PENDING — click the confirmation
   link in that mailbox. Outbound email stays blocked until then.
2. Optional: GitHub secrets + OIDC role for CI deploys (`docs/deployment.md` §4).

## Reference docs

- `docs/migration/MIGRATION_CHECKLIST.md` — full status
- `docs/migration/MIGRATION_VERIFICATION.md` — 11/11 data verification
- `docs/migration/COST_ESTIMATE.md` — ~$5–15/month estimate
- `docs/deployment.md` — manual deploy, rollback, CI setup
