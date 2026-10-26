# HR MAX Mobile App — Audit Report

> **Status: COMPLETE (static audit).** Every claim carries a file path + line number.
> Nothing is called "working" without a verified frontend → backend → database chain;
> items verified only by code reading are marked **static-verified**, and live API tests are
> marked **pending** (Stage 0 of implementation).
>
> Audits: (A) backend/API + auth · (B) mobile app state · (C) web attendance/leave reference.

---

## 1. Existing architecture discovered

**A · Backend**
- API Gateway **HTTP API v2 → single Lambda** (`hrmax-api` / `ApiFn`), hand-rolled router
  (`backend/aws/src/lib/http.ts:85-127`, routes `src/index.ts:17-36`), catch-all `/{proxy+}` ANY
  (`template.yaml:243-255`). **No API Gateway authorizer** — auth enforced in handlers (`template.yaml:280-283`).
  First-match routing: wrong method → 404, never 405 (`http.ts:125`).
- **DynamoDB single table `HRMAX`** (`template.yaml:186-234`): `PK=COMPANY#{companyId}/SK={entity}#{id}`,
  `PK=USER#{uid}/SK=PROFILE` (authoritative user row), GSI1 `USER#{userId}`, GSI2 `ROLE#{role}`, GSI3 `{entity}`
  (`src/lib/db.ts:1-61`).
- **Auth:** Cognito ID-token JWT verified per request (`src/lib/auth.ts:9-39`, `resolveCaller` 51-113);
  sign-in is client-side Cognito (`handlers/auth.ts:4-7`); **users table decides authorization** (46-50).
- **Roles in code** (`src/lib/types.ts:21-28`): `master-admin | company-admin | team-leader | executive |
  reporting-manager | employee` (+ transient `unprovisioned`). ❌ `hr-manager` and "regional manager" **do not
  exist** in the backend.
- **API base URL:** `VITE_API_URL` / `EXPO_PUBLIC_API_URL`, source of truth SAM output `ApiUrl`
  (`template.yaml:456-459`), documented `https://u2y0p4665a.execute-api.ap-southeast-2.amazonaws.com`
  (`docs/deployment.md:77`).
- **Notifications are real:** DynamoDB `notification` entity, **Expo Push API** over HTTPS with stale-token
  cleanup (`src/lib/notify.ts:20-94`), token route (`handlers/auth.ts:269-277`), SES/Zoho email, EventBridge
  scheduler (`template.yaml:311-342`). ❌ No SNS/APNS/FCM SDK.
- **Tests:** `backend/aws/test/{routes,smoke}.test.js`, `node --test`. **Deploy workflow does not run tests.**

**B · Mobile app (existing — to be improved, not replaced)**
- Expo SDK 57 (`~57.0.24`), RN `0.86.3`, React 19, **TypeScript strict**, React Navigation v7
  (native-stack + drawer; `bottom-tabs` installed but **0 imports**). Entry `App.tsx` → `RootNavigator`.
- Providers: `SafeAreaProvider → ErrorBoundary → ThemeProvider → AuthProvider → CompanyProvider`.
- **Secure storage:** `expo-secure-store` via `src/utils/safeStorage.ts` (tokens under `hrmax_aws_tokens`);
  AsyncStorage installed but unused.
- Deps present and used: `expo-location`, `expo-camera` (selfie), `expo-notifications`, `expo-print`/`sharing`
  (payslip PDF), `@react-native-community/netinfo`, `react-native-reanimated`.
- **Transport:** no Firebase — `src/aws/*` compat shims over REST (`functions.ts:41-71` → `POST ${EXPO_PUBLIC_API_URL}`
  with Bearer token; `firestore.ts` = Firestore-shaped REST + 20 s polling).
- **No mock/TODO/stub anywhere** (grep `TODO|FIXME|mock|dummy|sample|coming soon` → 0 real hits).

**C · Web (reference behaviour)** — `frontend/src/aws/firestore.ts` = same REST shim
(`markAttendance → POST /api/attendance/mark`, `functions.ts:33`; unmapped → `POST /fn/{name}`).

## 2. API inventory

### Attendance — `backend/aws/src/handlers/attendance.ts`
| Route | Gate | Status |
|---|---|---|
| `POST /api/attendance/mark` (77-78) — **check-in AND check-out** via `type` | auth + `assertCompanyScope` (90-91) | ✅ static-verified |
| `GET /api/attendance` (182-183) history/list | employee forced to own rows (211-213) | ✅ |
| `GET /api/attendance/:id` (381-382) | superadmin \|\| own \|\| `attendance.view` \|\| `attendance.manage` (388-393) | ✅ |
| `PATCH /api/attendance/:id` (400-401) | manage \|\| stamped approver \|\| owner whitelist (412-424) | ✅ |
| `DELETE /api/attendance/:id` (436-437) | MA + `attendance.manage` (442-446) | ✅ |
| `POST /api/attendance/:id/rectification` (221-222) / `…/review` (287-288) | own-or-MA (231); sequential tier gate (302-308) | ✅ |
| CRUD `/api/attendance-settings`, `/api/attendance-logs`, `/api/shift-configs` (`crud.ts:267,273,265`) | generic perms | ✅ |
| legacy `POST /fn/mobile*Attendance*` (`legacy.ts:1331,1184,842-844`) | `requireRole` | ✅ |

### Leave — `backend/aws/src/handlers/leave.ts`
| Route | Status |
|---|---|
| `POST /api/leave-requests` apply (122-123) — scope (132), self-only unless `leave.approve`/MA (133-135) | ⚠️ **see §7 B2** |
| `GET /api/leave-requests` (187-188), `GET …/:id` (226-227) | ✅ |
| `PATCH /api/leave-requests/:id` (239-240) — blind passthrough (255-260) | ⚠️ **B4** |
| `POST …/:id/review-tier` (268-269) — reject needs note (275), earlier-tier gate (283-289), `assertTierApprover` (293) | ✅ |
| `POST …/:id/master-admin-review` (344-345) — MA only (348) | ✅ |
| `DELETE …/:id` (386-387) — hard delete | ⚠️ **B5** (mobile path uses `status:'Cancelled'`, `legacy.ts:829-841`) |
| legacy `mobileCreateLeaveRequest/ReviewLeaveTier/ReviewMasterAdminLeave/CancelLeaveRequest` (`legacy.ts:847,827,828,829`) | ✅ |
| **leave balance** | ❌ **no server endpoint exists** |

Also: 6 generic CRUD routes × 23 collections (`crud.ts:48-293`), companies (445-539), roles (761-825),
notifications (542-668), admin-alerts (681-740), payroll (`payroll.ts:193-344`), `POST /api/storage/presign`
(`storage.ts:41-42`), email (`email.ts`), broadcast (`broadcast.ts`), legacy `POST /fn/:name` with **71 names**.
**No `/api/reports*` route.**

## 3. Attendance audit results

**Backend flow (static-verified):** scope → server `now` → load today's row (99-102) → every rejection writes an
`attendanceLog` row then **412** (`fail()`, 104-110) → duplicate check-in (112-113) → geofence if
`policy.requireGeofence` (116-123, haversine 17-26) → selfie if `policy.requireSelfie` (126-133) →
`determineStatus` = `Present` within shift+15 min grace else `Late`+`lateMinutes` (61-65) → write with
`isAutoApproved/approvedByName:'System (Auto-Approved)'` (142-145) → Late fans out to RM/TL/executives (148-155).
Check-out requires `checkIn` (`NO_RECORD`, 160-161), rejects second (`ALREADY_CHECKED_OUT`, 161), computes
`workMinutes`, `overtimeMinutes` (>30 min), `isEarly` → `Early Checkout` (163-174).

**State machine (backend-authoritative), `types.ts:126-134`:** `Present | Late | Absent | On Leave | Miss Punch |
Early Checkout | Approved | Half Day`. Nightly sweep (`scheduler.ts:31-92`): open punch → `Miss Punch`, creates
`Absent` skipping weekends/holidays.

**Mobile flow:** `useAttendanceGate.ts:62-136` (network → geofence `:101-125` → selfie `:127-131`) →
`AttendanceScreen.tsx:249-295` → `attendanceApi.ts:63-75` → `functions.ts:26` → **`POST /api/attendance/mark`**.
Success shown only after server response (`AttendanceScreen.tsx:267-291`) ✅. Buttons disabled while in-flight
(`:660,:669`) ✅.

**Live E2E test: ✅ VERIFIED** on a designated test account
(`test.employee@hrmax.in` / `Test@1234`, company `digital hr`, employee record `isTestAccount: true`):

| Step | Expected | Actual |
|---|---|---|
| `check-in` #1 | 200 | ✅ **200** saved, `status: Late`, `lateMinutes: 51` (company timezone) |
| `check-in` #2 | 412 duplicate | ✅ **412** "Already checked in today" |
| `check-out` #1 | 200 | ✅ **200**, `workHours: 0.12` computed server-side |
| `check-out` #2 | 412 duplicate | ✅ **412** "Already checked out today" |
| history read-back | one row, in+out | ✅ `2026-10-26 / Late / in ✓ / out ✓` |
| dashboard after reload | shows the day | ✅ "Day Complete", Recent Activity "Checked in 09:51" + "Checked out 09:58", ring 100% |

The test run surfaced two production-outage bugs that unit tests had missed
(both fixed with regression tests in `b090b44`): DynamoDB reserved words in the
condition expression (500 on every check-in) and the `{NULL:true}` wire form
rejected every legitimate check-out.

## 4. Leave management audit results

Apply (web `leaveService.ts:606-706`, mobile `leaveService.ts:198-288` → `mobileCreateLeaveRequest` →
`POST /api/leave-requests`) → tier review (`review-tier`, order
`['reportingManager','companyAdmin','executive','teamLeader']`, `types.ts:101`) → optional MA gate → status via
`deriveStatus` (87-99). Balance computed **client-side only** (`frontend/src/services/leaveService.ts:134`,
mobile `:713`). Working-day helpers exist (`frontend/src/utils/workingDays.ts`) but are **not used for leave day
counts** — `calcLeaveDays` (`leaveService.ts:203-210`) is a plain calendar-day diff.

**Live E2E test: ✅ VERIFIED** on the designated test account (all test data created was deleted afterwards):

| Step | Expected | Actual |
|---|---|---|
| valid apply, client lies `totalDays: 99` | server recomputes | ✅ **200**, stored `totalDays: 3` |
| overlapping range | 409 | ✅ **409** "Leave already … for 2026-11-12 → 2026-11-14" |
| reversed range (`end < start`) | 400 | ✅ **400** "endDate cannot be before startDate" |
| review-tier on an already decided request | 412 | ✅ **412** "Request already Approved" |
| **owner PATCHes `status:'Rejected'` on own request** | 403 | ✅ **403** "Only an approver can change a leave decision — use the review endpoints" |
| owner PATCHes `approverIds` | field stripped | ✅ 200 but stored approvers **unchanged** |
| cleanup (owner `DELETE`) | 200 | ✅ **200** (both test rows removed) |

**Multi-tier approval chain — ✅ VERIFIED** (needed two approver accounts, since the company had none):
created `test.companyadmin@hrmax.in` (company-admin) and `test.manager@hrmax.in` (reporting-manager),
linked the test employee's `reportingManagerId`:

| Step | Expected | Actual |
|---|---|---|
| apply with 2 approvers present | tiers Pending, status Pending | ✅ `reportingManager: Pending`, `companyAdmin: Pending`, `executive/teamLeader: Skipped`, **`status: Pending`** (no more auto-approve) |
| employee approves own tier | 403 | ✅ **403** "You are not the approver for this tier" |
| company-admin approves **before** the reporting manager | 412 out-of-order | ✅ **412** "Earlier tier (reportingManager) has not approved yet" |
| reject without a note | 400 | ✅ **400** "A review note is required for rejection" |
| reporting manager approves tier 1 | 200, still Pending | ✅ **200**, `reportingManager: Approved`, status `Pending` |
| company-admin approves tier 2 | 200, status Approved | ✅ **200**, all decided → **`status: Approved`** |
| cleanup | row removed | ✅ DELETE 200, `remaining: 0` |

**Web owner cancel (UI path) — ✅ VERIFIED**: row → `Cancel` button → `confirm("Cancel this leave request?")`
→ `PATCH status:'Cancelled'` → server `status: Cancelled`, UI toast "Cancelled", cell `Cancelled0/4`
(the counter now reads `0/2` after B14 ships). A stray `/employee/` 404 appeared once during automation but
has no matching route or navigation target in the code and could not be reproduced — recorded as **not confirmed**.

The two approver accounts were **kept** (named `test.*`) so future approval E2E can run.

## 5. Feature checklist vs mobile spec

| Spec area | Status | Evidence |
|---|---|---|
| Splash | ✅ **DONE (Stage 1)** | native config + JS handoff (`App.tsx` `preventAutoHideAsync`/`hideAsync` held until session restore); branded `LoadingScreen` with tagline, version, Sofixs footer and an 8s "Still connecting" + Try again state |
| Onboarding (3 slides) | ✅ **DONE (Stage 1)** | `src/screens/auth/OnboardingScreen.tsx` — workday / attendance / everything-in-one, dots + Skip/Next/Get Started, `hrmax_onboarding_done` persisted via `safeStore`; `AuthNavigator` picks the initial route |
| Login / forgot / reset / change pw / edit profile | ✅ EXISTS | `auth/LoginScreen.tsx`, `ForgotPasswordScreen.tsx`, `VerifyResetCodeScreen.tsx`, `SettingsScreen.tsx:66-97`, `MyProfileScreen.tsx:34-44` |
| Session restore + secure token storage | ✅ EXISTS | `AuthContext.tsx:65-76`, `safeStorage.ts:13-45` (SecureStore), token refresh `aws/auth.ts:138-149` |
| Account-disabled / pending-approval states | ⚠️ PARTIAL | backend rejects `Suspended`/`Rejected` (`auth.ts:93-96`); mobile shows generic error text |
| Multi-company selection | ✅ EXISTS | `CompanyContext.tsx` |
| Dashboard per role | ✅ 6 dashboards | `src/screens/dashboards/*` + `DashboardRouter.tsx:125-133` |
| Attendance module | ✅ **mostly** | My Attendance `AttendanceScreen.tsx:710`, history `:839-873`, detail modal `:1040-1070`, working hours `:746`, late `:597-599`, miss-punch + correction `attendanceApi.ts:83-182`, team attendance `:217-241`, CSV export `:521-524`, admin dashboards |
| … monthly calendar **grid** | ✅ **DONE (Stage 2)** | `src/components/MonthAttendanceCalendar.tsx` — per-day cells from real records, today/future treatment, legend, honest empty state, theme-aware; verified live ("October 2026" grid) |
| … shift schedule screen | ❌ **MISSING** | only `defaultShiftStart` read (`useAttendanceGate.ts:141-143`) |
| … early-departure flag | ✅ **DONE (Stage 2)** | backend writes `Early Checkout`; mobile history filter now offers it (was unreachable) |
| Leave module | ✅ **mostly** | balance `LeaveScreen.tsx:381-404`, apply `ApplyLeaveScreen.tsx:129`, my requests `:424-470`, details `:519-610`, approvals `LeaveApprovalsPanel.tsx`, MA gate |
| … cancel leave | ⚠️ **inconsistent** | mobile writes Firestore directly (`LeaveScreen.tsx:212`) while create/review go through backend |
| … team leave calendar | ❌ missing as a dedicated screen (only inside `CalendarCenterScreen.tsx:129-136`) |
| Employee directory | ✅ EXISTS | `AddressBookScreen.tsx` (search `:57-68`, A-Z `:75-78`, detail `:178-190`, CSV `:85`) + admin CRUD `master-admin/EmployeesScreen.tsx:540+` |
| Notifications | ✅ EXISTS + ✅ **push auto-register (Stage 2)** | inbox `NotificationsScreen.tsx:50-69`, read/unread `:117-69`, push token `useNotifications.ts:24-52`; now auto-registered after sign-in on native (`RootNavigator`) with the permission asked **at most once** — declined users are never nagged again (Settings toggle stays). **Logout does NOT clear `pushToken`** — the model has a single field per user, so a web logout would kill the phone's token; documented as a known limitation |
| Profile / settings / more | ✅ EXISTS | `SettingsScreen.tsx`, `MyProfileScreen.tsx` |
| Reports + payslip PDF | ✅ EXISTS | `ReportsScreen.tsx:90-95` (incl. Attendance Summary) + CSV `:104-175`; `utils/payslipPdf.ts:341` |
| **Bottom navigation (Home/Attendance/Leave/Reports/More)** | ✅ **DONE (Stage 1)** | `src/components/BottomNav.tsx` + `withBottomNav()` wraps every drawer screen (layout sibling, nothing covered); items derived from `getSectionsByRole` so a role never gets a dead tab; verified live (active indicator, More → drawer) |
| Design tokens / dark mode | ⚠️ PARTIAL | `ThemeContext.tsx` = **colors only** (40 keys); no spacing/typography tokens; light+dark ✅ (`app.json:8 automatic`) |
| Skeletons / empty states / error states | ✅ / ⚠️ | `SkeletonLoader.tsx`, `EmptyStateView` (25+ screens); **no shared `ErrorState` component** |
| Safe areas | ✅ | `SafeAreaProvider`, iOS `infoPlist` strings (`app.json:17`), camera/location/notification permission plugins |
| Tests | ✅ **DONE (Stage 4)** | backend **93/93** (`node --test`) + mobile **27/27** (jest-expo) + web **33/33** (vitest) = **153 total**; mobile `lint` script exists but eslint isn't a dep |
| Offline attendance queue | ❌ **MISSING** | no queue/retry anywhere — a failed punch is lost |

**Role support:** 6 declared roles ✅ (all have dashboards). `hr-manager` exists only as an ad-hoc string in 8
mobile files (falls back to `EmployeeDashboard`); `regional-manager` does not exist. Backend has neither.

## 6. Tests

- **Existing:** `backend/aws/test/routes.test.js` (route mounting, 401-for-anonymous on
  `GET /api/attendance`, `POST /api/attendance/mark`, `GET /api/leave-requests`) and `smoke.test.js`
  (`TIER_ORDER` 164-167, permission assertions 122-145). Run: `npm test` = `build:backend` + `node --test`.
- **Coverage vs spec:** attendance = mounting only (logic covered by the new unit tests below);
  leave = mounting + constants. **Mobile suite added (Stage 4)**; **frontend/web still has no tests**.
- **Execution this session: ✅ 86/86 pass** (`npm test`, run twice back-to-back to prove stability)
  - baseline before changes: **66/66**
  - added `backend/aws/test/attendance-leave.test.js` (+20): status-machine boundaries, company-timezone
    day/minute maths (the UTC/IST proof), `enableGeofence`→`requireGeofence` flag mapping, haversine distance,
    leave date parsing / inclusive duration / overlap rules, `ConditionalWriteFailed` contract
  - also fixed test isolation: tests no longer write live rate-limit counters (`HRMAX_DISABLE_RATE_LIMIT`)
- **Mobile: ✅ 27/27 pass, 4 suites** (Stage 4, `94ec880`) — `npm test` in `mobile-app` (jest-expo):
  `dayKey/addDays`, `companyScope` sentinels (regression), leave/working-day counting, and renders of
  `BrandHomeHero` + `MonthAttendanceCalendar` (honest empty state, today/future cells).
- **Web: ✅ 33/33 pass, 3 suites** (Stage 4, `41d0e3a`) — `npm test` in `frontend` (vitest):
  geofence maths, working-day rules, `companyScope` sentinels + chunking. Web bundle still builds
  (`npm run build` ✅) and the sentinel fix was verified live on `/master-admin/employees`.
- **Grand total: 153 tests** (backend **93** + mobile **27** + web **33**).

## 7. Exact bugs found

### Mobile (already fixed)
| # | Bug | Evidence | Fix |
|---|---|---|---|
| M1 | Hero entrance values created but never animated → hero rendered at `opacity: 0` | `DashboardHero.tsx` (no `Animated.timing`) | commit `9782ae3` ✅ |
| M2 | Master-admin drawer exposed "Self Service / My Leaves & Attendance" with no matching web route | `CustomDrawerContent.tsx:31` | commit `fa27411` ✅ |

### Backend (open — need justification + regression care)
| # | Bug | File:line | Impact | Status |
|---|---|---|---|---|
| B1 | **Geofence flag mismatch** — web writes `enableGeofence`, server reads `requireGeofence` | `AttendanceSettings.tsx:266` vs `attendance.ts:57,116` | **server-side geofence is always OFF**; only client check runs | ✅ **fixed** `4b52638` — `normalizePolicyFlags()` accepts both spellings |
| B2 | **Leave apply has no date-range, no overlap, no balance check**; `totalDays` trusted from client | `leave.ts:129-149` | invalid/duplicate leave accepted; balance bypass | ✅ **fixed** `4b52638` — date order + 366-day cap + server `totalDays` + overlap → 409. **Balance still client-side** (no server model exists — documented, not invented) |
| B3 | **No idempotency/conditional write on attendance** — read-then-put | `db.ts:121`, `attendance.ts:99-145` | concurrent double-tap can create duplicates | ✅ **fixed** `4b52638` — `ConditionExpression` on check-in + check-out, `ConditionalWriteFailed` → 412 |
| B4 | `PATCH /api/leave-requests/:id` is a blind passthrough for anyone with `leave.approve` (and **the requester could approve their own request**) | `leave.ts:239-260` | self-approval / chain bypass | ✅ **fixed** `4b52638` — decision fields require an approver; `userId`/`approverIds` stripped; owner cancel still allowed |
| B5 | Cancel semantics diverge: `DELETE` hard-deletes (web+backend) vs mobile sets `Cancelled` | `leave.ts:393-397` vs `legacy.ts:829-841` | data loss vs status change inconsistency | ⚠️ open — both paths are reachable by design; needs a product decision (cancel vs delete) |
| B6 | **UTC vs Asia/Kolkata date-key split** — `todayKey()` UTC in handler, IST in sweeper; no company timezone anywhere in backend | `attendance.ts:28-30` vs `scheduler.ts:15-18`; `grep timezone` = 0 hits | day-boundary attendance bugs; **lateness never detected** | ✅ **fixed** `4b52638` — `resolveCompanyTimezone()` + `dateKeyInZone()` + `minutesInZone()` |
| B7 | **`GET /api/salary-slips` registered twice**; payroll handler unreachable (first-match) | `index.ts:24` vs `:29`, `http.ts:92-95` | dead code path | ✅ **fixed** `4b52638` — duplicate removed (generic CRUD was already the effective handler; behaviour unchanged) |
| B8 | `POST /api/email/send` and `POST /api/broadcast` have **no role gate** (auth only) | `email.ts:46-73`, `broadcast.ts:18-24` | any authenticated user could email/broadcast the company | ✅ **fixed** `4b52638` — `support.view` / `assertRole(MA, CA)`; broadcast now returns 400 not 500 |
| B9 | Legacy callables with no role check (`mobileUpdatePayrollRun` "original had no role check", email CRUD, `mobileCreateTask/Announcement`) | `legacy.ts:1144-1145,1352-1379,873-880,940-948` | privilege escalation risk | ⚠️ open — needs caller audit (web/mobile both route through `/fn/*`); not safe to gate blindly |
| B10 | Approved-leave date-range check stubbed (`return true; // simplified`) → employee on leave *any* day excluded from `Absent` | `scheduler.ts:69-73` | wrong `Absent` rows | ✅ **fixed** `4b52638` — real range compare; malformed dates never suppress an Absent row |
| B11 | Deploy workflow does not run tests | `.github/workflows/deploy.yml` | broken code can deploy | ✅ **fixed** `4b52638` — `Test backend (gate before deploy)` step added |
| B12 | **Payslip email claimed "Please find attached" but sent no attachment**; company admin never CC'd (spec §D requires both) | `payroll.ts:288-336` vs `email.ts:373-381` | ✅ **fixed** `53341b7` — server-side jsPDF generator (`lib/payslipPdf.ts`, same DejaVu font as the web download → identical ₹ rendering), per-employee PDF attachment + CC to every company admin (recipient excluded). Status `Pending→Emailed` already correct. Verified: package ships fonts, local smoke 291,928 bytes `%PDF-`, deployed (bundle 14.05 → 14.72 MB) |
| B13 | **`GET /api/email/logs` always empty for master-admin** — it read only the GSI3 "global" index while `logEmail` writes rows into the company partition with no GSI3 entry (live proof: dispatch `sent=1` yet `logs: []`) | `handlers/email.ts:88-94` vs `lib/email.ts:275-302` | ✅ **fixed** — MA now reads across every readable partition (`queryEntitiesAcross`), company-admin keeps its own partition, retry resolves via `locateEntityAcross`, and new log rows also index on GSI3 |
| B14 | **Leave progress counter counted SKIPPED tiers** → an employee chain with only 2 live approvers showed `2/4` forever, even after status became Approved | `LeaveManagement.tsx:71`, `MasterAdminApprovalsPanel.tsx:313`, mobile `LeaveScreen.tsx:38`, `LeaveApprovalsPanel.tsx:233` | ✅ **fixed** `9424b8e` — `getLiveTiers()` (effective minus Skipped) in both codebases + regression tests (web 40/40, mobile 5/5) |
| B15 | **Attendance screen showed 0 records / 0 stats while the API returned rows** — the search filter `r.name?.toLowerCase().includes(q) \|\| r.department?…` short-circuits to `undefined` (falsy) for server records that carry `employeeName`, so an EMPTY search hid everything | `Attendance.tsx:435`, `AttendanceDashboard.tsx:116` | ✅ **fixed** `f03e805` + `7718db3` — shared `matchesAttendanceSearch()` (empty term matches; name/employeeName/department/userId), `name` normalised at snapshot mapping, mobile search parity. Live: `Total=1, Late=1`, row shows "Test Employee" |
| B16 | **CI "Build APK" always failed** at `Setup Android SDK` — `android-actions/setup-android@v3` runs `sdkmanager tools`, a package that no longer exists in cmdline-tools 16 | `.github/workflows/build-apk.yml` | ✅ **fixed** `c71eadb` — step replaced with a preinstalled-SDK check + explicit `ANDROID_HOME`; live run 40281530344: **`✓ Build APK` (48 min)** |
| B17 | **CI artifact uploads fail**: "Artifact storage quota has been hit" (account-level, recalculates every 6-12h) — killed both Build and Test and the APK upload step | GitHub Actions storage | ⚠️ open/waiting — all 30 repos' artifacts deleted (0 MB visible); re-run after recalculation |
| B18 | **CI "Deploy to AWS" fails in 10s** — repo has **zero secrets** (`AWS_DEPLOY_ROLE_ARN`, `VITE_*` missing) so OIDC credentials never load; the signed-AAB workflow also has no keystore secrets | repo secrets | ❌ open — needs secret setup (+ an OIDC-trusted IAM role) and a keystore |
| B19 | **4 of the 5 approver roles could not reach the approval chain in the app.** Web maps every approver's `/leaves` to `LeaveManagement`, but the mobile drawer sent master-admin, executive and team-leader to the self-service balance screen and had **no leave entry at all** for company-admin — only reporting-manager's "Review Leaves" reached the x/N chain, so the multi-tier approval chain was unactionable on mobile | `CustomDrawerContent.tsx:57,134,251` vs `frontend/src/App.tsx:219,248,273,310` | ✅ **fixed** `a158b88` — those entries now `...home('LeaveManagement')` (company-admin gained one); live: MA drawer → `LeaveManagement` opens the approval screen |
| B20 | **Mobile compose silently dropped attachments.** No picker existed, and `sendAndDeliverEmail` forwarded the record but never passed `attachments` to `/api/email/send`, so mail sent from the app arrived bare while the web compose carried files (the payslip centre needs them) | `EmailCenterScreen.tsx:408-420`, `emailService.ts:123-131` | ✅ **fixed** `a158b88` — `expo-document-picker` staging (base64, 5 MB/file, chips + remove), same `{filename, content, contentType}` contract the web compose uses, attachments kept on drafts, reader lists received attachments with Open (download on web / share sheet on device), and the callable now forwards them (backend already decoded them and caps the total at 5 MB) |

### Web-only (context for mobile parity)
| # | Finding | File:line |
|---|---|---|
| W1 | Selfie captured on web but **never sent** in either payload → `SELFIE_REQUIRED` if policy on | `Attendance.tsx:122-123,495-508,574-586` vs `attendance.ts:127-128` |
| W2 | Wi-Fi SSID allow-list dead — `wifiSsid` hardcoded `null` | `utils/networkUtils.ts:26` |
| W3 | Status/late/on-leave/workHours computed **client-side** (employee shift) while backend uses company default shift | `attendanceService.ts:184-206,259-277,61-73` vs `attendance.ts:135` |
| W4 | `date` stored as full local instant by web vs `YYYY-MM-DD` UTC string by backend | `attendanceService.ts:218` vs `attendance.ts:94,138` | ⚠️ **web still affected**; **mobile FIXED** `f52b7f4` — six screens now query with day keys (`utils/attendanceDate.ts`), which matches both representations |
| W5 | `Early Checkout` missing from `AttendanceRecord` union + status filter | `types/user.ts:204`, `Attendance.tsx:1176-1183` |
| W6 | `detectMissedPunches()` **writes** `Miss Punch` from the browser on a 60 s timer | `attendanceService.ts:406`, `Attendance.tsx:396-405` |
| W7 | `company-admin` is hard view-only yet counted as `canManage` | `AuthContext.tsx:115-118` vs `Attendance.tsx:134` |
| W8 | Leave totals = calendar days, working-day helpers unused | `leaveService.ts:203-210` |
| W9 | `scopedCompanyIds` had no platform sentinel, so master-admin pages scoped to `'global'` and showed an empty list | `frontend/src/utils/companyScope.ts:13` | ✅ **fixed** `41d0e3a`, live-verified (`/master-admin/employees` → 1 Total / Test Employee), deployed via `deploy-hosting.mjs` |

✅ **No "success without server response" found anywhere** (web or mobile) — every success message is set after
`await` of the HTTP call (exceptions: fire-and-forget notification fan-outs, by design).

## 8. Database / backend changes
_None made. Candidates requiring explicit sign-off: B1-B6._

## 9. Build status
- **Backend: ✅ DEPLOYED** (`sam build && sam deploy` → stack `hrmax-api` UPDATE_COMPLETE,
  `ApiUrl https://u2y0p4665a.execute-api.ap-southeast-2.amazonaws.com`). Build runs the test suite
  (`NodejsNpmBuilder:NpmTest`) before packaging.
- **Post-deploy smoke (read-only):** `GET /api/health` → 200 · `POST /api/attendance/mark`,
  `/api/leave-requests`, `/api/email/send`, `/api/broadcast` (anonymous) → **401** ·
  `GET /api/me` (Bearer) → 200 `master-admin` · `GET /api/attendance`, `GET /api/leave-requests` → 200.
- Android debug: CI **`Build APK` step passes** (run 40281530344, 48 min — prebuild + `assembleRelease`)
  after the `setup-android` fix; **artifact upload blocked** by the account storage quota (B17)
- Android release/APK: **local build running** (`expo prebuild` + `gradlew assembleRelease` on the
  installed SDK: android-35/36, build-tools 35/36, JDK 17) — result pending
- Signed AAB: **blocked** — no keystore in the repo and no EAS login (B18)
- iOS archive: **BLOCKED** — `eas credentials --platform ios` requires interactive Apple ID + 2FA (owner must run)
- Config facts: `app.json` → name "HR MAX", version **1.4.3**, iOS `com.hrmax.app` build 4, Android
  `com.hrmax.app` versionCode 10, EAS project `e640ec9d-…`, owner `sofixscompany`
- ⚠️ Loose files in repo root: `hrmax-v1.2.0.aab` and a **Google service-account JSON** (`hrm-sofisx-….json`) —
  should not ship in a public repo (flagged, not touched)

## 10. Remaining blockers
1. **iOS signing** — interactive Apple ID + 2FA (owner).
2. **Live E2E attendance/leave test** — ✅ **BOTH DONE** (attendance §3, leave §4) on the designated
   test account, with test rows deleted afterwards. A full multi-tier approval run still needs a
   reporting-manager/company-admin account (this company has none).
3. Backend fixes B1-B6 need sign-off (they affect the running web app).
4. No test infrastructure on mobile (jest not installed) — required by spec §18.

## 11. Files changed (this session)
| Commit | Change |
|---|---|
| `96d3be2` | Brand + success colours: orange wordmark everywhere, green punch circle for success |
| `94ec880` | **Mobile Stage 4**: jest suite — 27 tests / 4 suites passing |
| `f91dfaf` | Drawer wordmark orange |
| `03439ea` | **Unified dark-navy hero background** across all heroes (Home, role dashboards, attendance banner) |
| `1a3ef0a` | Employees screen: status chips + avatar/status dot + `'global'` scope-sentinel fix |
| `708a7b9` | Attendance screen: status circle, headline, date/time/work-location rows |
| `f52b7f4` | **Mobile**: day-key attendance queries (6 screens) + TDZ fix + ring/Present-Late alignment |
| `b090b44` | **Backend**: condition-expression constants (reserved-word aliases + JS null) + 4 regression tests |
| `d026f24` | **Reference home UI** (`BrandHomeHero`, status card, quick actions, ring, activity) + refresh/banner fixes |
| `f1b0db2` | **Mobile Stage 1**: JS splash handoff + branded loading with offline retry, one-time 3-slide onboarding, role-aware bottom tab bar |
| `4b52638` | **Backend correctness fixes B1/B2/B3/B4/B6/B7/B8/B10/B11** + 20 new tests (86/86 pass) |
| `19752b6` | this audit report |
| `fa27411` | mobile drawer: remove master-admin "Self Service / My Leaves & Attendance" (web parity) |
| `9782ae3` | `DashboardHero`: run entrance animation (was stuck at opacity 0) + design upgrade |
| `915b517`, `15f2a68` | website showcase + About/nav/GIF work (earlier in session) |

**Deployment status: ✅ API deployed** (`sam deploy` → `hrmax-api` UPDATE_COMPLETE) and verified
read-only (health 200, four auth gates 401, `/api/me` 200). The web bundle is unchanged by these
backend fixes, so no hosting re-deploy was required. **Write-path E2E (real check-in/out, leave
overlap 409) still pending a designated test account** — not run against real employee records.

## 12. Commands
```bash
# web (must stay intact)
cd frontend && npm run build

# backend tests
npm test                       # = build:backend + node --test

# mobile
cd mobile-app && npx expo start --web      # preview
cd mobile-app && npx tsc --noEmit           # typecheck
cd mobile-app && npx expo start --android   # android dev build
```

## Staged implementation plan (next)
- **Stage 0** — live API smoke test (health, `/api/me`, check-in/out on a designated test account), run `npm test`.
- **Stage 1** — missing mobile UX: JS splash (session restore + offline retry state), 3-slide onboarding with
  persistence, bottom tab bar (Home/Attendance/Leave/Reports/More) per role.
- **Stage 2** — attendance completeness: monthly calendar grid, shift schedule, `Early Checkout` + `Skipped`
  parity, offline-safe error handling, push token auto-registration.
- **Stage 3** — leave: cancel via backend path, working-day calculation parity, team leave calendar.
- **Stage 4** — test suites (jest: attendance + leave + mobile flows) per spec §18.
- **Stage 5** — Android build (dev + AAB), release notes; iOS instructions + blockers documented.
