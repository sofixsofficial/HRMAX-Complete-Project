# Auth, Authorization & Storage Inventory - HRMAX (Firebase reference project)

> **Source of truth:** `C:\Users\azayy\Documents\HRM-Main\HRMAX` (read-only analysis).
> Everything below was derived from actual code (`frontend/src`, `mobile-app/src`, `backend/functions/src`,
> `firestore.rules`, `storage.rules`, `firebase.json`) - nothing is assumed from READMEs unless explicitly
> flagged as stale documentation.
>
> **Reference notation:** `file:line` points at the exact statement that proves the claim.
> Line numbers are from the original Firebase project at analysis time.

---

## 1. How to read this document

Authorization in this project is enforced in **four independent layers**. Any layer can be the one that
actually blocks (or fails to block) a request, so the AWS rewrite must reproduce the *effective* union:

| Layer | Where | What it gates | Uses claims? |
|---|---|---|---|
| **Client-side checks** | `AuthContext.hasPermission` (web + mobile), route guards, sidebar filters | UI visibility only - never trusted | No (reads Firestore `users` doc) |
| **Firestore security rules** | `firestore.rules` (1340 lines) | Direct client reads/writes to Firestore | **No** - rules call `getUserData()` (a `get()` on `users/{uid}`) for role/companyId (except one storage helper, see 5.2) |
| **Callable function gates** | `backend/functions/src/*` | All Admin-SDK writes (bypass rules entirely) | Sometimes (`context.auth.token.role`), often re-reads the Firestore doc |
| **Storage security rules** | `storage.rules` (140 lines) | Bucket uploads/downloads | Mostly via `firestore.get()` helper; `isMasterAdmin()` reads `request.auth.token.role` |

**Global facts (verified):**

- **6 canonical roles** (single source: `backend/functions/src/index.ts:151-158` `VALID_ROLES`, mirrored by
  `frontend/src/types/user.ts:3`): `master-admin`, `company-admin`, `team-leader`, `executive`,
  `reporting-manager`, `employee`. Comment at `index.ts:32-34`: "All legacy/orphaned role strings have been purged."
- **Legacy role strings still referenced** in shipped rules/code (the purge was incomplete):
  `super_admin` and `company_admin` (`firestore.rules:405,410`; `storage.rules:20,31,44`),
  `hr-manager` (`firestore.rules:276`, `mobileApi.ts:390-394` `TIER_ROLES.reportingManager`).
- **Custom claims carry only `{ role, companyId }`** - permissions are deliberately NOT in claims because of
  Firebase Auth's 1000-character claim limit (`index.ts:242-246`, also stated at `:1119-1128`, `:1357-1360`).
- **Permissions live on the Firestore `users` doc** (`permissions: string[]`, plus `permissionsConfigured`
  and `permissionScopes`) - see 2.3 and 3.1.
- **Password auth is Email/Password only** (`createUserWithEmailAndPassword` / `signInWithEmailAndPassword`
  throughout `authService.ts`). No custom token, no federated providers in code.
- **Firebase config:** web bucket comes from `VITE_FIREBASE_STORAGE_BUCKET` (`frontend/src/firebase/config.ts:12`);
  emulator wiring exists in `firebase.json:58-78` but the `connect*Emulator` calls are commented out
  (`frontend/src/firebase/config.ts:28-33`).
- **Rules backup:** `firestore.rules.backup` is byte-identical to `firestore.rules` (diff = 0 lines), so there
  is only one ruleset to reason about.

---

## 2. Auth model

### 2.1 Roles

| Role | Created by | Scope fields on `users` doc |
|---|---|---|
| `master-admin` | One-time bootstrap `setupMasterAdmin` (`authService.ts:909-961`; refuses if one exists, `:920-928`); `companyId` is the literal string `'master-admin'` (`:940`) | none (sees everything; `getScopedCompanyIds` returns `[]` = all companies, `AuthContext.tsx:169-170`) |
| `company-admin` | Client signup `signUpCompany` (`authService.ts:124-208`) or callable `createCompany` (`index.ts:261`); **approval gate**: sign-in rejected while `status` is `Pending`/`Rejected`/`Suspended` (`authService.ts:235-249`) | `companyId`, `status`, `isApproved`, `approvedBy/At` |
| `executive` | `createStaffUser` / invite accept / `mobileCreateEmployee` | `assignedCompanyIds[]`, portfolio links |
| `team-leader` | same | `reportingExecutiveId`, `linkedExecutiveIds[]`, `assignedCompanyIds[]`, `contingencyAccess` |
| `reporting-manager` | same | `companyId`, `reportingEmployeeIds[]` (backfilled at `index.ts:1153-1171`), `isReportingManager` |
| `employee` | same | `companyId`, `reportingManagerId/Name` |

### 2.2 Custom claims

- **Contents:** `{ role, companyId }` only. Set at `index.ts:243-246` (`setCustomClaims`),
  `:334-337` (`createCompany`), `:799-802` (`acceptInvitation`), `:1134-1139` (`createStaffUser`, failure is
  non-fatal), `:1359-1362` (`syncUserClaims`), `mobileApi.ts:948-951` (`mobileCreateEmployee`),
  and the demo seeder `backend/scripts/seed-demo.js:191`.
- **Ordering invariant:** every backend path writes `users/{uid}` **before** setting claims - a token whose
  claims point at a missing user doc makes every rules `getUserData()` lookup deny ("Missing or insufficient
  permissions" ghost). Documented at `index.ts:232-234`, `:781-785`, `:1120-1128`.
- **Who may set claims:** `setCustomClaims` requires master-admin, verified against the **Firestore doc**
  (not stale claims), and **blocks self-escalation** (`index.ts:205-226`). `syncUserClaims` requires the
  master-admin role in **both** claims and Firestore doc (`index.ts:1322-1331`).
- **Client-side account creation never sets claims.** `signUpCompany`, client `acceptInvitation`, and
  `updateUserRole` only write Firestore (`authService.ts:176-180`, `:768-772`, `:586-607` - the last even
  comments "in a production app you would also update custom claims via Cloud Function", `:609-610`).
  Users created through those paths have **no role claim** until a master-admin runs `syncUserClaims`.
  Anything gated on `context.auth.token.role` (2.4) fails for them.
- **Who reads claims:**
  - `emailService.ts:387-399` - `assertAdmin` (master-admin/company-admin) and `assertMasterAdmin`.
  - `index.ts:222` (claims fallback for `setCustomClaims`), `index.ts:1322` (`syncUserClaims`).
  - `storage.rules:18-22` - `isMasterAdmin()` accepts `token.role in ['master-admin','super_admin']`.
  - Client reads claims at sign-in (`authService.ts:223-224`) but authorizes from the Firestore doc.
  - **Firestore rules never read claims** for role/companyId (they use `getUserData()`).

### 2.3 Authorization data stored on `users/{uid}`

| Field | Meaning | Written by |
|---|---|---|
| `role` | One of the 6 roles (rules also tolerate `super_admin`/`company_admin`/`hr-manager`) | invites, `createStaffUser`, `updateUserRole` |
| `companyId` | Tenancy key; `'master-admin'` literal for MA | account creation |
| `permissions: string[]` | Dot-notation grants (see 3.1); `['*']` = full; `['none']` = explicit deny sentinel | `getPermissionArray` / `FULL_PERMISSION_CATALOG` / permission matrix editor |
| `permissionsConfigured: boolean` | Once `true`, rules/client stop granting role defaults and bind the stored keys exactly (`firestore.rules:55-64`, `AuthContext.tsx:125-127`) | `updateUserRole`... no - only `updateUserPermissions` (`authService.ts:649-656`) |
| `permissionScopes: {module: 'all'\|'assigned'}` | Per-module company visibility; **scope editor removed from UI** and stale scopes are deleted on save (`authService.ts:621-623`, `:652`) | legacy |
| `status` / `isApproved` / ... | Company-admin approval workflow, enforced at sign-in (`authService.ts:235-249`) | master-admin approval pages |
| `permissionsUpdatedAt` | audit timestamp | `authService.ts:653` |

### 2.4 Auth flows (both paths exist - verify which is live)

| Flow | Client-side path (direct Firestore) | Backend callable path (Admin SDK) |
|---|---|---|
| Signup company | `signUpCompany` `authService.ts:124-208` (creates company + user doc, **no claims**) | `createCompany` `index.ts:261` (**sets claims**, slug uniqueness check `:276`) |
| Invite | `inviteUser` `authService.ts:843-904` (base64 32-byte token, 7-day expiry, link base `https://sofixs-hrm.web.app` `:877`) | `inviteUser` `index.ts:593` (callable, sends email via `sendEmailCentral`) |
| Accept invite | `acceptInvitation` `authService.ts:708-838` (**no claims**) | `acceptInvitation` `index.ts:732` (**sets claims**, increments `companies.employeeCount`, audit log) |
| Password reset | Firebase email reset (`authService.ts:314-331`) + 6-digit code flow writing `resetCodes` directly (`:336-383`) - **client `resetCodes` writes are default-denied by the shipped rules, see 4.4** | `sendResetCode` `index.ts:1584`, `resetPasswordWithCode` `index.ts:1631` (Admin SDK) |
| Staff creation | - | `createStaffUser` `index.ts:852`, `mobileCreateEmployee` `mobileApi.ts:899` |
| Public (no auth) | - | `corporateInquiry` `index.ts:1435`, `sendSupportTicket` `index.ts:1497` (auth optional), reset-code callables |

---

## 3. Permission system

### 3.1 Permission vocabularies (three generations coexist)

| Generation | Shape | Count | Where |
|---|---|---|---|
| **A. Legacy snake_case** | `employee_view`, `user_invite`, `payroll_process`, ... | 24 mapped keys | `getFullPermissions` defaults `index.ts:46-117`; normalization table `legacyToDotPerms` `index.ts:125-137`, `normalizeLegacyPermissions` `:138-146` |
| **B. Backend dot catalog** | `employees.view`, `payroll.calculate`, `support.approve`, ... | **92 keys / 14 modules** (code comment at `index.ts:160` says "53 permissions" - stale, actual array is 92 entries, verified by count) | `FULL_PERMISSION_CATALOG` `index.ts:162-191`; default for exec/TL created via `createStaffUser` (`index.ts:1046-1047`) |
| **C. Matrix vocabulary** | module x one of 12 actions: `view create edit delete approve reject cancel calc disburse export download manage` | **23 modules, 118 matrix keys** | `permissionConfig.ts:50-63` (actions), `:77-101` (modules), `TOTAL_PERMISSION_KEYS` `:127` |

Matrix modules (`permissionConfig.ts:77-101`), grouped in 6 categories (`:67-74`):
`dashboard, companies, departments, holidays, announcements | executives, team-leaders, employees, birthdays, addressbook | attendance, leave, tasks, calendar, documents | payroll, salary, reports, analytics | emails, settings, access, support`.

**Vocabulary skew between B and C (must be reconciled in AWS):**

- B has `payroll.calculate`; C's action is `calc` -> matrix key `payroll.calc`.
- B contains `*.approve` keys for `employees/companies/departments/settings/assets/holidays/announcements/support`
  that have **no column** in the matrix (e.g. `employees` actions exclude `approve`, `permissionConfig.ts:85`).
- C has modules B lacks entirely: `dashboard, executives, team-leaders, birthdays, addressbook, calendar,
  documents, analytics, emails, access` - while B has `assets` which C lacks.
- Legacy-only keys still honoured by rules: `assets.view` (used in `LEGACY_ROLE_DEFAULT_PERMS` exec default,
  `permissionConfig.ts:271`) and alias `asset_create -> assets.create` (`firestore.rules:104`).

**Rule-side alias table** (`firestore.rules:95-110` `legacyPermissionAlias`), applied by rules `hasPermission`:
`departments.add->departments.create`, `user_invite->employees.create`, `attendance.mark->attendance.create`,
`email_view/create/edit/delete->emails.*`, `asset_create->assets.create`, `payroll.payslip->payroll.download`,
`employees.import->employees.create`, `employees.export->employees.export`.

**Matrix compression** (`permissionConfig.ts:137-178`): all enabled -> `['*']`; none -> `['none']`
(explicit deny, NOT full access); fully-enabled module -> `module.*`; otherwise individual keys.
Both enforcement layers treat `module.*` and `module.manage` (and rules also `module_manage`) as
"every action in the module", and `*` as full access (`permissionConfig.ts:11-15`,
`firestore.rules:112-129`, `AuthContext.tsx:149-157`).

### 3.2 Role default permission sets

| Source | master-admin | company-admin | team-leader | executive | reporting-manager | employee |
|---|---|---|---|---|---|---|
| **Client `getPermissionArray`** (`authService.ts:54-93`) | `['*']` | 11 view-ish keys incl. `salary.edit` (`:57-72`) | `['*']` | `['*']` | 7 keys (`leave.*`, `employees.view`, `attendance.view`, `reports.view`) | 8 view keys (`leave.apply` included) |
| **Backend `getFullPermissions`** (`index.ts:46-117`, snake_case then normalized) | all-true | full ops incl. `employee_edit`, `payroll_edit`, `role_assign` | same as CA | same as CA | view + `attendance_edit/approve`, `leave_approve` | view-only |
| **`createStaffUser` fallbacks** (`index.ts:1044-1050`) | - | - | `FULL_PERMISSION_CATALOG` (92) | `FULL_PERMISSION_CATALOG` (92) | 7 dot keys | 5 dot keys |
| **Legacy role defaults** (`LEGACY_ROLE_DEFAULT_PERMS` `permissionConfig.ts:252-273`, mirrored verbatim in rules `firestore.rules:33-45`) | - | - | 16 keys | 19 keys | - | - |

The legacy defaults matter: rules `isLegacyRoleDefault()` (`firestore.rules:46-53`) grants **full access** to
any TL/Exec still carrying exactly those 16/19-key arrays, and `isFullAccessMatrix()` (`:58-64`) additionally
treats *unset/empty* or `['*']` matrices as full access until an admin saves a matrix
(`permissionsConfigured == true`). Same logic client-side at `AuthContext.tsx:119-137`.

**Core-CRUD default grant** (`firestore.rules:66-91`, `permissionConfig.ts:303-355`): TL gets
`companies.*` + `executives.*` + `employees.*` (12 keys), Exec gets `employees.*` (4 keys) as default-on
unless `permissionsConfigured`. Client mirror: `AuthContext.tsx:130-131` (`isCorePermissionKey`).

### 3.3 Client-side permission checking

Web `hasPermission` (`AuthContext.tsx:107-158`), evaluated top-down:

1. `company-admin` -> **hard view-only regardless of stored array**: only actions `view`, `reports`,
   `analytics` pass (`:111-114`).
2. `master-admin` -> always `true` (`:117`).
3. `executive` / `team-leader` -> matrix engine: configured+empty = deny (`:127`); unconfigured+empty/`*` = allow
   (`:128`); exact legacy-default set = allow (`:129`); unconfigured core-CRUD key = allow (`:131`);
   exact key / `module.*` / `module.manage` = allow (`:132-136`); else deny.
4. `employee` -> hardcoded allow for `leave.apply|leave.create|leave.view|attendance.view|attendance.create`
   (`:141`).
5. `reporting-manager` -> hardcoded `employees.view` + `leave.*` four actions (`:144-147`).
6. fallback: `*`, exact key, `module.*`, `module.manage` (`:149-157`).

Mobile duplicate: `mobile-app/src/context/AuthContext.tsx:176-227` - **one divergence**: company-admin gets
`if (permission.startsWith('leave.')) return true` (`:181`), which the web version does not have.
Mobile nav consumes it through `usePermissions.ts:10-21`.

### 3.4 Data scoping (which companies a role may touch)

- `getScopedCompanyIds` (`AuthContext.tsx:165-184`): MA -> `[]` (all); CA/RM/employee -> own `companyId`;
  Exec -> `overrideIds || assignedCompanyIds`; TL -> `overrideIds` (from TL filter context).
- `permissionScopes[module] == 'assigned'` narrows TL/Exec to their own company
  (`permissionConfig.ts:281-301`), mirrored by the hook `usePermissionScope` (`usePermissionScope.ts:20-44`)
  and enforced server-side by rules `isFullScopeForModule` (`firestore.rules:134-138`) -> `canScopeRecord`
  (`:215-221`) / `canCrudScoped` (`:231-238`).
- Company switching is blocked UI-side by `CompanyRouteGuard` (`CompanyRouteGuard.tsx:9-34`) for restricted
  roles; mobile mirror: `mobile-app/src/context/CompanyContext.tsx:51-52, 218-241` (employee hard-locked).

### 3.5 UI gating (routes & sidebar)

- `ProtectedRoute` (`ProtectedRoute.tsx:26-88`) - role allow-lists only; forces a token+doc refresh on mount
  (`:43-49`). Role wrappers: `MasterAdminRoute` `['master-admin']`, `CompanyAdminRoute` `['master-admin','company-admin']`,
  `TeamLeaderRoute` `+team-leader`, `ExecutiveRoute` `+executive` (`:99-124`), `EmployeePageRoute`
  `['master-admin','company-admin','employee']`, `ReportingManagerPageRoute` `['master-admin','company-admin','reporting-manager']`
  (`RoleRouteGuard.tsx:64-81`).
- `PublicOnlyRoute` maps role -> dashboard path (`ProtectedRoute.tsx:154-163`).
- `useProtectedRoute(requiredPermissions[], requiredRoles[])` (`AuthContext.tsx:217-236`) - every permission must pass.
- Sidebar filters each item by `requiredPermission` + `requiredRoles` (`Sidebar.tsx:61-66`; item lists `:110-113`,
  `:170-218`, `:233-235`); `requiresScope` items are blocked until a company is selected (`Sidebar.tsx:68-78`).

---

## 4. Authorization matrix (Firestore rules)

### 4.1 Rules helper functions (`firestore.rules:9-298`, verbatim-summary)

| Helper | Line | Semantics |
|---|---|---|
| `getUserData()` | 13 | `get(users/{request.auth.uid})` - **rules read role/companyId from Firestore, not claims** |
| `isSuperAdmin()` / `isCompanyAdmin()` / `isExecutive()` / `isTeamLeader()` / `isReportingManager()` | 140-169 | role == literal (hyphenated) |
| `belongsToCompany(cid)` | 148 | caller's doc `companyId == cid` |
| `isExecutiveForCompany(cid)` | 159 | executive, **no company binding** - "Executives operate across ALL companies" (`:156-158`); writes still need `hasPermission` |
| `isTeamLeaderLinkedTo(execId)` | 179 | own `reportingExecutiveId` or `linkedExecutiveIds` contains exec |
| `isTeamLeaderScopedForCompany(cid)` | 193 | own company match **or** `companies/{cid}.assignedExecutiveId` is linked to caller (extra `companies` get per evaluation) |
| `isTeamLeaderAssignedToCompany(cid)` | 205 | `assignedCompanyIds` contains cid (mirrors app-side teamLeader tier resolution) |
| `isMatrixRole()` / `isLegacyRoleDefault()` / `isFullAccessMatrix()` | 25-64 | TL/Exec matrix state machine (see 3.2) |
| `isCoreCrudKey/Granted(perm)` | 71-91 | default-on core CRUD unless `permissionsConfigured` |
| `legacyPermissionAlias(p)` | 95-110 | 11 alias mappings (see 3.1) |
| `hasPermission(p)` | 112-129 | alias -> then `isFullAccessMatrix OR isCoreCrudGranted OR stored has [p] / [snake] / [module.*] / [module.manage] / [module_manage]` |
| `isFullScopeForModule(m)` | 134-138 | `permissionScopes[m] != 'assigned'` |
| `canScopeRecord(cid, m)` | 215-221 | own company OR (full scope AND (exec OR TL-company OR TL-scoped)) |
| `canManageCompany(cid)` | 223-225 | MA OR (CA of that company) |
| `canCrudScoped(cid, perm)` | 231-238 | exec/TL writer gate: scope check AND `hasPermission` |
| `canManageAttendance(cid)` | 244-252 | MA OR CA-of-company OR (exec/TL with `attendance.manage`) OR **any reporting-manager of the company** |
| `canReviewMissedPunchRecord(cid, rec)` | 262-298 | tier-approver bypass: matches `missedPunchRectification.approverIds.{companyAdmin\|executive\|reportingManager\|teamLeader}` to `request.auth.uid`; accepts roles `reporting-manager` **or `hr-manager`** (`:276`); three TL variants + linked-exec contingency (`:285-296`) |

### 4.2 Per-collection rules matrix (37 `match` blocks + default deny)

Legend: **S** = a statically-true disjunct exists (grants the operation regardless of document data - see 4.3),
**[n]** = `firestore.rules` line of the block.

| Collection [line] | Read | Create | Update | Delete |
|---|---|---|---|---|
| `companies` [306] | get: MA / exec / full-scope TL / TL-scoped / member; **list: ...OR any authenticated [323] S** | MA / TL+`companies.create` / exec+`companies.create` | MA / TL or exec+`companies.edit` / CA-of-co with **field allow-list** [335-342] | MA / TL or exec+`companies.delete` |
| `dashboardStats` [352] | MA or member company | member + `dashboard.manage` | same | MA |
| `users` [369] | get: MA / self / TL-linked exec / full-scope TL / exec-of-TL / member+`employees.view` / scoped+`employees.view`; **list: any authenticated [382] S** | self-doc / member+`user_invite` / exec-TL+`employees.create` / TL creating an exec [384-393] | MA / self with 14-field allow-list [396-402] / member+`employees.edit` **(broken `!= 'company_admin'` guard, 6.6)** / exec-TL+`employees.edit` minus `permissions` key [406-411] / exec of TL / TL of exec (no `role,permissions,permissionScopes,permissionsConfigured,companyId`) [414-420] / MA portfolio reassignment 6-field allow-list [421-426] | MA / exec-TL+`employees.delete` / TL of exec / CA of own company (never self) [428-440] |
| `departments` [446] | MA / member / scoped | MA / `canCrudScoped(...departments.create)` / exec+`departments.add` / member+alias | analogous `departments.edit` | `departments.delete` |
| `invitations` [477] | MA / inviter / member+`user_invite` / pending+`limit==1` query [482-483] | MA / exec-TL+`employees.create` / member+`user_invite` (inviter must be self) | **`if false` [497]** | MA / inviter of a pending invite |
| `audit_logs` [510] | MA/CA/exec/TL or own entry | **only `userId == request.auth.uid` [517-518]** (anti-forgery) | MA | MA |
| `attendance` [531] | MA / own / scoped / missed-punch approver / RM-of-co / member+`attendance.view` | `canManageAttendance` **or self-check-in in own company** [547-550] | `canManageAttendance` / tier approver / self with 8-field allow-list incl. `missedPunchRectification` [557-563] | `canManageAttendance` |
| `adminAlerts` [574] | MA/CA/exec/TL/RM **and** MA-or-company-scoped [587-589]; **list: role only, no company filter [591-592] S** | same roles + company scope (MA unscoped) | MA | MA |
| `salary_slips` (legacy) [606] | MA / own / member+`payroll.view` | MA / member+`payroll.manage` | MA / member+`payroll.manage` | MA / member+`payroll.manage` |
| `leave_requests` (legacy) [624] | MA / own / approver / member+`leave.view` / scoped | MA / exec+`leave.approve` / self-apply (any company string) / non-self by company+(`leave.approve|manage|create` OR `isReportingManager()`) | MA / exec+`leave.approve` / member+(self or `leave.approve`) **- no tier-routing on this legacy block** | MA / `leave.delete` / own |
| `tasks` [658] | MA / assignee / creator / scoped+`tasks.view` | MA / `canCrudScoped` / exec+`tasks.manage` / member+`tasks.create` | assignee (unconditional) / crud / exec+manage / member+`tasks.edit` | MA / crud / exec+manage / member+`tasks.delete` |
| `holidays` [689] | MA / `companyId==null` (global) / member / scoped | crud / exec+`tasks...` -> `holidays.manage` / member+`holidays.create` | `holidays.edit` variants | `holidays.delete` variants |
| `tickets` [717] | MA / creator / scoped+`employees.view` / member+`employees.view` | MA / exec-of-co / member (any member!) | MA / creator / exec+`employees.edit` / member+`employees.edit` | MA / `canCrudScoped(...support.delete)` |
| `conversations` [749] (+ `messages` [770]) | MA / participant; **list: MA/co-member/exec/TL [753-756] S** | MA / participant-in-payload + member-or-exec | MA / participant | MA |
| `employees` [789] | MA / own / member+(CA or `employees.view`) / scoped; **list: any authenticated [796] S** | MA / crud / exec+`employees.create` / member+`employees.create` | `employees.edit` variants | `employees.delete` variants |
| `employees/{id}/bankAccounts` [823] | MA / member+`employees.view` (company resolved via parent doc `get()` [818-820]) | MA / crud / member+`employees.edit` | same | same |
| `employees/{id}/documents` [845] | same read | MA / `canCrudScoped(...documents.create)` / member+`employees.edit` | `documents.edit` variants | same |
| `employees/{id}/contracts` [862] | same read | `employees.edit` variants | same | same |
| `announcements` [887] | MA / member / scoped | crud / exec+`announcements.create` / member+same | MA / exec+`announcements.edit` / member+(**CA unconditional** OR `announcements.edit`) | `announcements.delete` (+CA unconditional) |
| `assets` [916] | MA / member / **list exec full-scope S** | MA / crud(`asset_create` alias) / exec / member | MA / crud(`asset_edit`) / **member unconditional [932]** | MA / crud(`asset_delete`) / **member unconditional [936]** |
| `leaveRequests` (camel) [942] | MA / own / `approverIds.reportingManager==self` / **any user with non-null `companyId` [946] S** / scoped+`leave.view` | MA / exec+`leave.approve` / self-apply / non-self by company+(`leave.approve|manage|create` OR RM) | **4-tier routing** [971-991]: MA / exec+`leave.approve` / member+self-or-`leave.approve` / **RM routed to `approverIds.reportingManager` / CA routed to `approverIds.companyAdmin` / exec routed to `approverIds.executive` / TL-scoped routed to `approverIds.teamLeader`** | MA / `leave.delete` / own |
| `salarySlips` [1002] | MA / own / scoped(`payroll`) | MA / exec+`payroll.manage` / TL-of-co+`payroll.manage` | MA / **CA of own company unconditional [1018]** (5-day correction UI) / exec+`payroll.manage` / TL+`payroll.manage` | **MA only [1021]** |
| `payrollRuns` [1029] | MA / scoped / exec-TL full-scope / any co-member | MA / exec+`payroll.manage` / TL+`payroll.manage` | same | **MA only** |
| `payrollAudit` [1051] | MA / scoped | MA / exec-TL+`payroll.manage` | MA | MA |
| `salaryStructures` [1067] | MA / scoped / exec-TL full-scope / any co-member | MA / exec+`salary.manage` / TL+`salary.manage` | same | exec+`salary.manage` / TL+`salary.manage` |
| `emails` [1092] | get: MA / CA / full-scope TL / scoped+`emails.view`(alias `email_view`) / member+view; **list: ...OR CA / exec / TL S [1114-1118]** | MA / exec+`emails.create` / member+`emails.create` | `emails.edit` variants | `emails.delete` variants |
| `performanceReviews` [1136] | MA / own / member+`employees.view` | MA / exec+`employees.edit` / member+`employees.edit` | same | same |
| `roles` [1162] | **any authenticated [1163] S** | MA / **CA of own company [1165]** | MA / CA of own company | MA |
| `documents` (top-level) [1174] | MA / own / member+`employees.view` | MA / exec+`employees.edit` / member+`employees.edit` | same | same |
| `notifications` [1199] | MA / own | **any authenticated if payload has non-empty `userId` [1206-1208] S (can target anyone)** | MA / own | MA / own |
| `transfers` [1220] | MA / exec who is source or dest; list: MA / full-scope exec | **MA only + `initiatorId==self` + `status=='completed'` + 10-key `hasAll` [1233-1241]** (mobile writer shape violates this, see Doc 1 §6.5) | MA | **`if false` [1245]** (immutable) |
| `support_tickets` [1251] | creator / MA / CA of same company | any authenticated with `createdById==self` + 6 required keys [1253-1255] | creator while `status=='Open'` / MA / CA of company | MA / CA of company |
| `shiftConfigs` [1279] | **any authenticated [1280] S** | MA / member+`attendance.manage` | same | MA / member+`attendance.manage` |
| `companySettings` [1290] | MA / member | MA / member+`settings.edit` | same | same |
| `attendanceSettings` [1304] | MA / scoped(`attendance`); **list: any co-member [1308-1309] S** | MA / **any TL / any exec [1311-1313]** / member+`attendance.manage` | same (**any TL/exec unconditional**) | MA |
| `attendanceLogs` [1325] | MA / own / member+`attendance.view` | **any authenticated [1329] S (payload unconstrained)** | MA | MA |
| **default deny** `{document=**}` [1336] | `if false` - see 4.4 for the collections that fall into it | | | |

### 4.3 Statically-true disjuncts (the important nuance)

Firestore ORs all disjuncts of an `allow` statement; a disjunct that does not depend on document data can
make the whole rule true **for arbitrary queries/documents**. Marked **S** above, the material ones are:

- `users list` [382] and `employees list` [796]: `allow list: if isAuthenticated()` -> **any signed-in user
  can enumerate the entire user/employee collections across all tenants** (emails, phones, salary-bearing
  fields on `users`).
- `companies list` [320-323] ends with `|| isAuthenticated()` -> any authenticated user can list all company
  docs, **including `settings.smtp` credentials** (read of a single doc is gated [315], list is not).
- `leaveRequests get/list` [946, 952]: `(isAuthenticated() && getUserCompanyId() != null)` -> any user with a
  company can read any tenant's leave request by id / list everything.
- `attendance list` [541-544], `salarySlips list` [1007-1010], `payrollRuns list` [1032-1035],
  `departments list` [451-453], `tasks list` [664-666], `holidays list` [695-697],
  `announcements list` [892-894], `conversations list` [753-756], `attendanceSettings list` [1308-1309]:
  same pattern - tenancy for **list** relies on client-side query filters, not rules.
- `attendanceLogs create` [1329] and `notifications create` [1206-1208]: payload fully unconstrained
  (spoofable rows for arbitrary users/companies).
- `roles read` [1163], `shiftConfigs read` [1279] and `adminAlerts list` [591-592]: cross-tenant read of
  low-sensitivity data.

Single-document `get`s are largely protected because their disjuncts reference `resource.data`
(e.g. `attendance` [532-539], `salarySlips` [1003-1005]) - the exceptions are the `S` gets above.
**AWS rule: tenant scoping must be enforced in the API query layer for every list, not replicated as-is.**

### 4.4 Default-deny gaps (collections with no `match` block)

Business collections that fall through to `allow read, write: if false` [1336-1338] **yet are used by
clients** (cross-ref Doc 1 §6):

| Collection | Client usage | Consequence under shipped rules |
|---|---|---|
| `resetCodes` | `authService.ts:340-383` (generate/verify/invalidate - direct reads+writes) | **client reset-code flow is denied**; backend path `index.ts:1584-1676` (Admin SDK) works |
| `leavePolicies` | web `leavePolicyService.ts:62`, mobile `leaveService.ts:306`, backend `payrollFunctions.ts:449` | client reads denied |
| `performance` (mobile) | `PerformanceScreen.tsx:48` | mobile reads/writes denied (web uses `performanceReviews` which has rules) |
| `ticketMessages` | backend `index.ts` ticket flow | client writes denied (backend fine) |

Backend-only collections (`broadcast_jobs`, `email_logs`, `corporate_inquiries`,
`accountDeletionRequests`, `missedPunchNotifications`, `emailSystemConfig`, `mail_config/global`) have **no
rules and need none** - only the Admin SDK touches them; clients are denied by the default catch-all.

---

## 5. Storage

### 5.1 Buckets & configuration

| Consumer | Bucket source | Value |
|---|---|---|
| Web | `VITE_FIREBASE_STORAGE_BUCKET` (`frontend/src/firebase/config.ts:12`) | real value not in repo; CI uses `dummy-project.appspot.com` (`.github/workflows/build.yml:37`), README example `your-project.appspot.com` (`HRMS_AUTH_README.md:84`) |
| Mobile | `google-services.json:5` / `app.json:69` | **`hrm-sofisx.firebasestorage.app`** |
| Rules | `firebase.json:55-57` -> `storage.rules` (single file, root-level `match /b/{bucket}/o`) | applies to the default bucket |
| Hosting (for URL construction) | `authService.ts:877` invite links, `index.ts:656` app URL | `https://sofixs-hrm.web.app`, `https://hrm-sofisx.web.app` |

The backend **never uses Storage** (grep for `getStorage`/`bucket(`/`.file(` under `backend/` = 0 hits);
payslips are rendered as HTML/PDF in memory and emailed (`payslipPdf.ts`, `payslipDispatch.ts`).

### 5.2 `storage.rules` path-by-path (140 lines, verbatim-summary)

Root: `match /{allPaths=**} { allow read, write: if false }` [6-8] = default deny; helpers
`isSignedIn` [14], `isMasterAdmin` (**reads `request.auth.token.role`, accepts `super_admin`** [18-22]),
`userDoc(uid)` via `firestore.get()` [24-26], `isCompanyAdminOf(cid)` [29-33],
`belongsToCompany(cid)` [36-38] (**defined but never used - dead code**),
`isStaffManager()` = MA/CA/**executive/team-leader** [42-45].

| Path [line] | Read | Write | Limits |
|---|---|---|---|
| `avatars/{userId}/{fileName}` [48] | any authenticated | **owner only** | < 2 MB, `image/*` |
| `company-logos/{companyId}/{fileName}` [57] | any authenticated | MA **OR** CA-of-company (`&&` binds tighter than `||`, so MA bypasses size/type) [59-61] | < 5 MB, `image/*` (CA only) |
| `documents/{companyId}/{employeeId}/{fileName}` [65] | owner / staff manager / MA / CA-of-co | same set | < 10 MB, any content type |
| `payslips/{companyId}/{userId}/{fileName}` [80] | owner / staff manager / MA / CA-of-co | **staff manager / MA / CA only - never the employee** | none |
| `selfies/{companyId}/{userId}/{fileName}` [91] | owner / MA / CA-of-co | **owner only** | < 5 MB, `image/*` |
| `executives/{userId}/{fileName}` [103] | owner / staff manager / MA / CA-of-owner's-co (resolved via `userDoc(userId).companyId` [108]) | same | < 5 MB, `image/jpeg\|image/png\|application/pdf` |
| `team-leaders/{userId}/{fileName}` [119] | identical to `executives` | identical | identical |
| `public/{fileName}` [135] | **`if true`** (unauthenticated) | `if false` | none |

### 5.3 Actual write paths in code vs rules coverage

| Writer | Path | Code ref | Covered by a rule? |
|---|---|---|---|
| Web employee docs | `employees/{employeeId}/{field}` | `Employees.tsx:970`, `DocumentsManagement.tsx:180,309` | **NO** - no `employees/...` match -> default deny |
| Web exec onboarding | `executives/{userId}/{field}` (2 segments) | `Executives.tsx:689` | yes [103] |
| Web TL onboarding | `team-leaders/{userId}/{field}` (2 segments) | `TeamLeaders.tsx:361` | yes [119] |
| Mobile self-check-in | `selfies/{companyId}/{userId}/{ts}.jpg` | `SelfieCaptureModal.tsx:30` | yes [91] |
| Mobile employee docs | `documents/{companyId}/{employeeId}/{field}_{ts}_{name}` | `EmployeesScreen.tsx:419` | yes [65] |
| Mobile exec onboarding | `executives/{uid}/{field}/{ts}_{name}` (**3 segments**) | `ExecutivesScreen.tsx:391` | **NO** - rule matches 2 segments only -> default deny (and payload `contentType: application/octet-stream` [394] would fail the type check anyway) |
| Mobile TL onboarding | `team-leaders/{uid}/{field}/{ts}_{name}` (**3 segments**) | `TeamLeadersScreen.tsx:258` | **NO** - same mismatch (type `application/octet-stream` too) |
| Mobile company files | `company-docs/{companyId}/{folder}/{name}` | `companyService.ts:108` | **NO** - no match -> default deny |
| - | `avatars/`, `company-logos/`, `payslips/`, `public/` | **no writer found anywhere in repo** | rules exist but are unused |

Frontend uploads use `uploadBytes(storageRef, file)` with no explicit `contentType` (SDK infers from
`File.type`, usually fine for the `executives`/`team-leaders` allow-list).

---

## 6. Discrepancies & risks to resolve in the AWS rewrite

| # | Finding | Evidence | Impact |
|---|---|---|---|
| 1 | **Cross-tenant list reads**: `users`, `employees`, `companies` (with SMTP secrets), `leaveRequests`, `attendance`, `payrollRuns`, `salarySlips`, ... list rules contain statically-true disjuncts | 4.3, `firestore.rules:382,796,323,946,541,...` | Rules do NOT enforce tenancy on lists; replicate scoping in API queries, do not port rules verbatim |
| 2 | **Potential privilege escalation via `users` update**: the company-member branch guards with `resource.data.role != 'company_admin'` (underscore) while real roles are hyphenated `company-admin` - the guard is always true and no field allow-list applies; a TL/Exec/CA holding `employees.edit` can update their **own** doc (self branch ORs with this branch) including `role`/`permissions` | `firestore.rules:403-405` (and the same typo at `:410` which at least co-exists with a correct `master-admin` check) | Verify with an emulator test whether deployed rules really allow self role-change; AWS must allow-list editable fields unconditionally for non-MA callers |
| 3 | **Unconstrained creates**: `attendanceLogs create` and `notifications create` accept arbitrary payloads from any authenticated user | `firestore.rules:1329`, `:1206-1208` | Spoofed audit/notification rows; AWS must stamp identity server-side |
| 4 | **Two parallel auth flows**: client `signUpCompany`/`acceptInvitation` never set custom claims; backend `createCompany`/`acceptInvitation` do | `authService.ts:176-180` vs `index.ts:334`; `authService.ts:768-772` vs `index.ts:799` | Users with no `role` claim break every claim-gated callable (`emailService.ts:387-399`) and `storage.rules:18`; determine which flow production uses, then make claims canonical |
| 5 | **Client reset-code flow is default-denied**: `resetCodes` has no rules match, yet web writes it directly | `firestore.rules:1336`, `authService.ts:340-383` | Web 6-digit reset must be API-only in AWS (Doc 1 §6.1) |
| 6 | **Client `leavePolicies` / `performance` / `ticketMessages` reads/writes are default-denied** | 4.4 | Same as #5 |
| 7 | **Vocabulary skew**: backend catalog 92 keys/14 modules with `payroll.calculate` + stray `*.approve`; matrix 118 keys/23 modules with `payroll.calc` and no `*.approve` columns; stale comment claims "53 permissions" | `index.ts:160-191`, `permissionConfig.ts:50-101` | Permission keys written by `createStaffUser` and keys written by the matrix editor do not fully intersect - normalize to one vocabulary in AWS |
| 8 | **Web/mobile `hasPermission` diverge**: mobile company-admin gets all `leave.*`, web does not | `mobile AuthContext.tsx:181` vs `frontend AuthContext.tsx:111-114` | Same role behaves differently per client; pick one behavior |
| 9 | **Company-admin is view-only client-side but has write rights in rules**: `salarySlips update` [1018] unconditional, `announcements` edit/delete via `isCompanyAdmin()` [904-910], `support_tickets` full CRUD, `roles` create/update [1164-1167], and backend grants `salary.edit`/`employee_edit` | `authService.ts:57-72`, `index.ts:62-72`, rules refs in 4.2 | UI hides actions the API would accept - document intended CA powers (payslip correction window!) explicitly |
| 10 | **Storage path coverage is broken for 3 real upload flows** (web `employees/...`, mobile `executives/team-leaders` 3-segment paths, mobile `company-docs/...`) while 4 rule paths (`avatars`, `company-logos`, `payslips`, `public`) have no writers | 5.3 | Either deployed rules differ from the repo or those uploads currently fail - verify against the live bucket, then design S3/Cognito paths from the *actual* upload set |
| 11 | **`storage.rules` master-admin branch bypasses size/type checks** via `||`/`&&` precedence in `company-logos` | `storage.rules:59-61` | Low risk; replicate deliberately or fix |
| 12 | **Legacy role strings survive** (`super_admin`, `company_admin`, `hr-manager`) in rules, rules helpers and mobile tier mapping | `firestore.rules:276,405,410`; `storage.rules:20,31,44`; `mobileApi.ts:390` | AWS role enum should be the 6 canonical roles + explicit migration of any stored legacy values |
| 13 | **README-level auth docs are stale** and contradict the code: `HRMS_AUTH_README.md` describes `super_admin/hr_manager/department_manager/intern` roles and permissions **inside claims** (`:119-145`, `:205-217`); `ROLE_SYSTEM_EXPLAINED.md` describes 4 roles + snake_case keys (`:7-16`, `:114-132`) | both files | Do not treat either as spec; this document supersedes them |
| 14 | **`permissionScopes` is half-retired**: rules enforce it, the UI editor was removed and saves delete it | `firestore.rules:134-138` vs `authService.ts:621-623,652` | Decide: keep per-module scoping (and rebuild the editor) or drop it in AWS |
| 15 | **`users` self-update allows the `email` field** inside the 14-field allow-list, while other flows require re-authentication (`reauthenticateUser` exists but is unused by that path) | `firestore.rules:396-402`, `authService.ts:388-394` | Account-takeover surface (email change -> password reset); enforce re-auth in AWS |

---

## 7. Verification checklist for the AWS rewrite

1. **Identity provider**: Email/Password only; migrate the 6 roles; decide whether custom claims survive as
   JWT claims (keep `role` + `companyId` only, mirroring the 1000-char constraint) and guarantee
   "user record written before claims" ordering (`index.ts:232-234`).
2. **Permission model**: one vocabulary (recommend the matrix's 23 modules x 12 actions = 118 keys), with an
   explicit migration map for snake_case (24 keys, `index.ts:125-137`), backend catalog keys (92,
   `index.ts:162-191`) and the 11 rule aliases (`firestore.rules:95-110`).
3. **Default grants**: port `getPermissionArray` (6 role defaults), the TL/Exec legacy 16/19-key full-access
   behavior, `['*']`/`['none']`/`module.*`/`module.manage` semantics, `permissionsConfigured` switch, and the
   core-CRUD default for `companies/executives/employees` (3.2).
4. **Client behavior parity**: reproduce `hasPermission`'s hard rules - company-admin view-only (decide on
   the mobile `leave.*` exception, #8), master-admin always-true, employee/RM hardcoded sets (3.3).
5. **Tenant scoping**: enforce `companyId` filtering on EVERY list/query (4.3 shows Firestore did not);
   keep `getScopedCompanyIds`/portfolio semantics for exec (`assignedCompanyIds`) and TL (linked-executive
   portfolio, rules `:179-210`).
6. **Per-collection CRUD matrix**: implement the effective access of 4.2, including the odd ones:
   `salarySlips` CA update / MA-only delete, `transfers` MA-only + immutable, `invitations` no updates,
   `audit_logs` create-only-for-self, `notifications` create-then-own-only.
7. **Approval-tier routing**: `leaveRequests update` tier gates (rules `:971-991`) and missed-punch
   approver bypass (rules `:262-298`) must be server-enforced - see Doc 2 §4.1 for the full chain.
8. **Public/unauthenticated surface**: `corporateInquiry`, `sendSupportTicket`, `sendResetCode`,
   `resetPasswordWithCode`, invitation-by-token reads, `setupMasterAdmin` one-time bootstrap - rate-limit all
   of these (they are the only anonymous entry points).
9. **Hardened creates**: server-stamp `userId`/`companyId` on `attendanceLogs`, `notifications`, and
   `audit_logs` (rules relied on client honesty, #3).
10. **Storage**: build the bucket layout from the *actual* upload paths in 5.3 (fix the three broken ones),
    enforce owner/company scoping + size + content-type server-side, and decide the fate of the never-used
    `avatars/company-logos/payslips/public` prefixes.
11. **Stale-config sweep**: remove reliance on `super_admin`/`company_admin`/`hr-manager` strings, the
    `firestore.rules.backup` file, and the two outdated auth READMEs (#12, #13).
12. **Parity tests**: for each row of 4.2 and each item of 4.4, write an API test proving the same allow/deny
    outcome as the Firebase reference (use the emulator ruleset in the repo as the oracle).
