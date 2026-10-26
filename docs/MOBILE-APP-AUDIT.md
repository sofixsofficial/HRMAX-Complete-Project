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

**Live E2E test: ⏳ PENDING** (Stage 0 — needs a test account + API reachability check).

## 4. Leave management audit results

Apply (web `leaveService.ts:606-706`, mobile `leaveService.ts:198-288` → `mobileCreateLeaveRequest` →
`POST /api/leave-requests`) → tier review (`review-tier`, order
`['reportingManager','companyAdmin','executive','teamLeader']`, `types.ts:101`) → optional MA gate → status via
`deriveStatus` (87-99). Balance computed **client-side only** (`frontend/src/services/leaveService.ts:134`,
mobile `:713`). Working-day helpers exist (`frontend/src/utils/workingDays.ts`) but are **not used for leave day
counts** — `calcLeaveDays` (`leaveService.ts:203-210`) is a plain calendar-day diff.

**Live E2E test: ⏳ PENDING** (Stage 0).

## 5. Feature checklist vs mobile spec

| Spec area | Status | Evidence |
|---|---|---|
| Splash | ⚠️ **PARTIAL** | native config only (`app.json:38-46`, `assets/splash.png`); **no JS splash** — no `preventAutoHideAsync/hideAsync` anywhere; `LoadingScreen.tsx` is the stand-in |
| Onboarding (3 slides) | ❌ **MISSING** | no file/route/state/dep |
| Login / forgot / reset / change pw / edit profile | ✅ EXISTS | `auth/LoginScreen.tsx`, `ForgotPasswordScreen.tsx`, `VerifyResetCodeScreen.tsx`, `SettingsScreen.tsx:66-97`, `MyProfileScreen.tsx:34-44` |
| Session restore + secure token storage | ✅ EXISTS | `AuthContext.tsx:65-76`, `safeStorage.ts:13-45` (SecureStore), token refresh `aws/auth.ts:138-149` |
| Account-disabled / pending-approval states | ⚠️ PARTIAL | backend rejects `Suspended`/`Rejected` (`auth.ts:93-96`); mobile shows generic error text |
| Multi-company selection | ✅ EXISTS | `CompanyContext.tsx` |
| Dashboard per role | ✅ 6 dashboards | `src/screens/dashboards/*` + `DashboardRouter.tsx:125-133` |
| Attendance module | ✅ **mostly** | My Attendance `AttendanceScreen.tsx:710`, history `:839-873`, detail modal `:1040-1070`, working hours `:746`, late `:597-599`, miss-punch + correction `attendanceApi.ts:83-182`, team attendance `:217-241`, CSV export `:521-524`, admin dashboards |
| … monthly calendar **grid** | ❌ **MISSING** | only month stats (`AttendanceScreen.tsx:204-212,801-820`) |
| … shift schedule screen | ❌ **MISSING** | only `defaultShiftStart` read (`useAttendanceGate.ts:141-143`) |
| … early-departure flag | ❌ **MISSING** on mobile | backend writes `Early Checkout` (`attendance.ts:167,173`); not in mobile status list |
| Leave module | ✅ **mostly** | balance `LeaveScreen.tsx:381-404`, apply `ApplyLeaveScreen.tsx:129`, my requests `:424-470`, details `:519-610`, approvals `LeaveApprovalsPanel.tsx`, MA gate |
| … cancel leave | ⚠️ **inconsistent** | mobile writes Firestore directly (`LeaveScreen.tsx:212`) while create/review go through backend |
| … team leave calendar | ❌ missing as a dedicated screen (only inside `CalendarCenterScreen.tsx:129-136`) |
| Employee directory | ✅ EXISTS | `AddressBookScreen.tsx` (search `:57-68`, A-Z `:75-78`, detail `:178-190`, CSV `:85`) + admin CRUD `master-admin/EmployeesScreen.tsx:540+` |
| Notifications | ✅ EXISTS + ⚠️ | inbox `NotificationsScreen.tsx:50-69`, read/unread `:117-69`, push token `useNotifications.ts:24-52` — **not auto-registered on login** (manual toggle only) |
| Profile / settings / more | ✅ EXISTS | `SettingsScreen.tsx`, `MyProfileScreen.tsx` |
| Reports + payslip PDF | ✅ EXISTS | `ReportsScreen.tsx:90-95` (incl. Attendance Summary) + CSV `:104-175`; `utils/payslipPdf.ts:341` |
| **Bottom navigation (Home/Attendance/Leave/Reports/More)** | ❌ **MISSING** | `bottom-tabs` installed, **0 imports**; nav = drawer + stack |
| Design tokens / dark mode | ⚠️ PARTIAL | `ThemeContext.tsx` = **colors only** (40 keys); no spacing/typography tokens; light+dark ✅ (`app.json:8 automatic`) |
| Skeletons / empty states / error states | ✅ / ⚠️ | `SkeletonLoader.tsx`, `EmptyStateView` (25+ screens); **no shared `ErrorState` component** |
| Safe areas | ✅ | `SafeAreaProvider`, iOS `infoPlist` strings (`app.json:17`), camera/location/notification permission plugins |
| Tests | ❌ **NONE** | 0 test files, no jest, no `test` script, no eslint config (`lint` script exists but eslint isn't a dep) |
| Offline attendance queue | ❌ **MISSING** | no queue/retry anywhere — a failed punch is lost |

**Role support:** 6 declared roles ✅ (all have dashboards). `hr-manager` exists only as an ad-hoc string in 8
mobile files (falls back to `EmployeeDashboard`); `regional-manager` does not exist. Backend has neither.

## 6. Tests

- **Existing:** `backend/aws/test/routes.test.js` (route mounting, 401-for-anonymous on
  `GET /api/attendance`, `POST /api/attendance/mark`, `GET /api/leave-requests`) and `smoke.test.js`
  (`TIER_ORDER` 164-167, permission assertions 122-145). Run: `npm test` = `build:backend` + `node --test`.
- **Coverage vs spec:** attendance = mounting only; leave = mounting + constants. ❌ No duplicate-check-in,
  geofence, state-machine, rectification, leave apply/approve/balance tests. ❌ No frontend/mobile tests at all.
- **Execution this session: ✅ 86/86 pass** (`npm test`, run twice back-to-back to prove stability)
  - baseline before changes: **66/66**
  - added `backend/aws/test/attendance-leave.test.js` (+20): status-machine boundaries, company-timezone
    day/minute maths (the UTC/IST proof), `enableGeofence`→`requireGeofence` flag mapping, haversine distance,
    leave date parsing / inclusive duration / overlap rules, `ConditionalWriteFailed` contract
  - also fixed test isolation: tests no longer write live rate-limit counters (`HRMAX_DISABLE_RATE_LIMIT`)

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

### Web-only (context for mobile parity)
| # | Finding | File:line |
|---|---|---|
| W1 | Selfie captured on web but **never sent** in either payload → `SELFIE_REQUIRED` if policy on | `Attendance.tsx:122-123,495-508,574-586` vs `attendance.ts:127-128` |
| W2 | Wi-Fi SSID allow-list dead — `wifiSsid` hardcoded `null` | `utils/networkUtils.ts:26` |
| W3 | Status/late/on-leave/workHours computed **client-side** (employee shift) while backend uses company default shift | `attendanceService.ts:184-206,259-277,61-73` vs `attendance.ts:135` |
| W4 | `date` stored as full local instant by web vs `YYYY-MM-DD` UTC string by backend | `attendanceService.ts:218` vs `attendance.ts:94,138` |
| W5 | `Early Checkout` missing from `AttendanceRecord` union + status filter | `types/user.ts:204`, `Attendance.tsx:1176-1183` |
| W6 | `detectMissedPunches()` **writes** `Miss Punch` from the browser on a 60 s timer | `attendanceService.ts:406`, `Attendance.tsx:396-405` |
| W7 | `company-admin` is hard view-only yet counted as `canManage` | `AuthContext.tsx:115-118` vs `Attendance.tsx:134` |
| W8 | Leave totals = calendar days, working-day helpers unused | `leaveService.ts:203-210` |

✅ **No "success without server response" found anywhere** (web or mobile) — every success message is set after
`await` of the HTTP call (exceptions: fire-and-forget notification fan-outs, by design).

## 8. Database / backend changes
_None made. Candidates requiring explicit sign-off: B1-B6._

## 9. Build status
- Android debug: **not run this session**
- Android release/AAB: **not run** (prebuilt `artifacts/*.aab` exist; CI `build-apk.yml`, `android-build.yml` exist;
  `eas.json` production → app-bundle, Google Play service-account key present)
- iOS archive: **BLOCKED** — `eas credentials --platform ios` requires interactive Apple ID + 2FA (owner must run)
- Config facts: `app.json` → name "HR MAX", version **1.4.3**, iOS `com.hrmax.app` build 4, Android
  `com.hrmax.app` versionCode 10, EAS project `e640ec9d-…`, owner `sofixscompany`
- ⚠️ Loose files in repo root: `hrmax-v1.2.0.aab` and a **Google service-account JSON** (`hrm-sofisx-….json`) —
  should not ship in a public repo (flagged, not touched)

## 10. Remaining blockers
1. **iOS signing** — interactive Apple ID + 2FA (owner).
2. **Live E2E attendance/leave test** — needs a designated test account; must not touch real records.
3. Backend fixes B1-B6 need sign-off (they affect the running web app).
4. No test infrastructure on mobile (jest not installed) — required by spec §18.

## 11. Files changed (this session)
| Commit | Change |
|---|---|
| `4b52638` | **Backend correctness fixes B1/B2/B3/B4/B6/B7/B8/B10/B11** + 20 new tests (86/86 pass) |
| `19752b6` | this audit report |
| `fa27411` | mobile drawer: remove master-admin "Self Service / My Leaves & Attendance" (web parity) |
| `9782ae3` | `DashboardHero`: run entrance animation (was stuck at opacity 0) + design upgrade |
| `915b517`, `15f2a68` | website showcase + About/nav/GIF work (earlier in session) |

**Deployment status:** committed but **not yet deployed** — `sam deploy` (API) and
`node scripts/deploy-hosting.mjs` (web) await a go/no-go: these change live behaviour
(geofence enforcement, Late detection, leave overlap → 409).

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
