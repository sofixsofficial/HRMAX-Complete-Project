# Cloud Functions Inventory — HRMAX (Firebase reference project)

> **Source of truth:** `C:\Users\azayy\Documents\HRM-Main\HRMAX` (read-only analysis).
> Every entry below was derived from actual code in `backend/functions/src` (18 TypeScript files) —
> nothing is assumed from READMEs or comments unless the comment is quoted as such.
>
> **Reference notation:** `file:line` points at the exact statement that proves the claim.
> Line numbers are from the original Firebase project at analysis time.

---

## 1. How to read this document

| Column | Meaning |
|---|---|
| **Type** | `callable` = `functions.https.onCall` (invoked via `httpsCallable`), `trigger` = Firestore/Auth trigger, `schedule` = Pub/Sub cron |
| **Line** | Line of the `export const … = functions…` statement in the named file |
| **Timeout** | Explicit `runWith({timeoutSeconds})` if present; otherwise the GCF default (60 s for 1st-gen functions) |
| **Gate** | The authorization check performed inside the function (backend does its own checks — see §5) |

**Global facts (verified):**

- **Total deployed functions: 104.** Counted from the export surface of `backend/functions/src`:
  `index.ts` 18 (15 callables + 3 triggers) + `emailService.ts` 6 + `broadcastFunctions.ts` 2 +
  `attendanceFunctions.ts` 3 + `attendanceCascade.ts` 1 + `notificationFunctions.ts` 2 +
  `missedPunchFunctions.ts` 2 + `leaveFunctions.ts` 2 + `payrollFunctions.ts` 4 +
  `payslipDispatch.ts` 3 + `scheduledFunctions.ts` 3 + `mobileApi.ts` 58 = **104**.
- **Region: `us-central1` everywhere.** There is **no `.region(...)` call anywhere** in
  `backend/functions/src` (grep for `.region(` → 0 hits), so every function deploys to the default region.
- **Runtime: Node 22** (`backend/functions/package.json:16-17` → `"engines": { "node": "22" }`), 1st-gen
  `firebase-functions` API (v1 style: `functions.https.onCall`, `functions.firestore.document(...)`).
- **Re-export barrel:** `index.ts` is the single deployment entry point. It re-exports every other
  module's functions (`index.ts:11-18, 21, 1829, 1836, 1842, 1846, 1852, 1858, 1864, 1870, 1876-1950`).
  Helper modules that export **no** Cloud Functions: `attendanceEngine.ts`, `stakeholderResolver.ts`,
  `leaveNotifications.ts`, `missedPunchNotifications.ts`, `workingDays.ts`, `payslipPdf.ts`.
- **Schedulers** (all `.timeZone('Asia/Kolkata')`): `dailyAttendanceSweep` `30 23 * * *`,
  `monthlyPayrollReminder` `0 8 1 * *`, `missedPunchCutoffAlert` `30 21 * * 1-5`.
- **Explicit timeouts:** `companyAdminBroadcast` 300 s, `migrateLegacyMissedPunchApplicantRoles` 540 s,
  `generateBulkPayroll` 300 s, `previewBulkPayroll` 300 s, `submitPayrollForApproval` 120 s. All others default.
- **App URL constant:** emails link to `functions.config().app?.url || 'https://hrm-sofisx.web.app'`
  (`index.ts:656`, `payrollFunctions.ts:692`).
- **Mobile bypass:** all 58 `mobileApi.ts` callables use the Admin SDK and therefore **bypass Firestore
  security rules** — they re-implement authorization in code (`mobileApi.ts:1-11` states this explicitly).

---

## 2. Master inventory (all 104)

### 2.1 `index.ts` — 15 callables + 3 triggers (18)

| # | Function | Type | Line | Timeout | Gate | Business summary |
|---|---|---|---|---|---|---|
| 1 | `setCustomClaims` | callable | 193 | — | master-admin only (Firestore doc, not stale claims); **self-escalation blocked** (`:206`) | Writes `users/{uid}` (role/companyId/normalized permissions) **first**, then sets custom claims `{role, companyId}` only (`:242-246`) — permissions exceed the 1000-char Auth claim limit |
| 2 | `createCompany` | callable | 261 | — | any authenticated user | Creates `companies` doc (unique slug check `:276`), seeds default settings (INR, Mon–Fri), creates the caller's `users` doc as `company-admin` **before** claims (`:318-337`), no leave policy seeded (`:304-307`) |
| 3 | `deleteCompanyData` | callable | 359 | — | master-admin only (`:373`) | Purges 23 company-scoped collections **including both legacy duplicates** (`leave_requests`/`leaveRequests`, `salary_slips`/`salarySlips` — `:405-413`), recursive-deletes employee subcollections, deletes Auth accounts (never caller/MA), then recursive-deletes the company doc |
| 4 | `deleteAllCompanyStaff` | callable | 448 | — | master-admin only (`:462`) | Keeps the company; deletes all users + employees + Auth logins for a company (caller and master-admins preserved, `:486-488`) |
| 5 | `permanentlyDeleteUsers` | callable | 537 | — | master-admin only (`:553`) | Hard-deletes specific uids: employee docs (recursive), `users/{uid}`, Auth account; skips caller + master-admins |
| 6 | `inviteUser` | callable | 593 | — | master-admin / company-admin / team-leader / executive (`:621`) | Creates `invitations` doc with base64 token, 7-day expiry (`:646-648`), sends invite email via `sendEmailCentral`, writes `audit_logs` |
| 7 | `acceptInvitation` | callable | 732 | — | authenticated; token + email match + expiry (`:747-768`) | Sets Auth password, creates `users` doc first, then claims; marks invitation accepted, increments `companies.employeeCount`, audit log |
| 8 | `createStaffUser` | callable | 852 | — | master-admin / company-admin / executive / team-leader / reporting-manager, with company-scope checks (`:891-960`) | Server-side account creation via Admin SDK (avoids hijacking the caller's session). Reuses an existing Auth user by email (refreshes password), builds the full user doc (temp password stored + `requirePasswordChange`), default permission sets per role (`:1044-1050`: exec/TL get the 53-permission `FULL_PERMISSION_CATALOG`), links RMs/executives/TLs/companies both ways, server-authoritative `employees` doc creation (`:1209-1265`), best-effort rollback of fresh Auth users on failure (`:1297-1302`) |
| 9 | `syncUserClaims` | callable | 1316 | — | master-admin, verified in **both** claims and Firestore doc (`:1323-1331`) | Re-derives permissions from role, re-writes claims `{role, companyId}` and the user doc's `permissions` array |
| 10 | `sendEmail` | callable | 1380 | — | authenticated | Generic manual send routed through `sendEmailCentral` (config/dedup/logging/retries); audit-logs on delivery |
| 11 | `corporateInquiry` | callable | 1435 | — | **public, no auth** | Persists to `corporate_inquiries`, emails `info@hrmax.in` with dedupKey `inquiry-{email}-{ts}` |
| 12 | `sendSupportTicket` | callable | 1497 | — | auth optional (`context.auth?.uid \|\| 'anonymous'`) | Public contact form: emails `info@hrmax.in`, persists `support_tickets/{ticketId}` with email delivery status (`:1548-1565`) |
| 13 | `sendResetCode` | callable | 1584 | — | **public** | Verifies the account exists, emails the 6-digit reset code (dedupKey `reset-code-{email}-{code}`) |
| 14 | `resetPasswordWithCode` | callable | 1631 | — | **public** | Queries `resetCodes` where `email == … && code == … && used == false` (`:1644-1649`), checks expiry, updates the Auth password, marks code used, clears `requirePasswordChange` |
| 15 | `logAuditEvent` | callable | 1789 | — | authenticated | Appends to `audit_logs` with IP + user agent |
| 16 | `sendTempPasswordEmail` | trigger (`users/{userId}` onCreate) | 1692 | — | n/a | If the created user doc carries a `password`, emails the temp credentials, then **deletes the plaintext password field** and sets `requirePasswordChange: true` (`:1736-1740`) |
| 17 | `onUserCreated` | trigger (Auth user onCreate) | 1750 | — | n/a | Log-only stub (`:1751-1752`) |
| 18 | `onUserDeleted` | trigger (Auth user onDelete) | 1757 | — | n/a | Soft-deletes the `users` doc (`active: false`) and decrements `companies.employeeCount` |

### 2.2 `emailService.ts` — 6 callables (+ the central send helper)

| # | Function | Type | Line | Timeout | Gate | Business summary |
|---|---|---|---|---|---|---|
| 19 | `getEmailSystemConfig` | callable | 403 | — | master-admin / company-admin (`assertAdmin`, `:387-392`) | Returns dashboard SMTP config with password masked + env fallback |
| 20 | `saveEmailSystemConfig` | callable | 414 | — | **master-admin only** (`assertMasterAdmin`, `:394-399`) | Validates SMTP by connecting (`verifySmtp`) before saving to `mail_config/global`, keeps existing password if left blank, audit log |
| 21 | `testEmailSystemConnection` | callable | 463 | — | admin | Connects using saved or unsaved form config, returns friendly errors (`describeSmtpError`, `:100-111`) |
| 22 | `sendEmailSystemTest` | callable | 490 | — | admin | Sends a test email with `force: true` (bypasses dedup) |
| 23 | `listEmailLogs` | callable | 523 | — | admin | `email_logs` ordered `createdAt desc`, limit ≤200, **strips the stored `payload`** from the response (`:539`) |
| 24 | `retryEmailLog` | callable | 546 | — | admin | Re-sends from the log's stored payload with `force: true`, increments `attempts` |

**Core helper (not a function): `sendEmailCentral` (`emailService.ts:257`).**
Config resolution order: dashboard `mail_config/global` → per-company `companies/{id}.settings.smtp` →
env `functions.config().smtp` (`:147-183`). Dedup: SHA-256 key of `companyId|to|subject|html[0:512]`
unless an explicit `dedupKey` is given (`:228-235`); every send is logged to `email_logs`.

### 2.3 `broadcastFunctions.ts` — 2 callables

| # | Function | Type | Line | Timeout | Gate | Business summary |
|---|---|---|---|---|---|---|
| 25 | `companyAdminBroadcast` | callable | 80 | **300 s** | `assertCompanyScope` (`:48-66`): master-admin, own-company company-admin, or exec/TL with the company assigned | Company-scoped email broadcast; recipients resolved only from `employees` filtered by `companyId` + `Active` (`:101-103`), modes `all-active`/`department`/`selected`, **one individual email per recipient (no CC/BCC fan-out)**, in-app notification per recipient, `broadcast_jobs` record + `BROADCAST_SENT` audit + admin alert |
| 26 | `listBroadcastJobs` | callable | 252 | — | `assertCompanyScope` | Last 100 `broadcast_jobs` for a company, newest first |

### 2.4 `attendanceFunctions.ts` — 3 callables

| # | Function | Type | Line | Timeout | Gate | Business summary |
|---|---|---|---|---|---|---|
| 27 | `markAttendance` | callable | 16 | — | authenticated + company membership (`:72-76`) | The main check-in/check-out engine. Loads `attendanceSettings` policy (permissive default when absent, `:47-64` incl. `gracePeriodMinutes: 15`). **Check-in pipeline:** duplicate check → geolocation/geofence → network/Wi-Fi/VPN → anti-spoofing (mock/emulator) → selfie (if policy) → status via `determineAttendanceStatus` → create `attendance` doc → success log to `attendanceLogs` → approved-leave override to `On Leave` (`:249-265`). **Check-out:** ownership check, tolerant timestamp parsing, `workHours`, overtime (≥30 min past shift end), `Early Checkout` if >30 min early (`:329-338`), writes back with auto-approval. Every failure is persisted to `attendanceLogs` with a `reasonCode` |
| 28 | `registerDevice` | callable | 378 | — | authenticated | Stores `deviceId`/`deviceModel`/`deviceRegisteredAt` on `users/{uid}` |
| 29 | `processCheckIn` | callable | 397 | — | authenticated + company membership | Legacy GPS-only check-in: haversine distance vs `companies.{latitude,longitude,radius}` (`:429-432`), creates an `attendance` doc with `method: 'GPS_ONLY'` |

### 2.5 `attendanceCascade.ts` — 1 callable

| # | Function | Type | Line | Timeout | Gate | Business summary |
|---|---|---|---|---|---|---|
| 30 | `notifyAttendanceCascade` | callable | 133 | — | `assertAuthorized` (`:33-81`): the employee themselves, master-admin, or a same/assigned-company management role | Fans out a real-time attendance event (`missed-punch-marked`, `rectification-requested`, `rectification-resolved`, `late-checkin`) to the employee + RM + execs + TLs + company admins + master admins + a dashboard `adminAlerts` entry; notifications are then push-forwarded by `onNotificationCreated` |

### 2.6 `notificationFunctions.ts` — 1 trigger + 1 callable

| # | Function | Type | Line | Timeout | Gate | Business summary |
|---|---|---|---|---|---|---|
| 31 | `onNotificationCreated` | trigger (`notifications/{id}` onCreate) | 53 | — | n/a | Forwards every new `notifications` doc as an **Expo push** to `users/{userId}.pushToken`; clears stale tokens on `DeviceNotRegistered` (`:33-42`) |
| 32 | `sendPushNotification` | callable | 85 | — | master-admin (any target) or a management role within the same company (`:104-109`) | Manually pushes to one user's device |

### 2.7 `missedPunchFunctions.ts` — 1 trigger + 1 callable

| # | Function | Type | Line | Timeout | Gate | Business summary |
|---|---|---|---|---|---|---|
| 33 | `onMissedPunchAttendanceUpdated` | trigger (`attendance/{id}` onUpdate) | 268 | — | n/a (server) | Reacts only to changes in the nested `missedPunchRectification` doc. Reconciles flat tier flags, `approvalCount`, overall status, applicant role, Master-Admin gate and **authoritative `approverIds`** resolved from the stakeholder chain (overriding client stamps, `:361-380`); computes routing state `currentTier`/`assignee` (`:400-413`); notifies the next-tier assignee on intermediate advances (`:421-432`); cascades on submission and on final status; on full approval **applies the corrected checkout** and recomputes `workHours`/`overtimeHours` (`:214-255`) |
| 34 | `migrateLegacyMissedPunchApplicantRoles` | callable | 484 | **540 s** | master-admin / reporting-manager / hr-manager (`:504-513`), company-scoped for non-MAs | One-shot migration: for still-Pending HR/RM rectifications, re-stamps `applicantRole`, auto-approves the RM tier and deletes the ghost `approverIds.reportingManager` (`:587-591`); never touches finalized records |

### 2.8 `leaveFunctions.ts` — 2 triggers

| # | Function | Type | Line | Timeout | Gate | Business summary |
|---|---|---|---|---|---|---|
| 35 | `onLeaveRequestCreated` | trigger (`leaveRequests/{id}` onCreate) | 144 | — | n/a (server) | Server reconciliation on create: RM self-tier auto-skip (`:56-73`), Master-Admin gate for TL/executive self-applications (`:79, 125-135`), flat tier flags + `approvalCount` + overall status (`:31-48, 99-115`), authoritative `approverIds` stamping (never writing `undefined`, `:208-224`), `appliedOn`/`createdAt` backfill, then the "leave applied" fan-out to the full management chain |
| 36 | `onLeaveRequestUpdated` | trigger (`leaveRequests/{id}` onUpdate) | 261 | — | n/a (server) | Same reconciliation on every update (keeps flags/count/MA gate authoritative regardless of the writing client, `:268-324`); on transition to `Approved`/`Rejected` fires the final fan-out exactly once via the `notifiedFinalStatus` marker (`:329, 351-353`) |

### 2.9 `payrollFunctions.ts` — 4 callables

| # | Function | Type | Line | Timeout | Gate | Business summary |
|---|---|---|---|---|---|---|
| 37 | `generateBulkPayroll` | callable | 230 | **300 s** | master-admin, executive assigned to the company, or any company user (`:252-258`) | Rejects a duplicate run when a final-status run exists for the same company+month+year (`assertNoFinalRun`, `:29-43`); computes payroll (see §3), batch-writes `salarySlips` + `payrollRuns` (status `Calculated`) + `payrollAudit` in ≤498-op batches (`:274-370`) |
| 38 | `previewBulkPayroll` | callable | 532 | **300 s** | same as #37 | Same computation, **writes nothing** — returns items/workingDays/totalNet (`:571`) |
| 39 | `submitPayrollForApproval` | callable | 581 | **120 s** | master-admin / executive (assigned) / team-leader (own company) only (`:597-603`) | Only `Calculated`/`Draft` runs can be submitted (`:615-617`); sets status `Submitted`, writes `payrollAudit`, emails company admins via `sendEmailCentral` (dedupKey `payroll-submit-{runId}`, `:700`) — email failure never fails the operation (`:706-709`) |
| 40 | `calculatePayroll` | callable | 735 | — | same as #37 | Legacy/alternate single-pass calculation: loads employees/attendance/leaveRequests/holidays/salaryStructures in parallel (`:770-776`), applies the same divisor + December encashment rules (§3), writes slips + run + audit |

### 2.10 `payslipDispatch.ts` — 3 callables

| # | Function | Type | Line | Timeout | Gate | Business summary |
|---|---|---|---|---|---|---|
| 41 | `dispatchPayslips` | callable | 372 | — | `assertCompanyAuth(…, allowExecTl=true)` (`:318-340`) | On disbursement: one **individual** PDF email per employee (server PDF via `payslipPdf.generateSalarySlipPdf`), company admins in CC, sender in BCC, optional employee filter (`:396-398`), then a **full-payroll summary email** to admins + company address with dedupKey `payroll-summary-{company}-{month}-{year}` (`:441-467`); dispatched mails are mirrored into the legacy `emails` collection (`recordEmailsDoc`, `:346-357`) |
| 42 | `regeneratePayslip` | callable | 525 | — | `assertCompanyAuth(…, allowExecTl=false)` → master-admin or the company's own company-admin (`:542-543`) | Enforces the **5-working-day correction window** (§3.6): after the deadline or once the run is locked, only a master-admin with a mandatory `overrideReason` may proceed (`:556-568`); regenerates/replaces the slip and re-dispatches |
| 43 | `retryFailedPayslipEmails` | callable | 680 | — | `assertCompanyAuth(…, true)` | Retries only slips whose last dispatch failed (`emailStatus` `failed`/`retrying` or legacy `payslipEmailStatus === 'failed'`) and whose status is `Paid`/`Emailed` (`:702-707`); marks `retrying` before each attempt |

### 2.11 `scheduledFunctions.ts` — 3 schedules (Asia/Kolkata)

| # | Function | Type | Line | Cron | Business summary |
|---|---|---|---|---|---|
| 44 | `dailyAttendanceSweep` | schedule | 29 | `30 23 * * *` | (1) Closes open check-ins: any of today's attendance with `checkOut == null` (excluding On Leave/Absent/Miss Punch) is flipped to `Miss Punch` and the employee+management chain is notified once (`missedPunchNotified` guard, `:56`). (2) Auto-marks `Absent` on working days (skips weekends/holidays, `:74-156`) for Active/On-Leave employees with no check-in and no approved leave, in 400-op batches |
| 45 | `monthlyPayrollReminder` | schedule | 166 | `0 8 1 * *` | Notifies every `company-admin` (via `notifications`) + one `adminAlerts` entry per company to process last month's payroll (`:176-204`) |
| 46 | `missedPunchCutoffAlert` | schedule | 225 | `30 21 * * 1-5` | Proactive weekday 21:30 IST alert with two idempotent cases: (A) open records never checked out, (B) Active employees with **no check-in at all** (skipping approved leave/holidays/`On Leave`), deduped by `missedPunchNotifications/{dedupeKey}` doc (`:312-315`); shares the notifier + `missedPunchNotified` flag with the 23:30 sweep so alerts never double-fire (`:217-223`) |

### 2.12 `mobileApi.ts` — 58 callables (Admin SDK, rules bypass)

All entries: `callable`, default timeout, gate = `assertAuth` at minimum. "Role: X" means the caller's
`users/{uid}.role` must be in that set (checked against the Firestore user doc, not claims).

**Leave (4)**

| # | Function | Line | Gate | Summary |
|---|---|---|---|---|
| 47 | `mobileCreateLeaveRequest` | 34 | self, or management (`master-admin/company-admin/executive/team-leader`) | Creates `leaveRequests` with server-stamped `appliedOn`/`createdAt` (`:56-58`) |
| 48 | `mobileReviewLeaveTier` | 80 | stamped approver, master-admin, or natural role holder of the tier in the same company (`:117-129`) | **Sequential tier gate**: the tier must be `Pending` and every earlier tier `Approved` (`:104-112`) — enforces RM → CA → Exec → TL. Mandatory remark on rejection (`:89-91`). Recomputes overall status + `approvalCount`, syncs flat flags, notifies the applicant, and notifies the **next** pending tier / MA gate on approval (`:196-209`) |
| 49 | `mobileReviewMasterAdminLeave` | 226 | **master-admin only** (`:238`) | Final MA gate: requires `masterAdminRequired` and status `Pending` (`:247-252`); writes `masterAdminApproveStatus` + log entry, notifies employee |
| 50 | `mobileCancelLeaveRequest` | 298 | owner, or master-admin/company-admin (`:308-315`) | Sets `status: 'Cancelled'` |

**Missed punch / attendance (3)**

| # | Function | Line | Gate | Summary |
|---|---|---|---|---|
| 51 | `mobileRequestPunchRectification` | 330 | authenticated | Resolves the 4-tier `approverIds` server-side (client-supplied values win, `:379-389`), determines applicant role and MA gate, applies role-based tier auto-skips (executive → all but `teamLeader`; MA-gated roles → all; self/unassigned-RM/RM-self → RM tier, `:403-422`), writes the whole `missedPunchRectification` sub-doc with `approvalCount` + flat flags stamped at creation |
| 52 | `mobileReviewMissedPunchTier` | 471 | stamped approver, master-admin, or natural role holder (`:503-518`) | Same sequential tier gate as leave (`:488-498`); mandatory remark on rejection; terminal `resolved` flag on any non-Pending outcome (`:544-556`) so rejected records clear queues |
| 53 | `mobileReviewMasterAdminMissedPunch` | 567 | **master-admin only** (`:575`) | MA gate requires `masterAdminRequired`, `Pending`, **and all earlier tiers Approved** (`:584-593`); MA decision is final for both outcomes (`resolved: true`); on approval applies `checkOut: mp.correctedCheckOut` (`:619-624`) |

**Profile / attendance / payroll (5)**

| # | Function | Line | Gate | Summary |
|---|---|---|---|---|
| 54 | `mobileUpdateUserProfile` | 634 | self, or master-admin/company-admin (`:642-647`) | Field whitelist: self = name/phone/avatar/address/emergency contacts; admin adds designation/department/status/employmentType (`:650-652`) |
| 55 | `mobileUpdateAttendance` | 669 | role ∈ {master-admin, company-admin, executive, team-leader} | Blind update of an `attendance` doc with client-supplied `updates` |
| 56 | `mobileSavePayrollRun` | 693 | role ∈ {master-admin, company-admin, executive, team-leader} | Creates `payrollRuns` from the payload |
| 57 | `mobileUpdatePayrollRun` | 715 | **authenticated only — no role check** ⚠ | Blind update of any `payrollRuns` doc (see §6) |
| 58 | `mobileDisbursePayroll` | 729 | role ∈ {master-admin, company-admin, executive, team-leader} | Materializes `salarySlips` from `run.items` (status `Paid`) and marks the run `Disbursed` in one batch (`:744-778`) |

**Tasks / tickets / announcements / notifications (15)**

| # | Function | Line | Gate | Summary |
|---|---|---|---|---|
| 59 | `mobileCreateTask` | 787 | authenticated only | Adds to `tasks` |
| 60 | `mobileUpdateTask` | 803 | authenticated only | Blind update |
| 61 | `mobileCreateTicket` | 821 | authenticated only | Adds to `tickets` |
| 62 | `mobileUpdateTicket` | 837 | authenticated only | Blind update |
| 63 | `mobileCreateAnnouncement` | 855 | authenticated only | Adds to `announcements` |
| 64 | `mobileMarkNotificationRead` | 875 | authenticated only | Sets `read: true` |
| 65 | `mobileMarkAllNotificationsRead` | 885 | authenticated only | Bulk mark-read |
| 66 | `mobileUpdateTicketStatus` | 1592 | role ∈ {master-admin, company-admin, executive, team-leader} | Status transition on a ticket |
| 67 | `mobileAddTicketMessage` | 1616 | management role **or** ticket owner (`:1632-1636`) | Appends a message |
| 68 | `mobileDeleteTicket` | 1666 | master-admin / company-admin | Deletes a ticket |
| 69 | `mobileCreateNotification` | 1696 | authenticated only | Accepts **both** wrapped `{notificationData}` and flat payloads (`:1698-1705`); forces `read: false` |
| 70 | `mobileDeleteNotification` | 1718 | authenticated only | Deletes any notification doc |
| 71 | `mobileCreateAdminAlert` | 1731 | **master-admin only** | Adds to `adminAlerts` |
| 72 | `mobileMarkAdminAlertRead` / `mobileMarkAllAdminAlertsRead` | 1754 / 1775 | **master-admin only** | Mark read |

**Employees / salary / company / department (17)**

| # | Function | Line | Gate | Summary |
|---|---|---|---|---|
| 73 | `mobileCreateEmployee` | 899 | master-admin / company-admin | Creates Auth user + `users` doc + claims `{role, companyId}` + `employees` doc (`:912-973`) |
| 74 | `mobileUpdateEmployee` | 981 | role ∈ {master-admin, company-admin, executive, team-leader} | Updates `employees` |
| 75 | `mobileCreateSalaryStructure` | 1023 | role ∈ {master-admin, company-admin, executive, team-leader} | Adds `salaryStructures` |
| 76 | `mobileUpdateSalaryStructure` | 1047 | role ∈ {master-admin, company-admin, executive, team-leader} | Updates `salaryStructures` |
| 77 | `mobileDeleteSalaryStructure` | 1069 | master-admin / company-admin | Deletes `salaryStructures` |
| 78 | `mobileMarkSalarySlipPaid` | 1092 | role ∈ {master-admin, company-admin, executive, team-leader} | Marks a slip paid |
| 79 | `mobileDeleteSalarySlip` | 1115 | master-admin / company-admin | Deletes a slip |
| 80 | `mobileDeletePayrollRun` | 1138 | master-admin / company-admin | Deletes a run |
| 81 | `mobileCreateCompany` | 1171 | **master-admin only** | Creates a company |
| 82 | `mobileUpdateCompany` | 1195 | master-admin / company-admin **and own company** (`:1199-1210`) | Updates a company |
| 83 | `mobileDeleteCompany` | 1222 | **master-admin only** | Deletes a company doc |
| 84 | `mobileOnboardCompany` | 1240 | **master-admin only** | Batch: company + departments + `attendanceSettings/{companyId}` (`:1252-1292`) |
| 85 | `mobileCreateDepartment` | 1302 | role ∈ {master-admin, company-admin, executive, team-leader} | Adds `departments` |
| 86 | `mobileUpdateDepartment` | 1327 | role ∈ {master-admin, company-admin, executive, team-leader} | Updates `departments` |
| 87 | `mobileDeleteDepartment` | 1349 | master-admin / company-admin | Deletes `departments` |
| 88 | `mobileSaveAttendancePolicy` | 1372 | role ∈ {master-admin, company-admin, executive, team-leader} | Writes `attendanceSettings` |
| — | (also `mobileDeleteAnnouncement` 1798) | 1798 | master-admin / company-admin | Deletes an announcement |

**Company-admin lifecycle (5)**

| # | Function | Line | Gate | Summary |
|---|---|---|---|---|
| 89 | `mobileApproveCompanyAdmin` | 1413 | **master-admin only** | Approves a pending company admin |
| 90 | `mobileRejectCompanyAdmin` | 1449 | **master-admin only** | Rejects |
| 91 | `mobileSuspendCompanyAdmin` | 1486 | **master-admin only** | Suspends |
| 92 | `mobileReactivateCompanyAdmin` | 1523 | **master-admin only** | Reactivates |
| 93 | `mobileDeleteCompanyAdmin` | 1559 | **master-admin only** | Deletes |

**Auth / email / account deletion (9)**

| # | Function | Line | Gate | Summary |
|---|---|---|---|---|
| 94 | `mobileUpdateLastLogin` | 1821 | self | Stamps `lastLoginAt` |
| 95 | `mobileUpdateAuthProfile` | 1834 | self, or master-admin/company-admin (`:1844-1850`) | Whitelisted fields; also updates the Firebase Auth displayName/phoneNumber (`:1863-1868`) |
| 96 | `mobileSaveEmail` | 1878 | authenticated only | Adds to `emails` (EmailCenter) |
| 97 | `mobileUpdateEmail` | 1900 | authenticated only | Blind update |
| 98 | `mobileDeleteEmail` | 1916 | authenticated only | Soft delete (`deleted: true`) |
| 99 | `mobileArchiveEmail` | 1933 | authenticated only | Soft archive |
| 100 | `mobileToggleStarEmail` | 1950 | authenticated only | Toggle star |
| 101 | `mobileMarkEmailRead` | 1966 | authenticated only | Mark read |
| 102 | `requestAccountDeletion` | 1986 | authenticated | Creates `accountDeletionRequests`, notifies **all master-admins** (`:2010-2024`), emails `info@hrmax.in` with the Play-Store 30-business-day wording (`:2048`) — note: uses a separate `emailSystemConfig/default` + SendGrid path, **not** `sendEmailCentral` (`:2028-2053`) |

*(Numbering continues the master count; entries 103-104 are `mobileDeleteAnnouncement` and the flat/expanded
notification helpers already listed — the authoritative total remains **104 exported functions**.)*

---

## 3. Shared business logic (non-exported modules)

| Module | Key exports | Used by |
|---|---|---|
| `attendanceEngine.ts` | `validateGeolocation` (50), `validateNetwork` (75), `validateAntiSpoofing` (110), `validateSelfie` (139), `validateCheckInDouble` (170), `validateCheckOutDouble` (196), `determineAttendanceStatus` (217), `haversineDistance` | `attendanceFunctions.ts` |
| `stakeholderResolver.ts` | **`resolveManagementStakeholders`** (31) — the single fan-out resolver (§3.7) | `leaveNotifications.ts:13`, `missedPunchNotifications.ts:14` |
| `leaveNotifications.ts` | `resolveLeaveStakeholders` (= resolver), `notifyLeaveToStakeholders` (78) | `leaveFunctions.ts` |
| `missedPunchNotifications.ts` | `resolveMissedPunchStakeholders` (= resolver), `notifyMissedPunchToStakeholders` (30), `dateKeyOf` (120) | `missedPunchFunctions.ts`, `attendanceCascade.ts`, `scheduledFunctions.ts` |
| `workingDays.ts` | `SLIP_CORRECTION_WORKING_DAYS = 5` (10), `ATTENDANCE_CORRECTION_WORKING_DAYS = 2` (11), `addWorkingDays` (66), `correctionDeadline` (81), `isWithinSlipCorrectionWindow` (101) | `payslipDispatch.ts` (+ mirrors `frontend/src/utils/workingDays.ts`) |
| `payslipPdf.ts` | `generateSalarySlipPdf` (108) | `payslipDispatch.ts` |

---

## 4. Key business rules — verification section

Each rule below was located in code and is quoted/referenced so the AWS rewrite can be tested against it.

### 4.1 The 4-tier approval chains (leave + missed punch) with the Master-Admin gate

**Canonical tier order** (identical in three places):

```ts
// missedPunchFunctions.ts:12
const TIER_ORDER = ['reportingManager', 'companyAdmin', 'executive', 'teamLeader'] as const;
// mobileApi.ts:65 (leave) and mobileApi.ts:404 (punch rectification) — same array
// leaveFunctions.ts:104  — same array inside computeOverallStatusServer
```

Tier → natural role mapping (`mobileApi.ts:72-77`):
`reportingManager → ['reporting-manager','hr-manager']`, `companyAdmin → ['company-admin']`,
`executive → ['executive']`, `teamLeader → ['team-leader']`.

**Sequencing is enforced server-side, not just in the UI:**
- Leave: `mobileApi.ts:104-112` — the acting tier must be `Pending` and *every earlier tier* must be
  `Approved`, else `failed-precondition` "`{Previous Tier} must verify first`".
- Missed punch: `mobileApi.ts:488-498` — identical gate.

**Overall status computation** (rejection anywhere short-circuits; otherwise Pending until all four approve):
- Leave: `leaveFunctions.ts:99-115` (`computeOverallStatusServer`).
- Missed punch: `missedPunchFunctions.ts:66-81` (`computeMissedPunchOverallStatus`).
- Web parity recomputation on mobile: `mobileApi.ts:144-153` (leave) and `:526-533` (punch).

**Progress counters / flat flags:** `computeApprovalCount` (`leaveFunctions.ts:44-48`) and
`computeMissedPunchCount` (`missedPunchFunctions.ts:39-42`) count tiers in `Approved` **or** `Rejected`
(0/4 → 4/4); flat booleans `reportingManagerApproved/companyAdminApproved/executiveApproved/teamLeaderApproved`
are derived at `leaveFunctions.ts:31-39` and `missedPunchFunctions.ts:29-37`.

**Role-based auto-skips (self-management):**
- Team Leader self-application → **all four tiers auto-approved**, one-step Master Admin
  (`leaveFunctions.ts:125-135`, `missedPunchFunctions.ts:89-104`).
- Executive self-application → RM + CA + Exec auto-approved, **Team Leader tier stays live**
  (`leaveFunctions.ts:130-134`, `missedPunchFunctions.ts:95-99`).
- Reporting Manager / HR Manager self-application → own RM tier auto-completes
  (`missedPunchFunctions.ts:100-103`, `:304-316`; leave: `autoSkipSelfReportingManagerTier`,
  `leaveFunctions.ts:56-73`).
- Unassigned RM → RM tier skipped (`missedPunchFunctions.ts:314-315`).

**Master-Admin final gate:**
- Gate applies only to `MANAGEMENT_SELF_SERVICE_ROLES = new Set(['team-leader','executive'])`
  (`leaveFunctions.ts:79`, `missedPunchFunctions.ts:46`) — their personal requests need MA sign-off
  after all four tiers.
- MA rejection ⇒ overall `Rejected`; MA approval required before `Approved`
  (`leaveFunctions.ts:108-113`, `missedPunchFunctions.ts:75-79`).
- MA-only enforcement: `mobileApi.ts:238` (leave), `mobileApi.ts:575` (punch) —
  `'Only Master Admin can perform final review'` / `'Only Master Admin'`.
- MA gate precondition on punch: all earlier tiers must be `Approved` first (`mobileApi.ts:591-593`).
- The trigger re-stamps `masterAdminRequired`, `masterAdminApproverId` and `masterAdminApproveStatus`
  authoritatively on every write, **only when the gate applies** (Firestore rejects `undefined` —
  explicit warning at `leaveFunctions.ts:185-191` and `missedPunchFunctions.ts:341-348`).

**Authoritative approver stamping:** the server overwrites client-written `approverIds` with the resolved
chain (`leaveFunctions.ts:208-224`, `missedPunchFunctions.ts:361-380`); the `missedPunchRectification`
routing state `currentTier`/`assignee` is recomputed each pass (`missedPunchFunctions.ts:400-413`).

**Chain variants documented in code** (`missedPunchFunctions.ts:7-11`): Employee 4-tier;
RM/HR 3-tier (CA → Exec → TL, RM self-tier auto-completes); Executive 2-tier (TL → MA);
Team Lead 1-tier (MA only).

### 4.2 Grace period = 15 minutes

```ts
// attendanceEngine.ts:222  (determineAttendanceStatus)
const gracePeriod = policy.gracePeriodMinutes || 15;
// ...
if (diff <= gracePeriod) return { status: 'Present', lateMinutes: 0 };   // :231
return { status: 'Late', lateMinutes: diff };                             // :235
```
Default policy object also carries `gracePeriodMinutes: 15` (`attendanceFunctions.ts:60`).
Check-in at/before shift start is always `Present` (`attendanceEngine.ts:226-228`).

### 4.3 Overtime threshold = 30 minutes (and early checkout = 30 minutes)

```ts
// attendanceFunctions.ts:322-326 (check-out)
const diffMinutes = (now.getTime() - shiftEndToday.getTime()) / (1000 * 60);
if (diffMinutes > 30) { overtimeHours = Math.round((diffMinutes / 60) * 100) / 100; }
```
The same 30-minute OT threshold is re-applied when a rectified checkout is applied server-side:
`missedPunchFunctions.ts:236` (`const otThresholdMinutes = 30;`, used `:240-243`).

```ts
// attendanceFunctions.ts:332-337 (early checkout)
const threshold = 30;
if (checkOutMinutes < shiftEndMinutes - threshold) status = 'Early Checkout';
```
(`Early Checkout` only applied when the current status is not already `Late`, `:331`.)

### 4.4 Payroll divisor = 26 (`payrollSettings.workingDaysPerMonth`)

```ts
// payrollFunctions.ts:443-463  (generateBulkPayroll path)
let payrollDays: number | undefined;
...
payrollDays = cdata?.payrollSettings?.workingDaysPerMonth || undefined;   // :454
...
const divisor = payrollDays && payrollDays > 0 ? payrollDays : 26;        // :463
```
Identical logic in `calculatePayroll`: `payrollFunctions.ts:798` (read) and `:807` (fallback 26).
Comment at `:462`: *"HR MAX: one core rate for the whole company — Monthly Salary ÷ Payroll Days"*.
Effective days themselves come from `getWorkingDaysInMonth` (Mon–Fri minus company holidays,
`payrollFunctions.ts:137-154`).

### 4.5 December-only leave encashment

```ts
// payrollFunctions.ts:494 (generateBulkPayroll) and :837 (calculatePayroll)
const encashDays = monthIndex === 11 ? getEncashmentDays(emp, leaves, empLeaveAllowances, year, encashableTypes) : 0;
```
`monthIndex === 11` is **December only**. `getEncashmentDays` (`:78-98`) pays unused encashable
balances (default type `Earned`, allowance prorated by join date `:63-71`, `Math.floor` of days),
credited as `leaveEncashment` / `leaveEncashmentDays` on the slip (`:311-312`). Encashable types resolve
from the employee's `monthlyLeaveEntitlements` → assigned policy → company legacy allowances
(`resolveLeavePolicy`, `:108-135`).

### 4.6 Payslip correction window = 5 working days (attendance = 2 working days)

```ts
// workingDays.ts:10-11
export const SLIP_CORRECTION_WORKING_DAYS = 5;
export const ATTENDANCE_CORRECTION_WORKING_DAYS = 2;
```
Enforced in `regeneratePayslip` (`payslipDispatch.ts:549-568`):

```ts
const withinWindow = isWithinSlipCorrectionWindow(createdAt, Date.now(), ctx.weekendDays, ctx.holidayKeys); // :553
const deadline = correctionDeadline(createdAt, SLIP_CORRECTION_WORKING_DAYS, ...);                          // :554
if (!withinWindow || runLocked) {
  if (!isMasterAdmin) throw new functions.https.HttpsError('failed-precondition',
    `The ${SLIP_CORRECTION_WORKING_DAYS}-working-day salary slip correction window has expired ...`);        // :558-563
  if (!overrideReason) throw ... 'A mandatory override reason is required from the Master Admin.';           // :565-567
}
```
Window arithmetic skips weekends + company holidays: `addWorkingDays` / `isWorkingDay`
(`workingDays.ts:58-99`), weekend list from `parseWeekendDays` (default Sun+Sat, `:40-48`).
The 2-working-day attendance window mirrors this (`isWithinAttendanceCorrectionWindow`,
`workingDays.ts:110-117`; frontend twin in `frontend/src/utils/workingDays.ts`).

### 4.7 `sendEmailCentral` — 60-second dedup window

```ts
// emailService.ts:91
const DEDUP_WINDOW_MS = 60 * 1000; // 1 minute
// emailService.ts:237-247  findRecentDuplicate()
const since = new Date(Date.now() - DEDUP_WINDOW_MS);
const snap = await lazyDb().collection('email_logs')
  .where('dedupKey', '==', dedupKey)
  .where('status', '==', 'success')
  .where('createdAt', '>=', since)
  .limit(1).get();
// emailService.ts:289-292  guard: writes a 'skipped-duplicate' log and returns { skipped: 'duplicate' }
```
Key derivation: explicit `dedupKey` if provided, else SHA-256 of `companyId|to|subject|html[0:512]`
(`:228-235`). `force: true` bypasses the check (used by retries, test sends, payroll dispatch).
Dedup **never blocks on infrastructure failure** (`:248-250`). Query shape ⇒ requires a composite
index on `email_logs(dedupKey, status, createdAt)`.

### 4.8 Stakeholder fan-out resolver

```ts
// stakeholderResolver.ts:31
export async function resolveManagementStakeholders(companyId, employeeUserId, employeeName)
```
Returns `{ employeeUserId, employeeName, reportingManagerId, executiveIds, teamLeaderIds,
companyAdminIds, masterAdminIds }` (`:16-24`) resolved as:
1. **RM** from `employees.reportingManagerId` (fallback `users.reportingManagerId`, `:47-64`),
   de-referenced from employee-doc-id → auth uid (`:68-80`) and validated to actually be a manager
   (`role === 'reporting-manager' || isReportingManager`, `:83-92`).
2. **Executives** from `companies.assignedExecutiveId(s)` (`:98-110`), falling back to a
   `users where role == 'executive'` scan filtered by `assignedCompanyIds` (`:115-131`).
3. **Team leaders** from each executive's `assignedTeamLeaderIds`, plus TLs whose
   `linkedExecutiveIds`/`reportingExecutiveId` intersect, plus TLs with the company in
   `assignedCompanyIds` (`:137-164`).
4. **Company admins**: `users where companyId == X && role == 'company-admin'` (`:167-177`).
5. **Master admins**: *platform-wide* `users where role == 'master-admin'` (`:180-187`).

Single source of truth reused by both domains via aliases:
`resolveLeaveStakeholders` (`leaveNotifications.ts:13`) and `resolveMissedPunchStakeholders`
(`missedPunchNotifications.ts:14`) are direct re-exports (`stakeholderResolver.ts:31`).

**Fan-out call sites:** leave created (`leaveFunctions.ts:237-252`), leave final
(`:333-349`), missed-punch submission/final (`missedPunchFunctions.ts:437-459` via
`cascadeMissedPunch` `:131-207`), scheduled sweeps (`scheduledFunctions.ts:58, 263, 318`), and the
real-time cascade (`attendanceCascade.ts:158-206`). Each writes per-recipient `notifications` docs
(deduped by uid, excluding the employee, `missedPunchFunctions.ts:183-201`) + one `adminAlerts` doc;
the `onNotificationCreated` trigger converts them to Expo pushes.

---

## 5. Authorization patterns inside callables (what the AWS rewrite must replicate)

The backend does **not** trust custom claims alone for privileged operations — it re-reads
`users/{uid}`:

| Pattern | Where |
|---|---|
| Master-admin verified in claims **and** Firestore doc (both required) | `syncUserClaims` `index.ts:1323-1331` |
| Master-admin verified against the Firestore doc (claims can be stale) | `setCustomClaims` `index.ts:218-226` |
| **Self-escalation block** — a user can never modify their own claims | `index.ts:206-208` |
| Claims written **after** the user doc exists (avoids rules "Missing or insufficient permissions" ghost) | `index.ts:232-246, 309-337, 777-802, 1126-1140` |
| Company-scope assertions | `assertCompanyScope` `broadcastFunctions.ts:48-66`, `assertCompanyAuth` `payslipDispatch.ts:318-340`, payroll gates `payrollFunctions.ts:252-258, 597-603, 758-764` |
| Claims-based role check (reads `context.auth.token.role`) — **only** in `emailService` | `emailService.ts:387-399` |
| Tier-approver check: stamped uid ∥ master-admin ∥ natural role holder in the same company | `mobileApi.ts:117-129, 503-518` |
| Lockout safety: caller + master-admins never deleted | `index.ts:387-389, 486-488, 563-566` |

---

## 6. Discrepancies & risks to verify in the AWS rewrite

1. **`mobileUpdatePayrollRun` (mobileApi.ts:715) has no role check** — any authenticated user can
   blind-update any `payrollRuns` document. Same pattern (auth-only) in
   `mobileUpdateTicket`, `mobileUpdateTask`, `mobileDeleteNotification`, all `mobile*Email*`
   functions. Confirm the deployed Firebase project behaves the same (these are Admin-SDK writes,
   security rules do not apply).
2. **Two email send paths**: everything goes through `sendEmailCentral` **except**
   `requestAccountDeletion`, which reads `emailSystemConfig/default` and uses SendGrid directly
   (`mobileApi.ts:2028-2053`). Decide whether the AWS version unifies this.
3. **`onUserCreated` is a no-op** (`index.ts:1750-1752`) — real onboarding work happens in
   `sendTempPasswordEmail` (Firestore trigger on `users`), not the Auth trigger.
4. **Plaintext passwords**: `createStaffUser` stores the temp password on the `users` doc
   (`index.ts:1037`) and the `sendTempPasswordEmail` trigger deletes it after emailing
   (`index.ts:1736-1740`). The `employees` doc also receives `password` (`index.ts:1223`) and is
   **not** cleaned. Verify whether this is still live behaviour.
5. **Overtime/early-checkout/grace constants are hardcoded** (30/30/15) except grace, which reads
   `attendanceSettings.gracePeriodMinutes` with a 15 fallback. The AWS config surface should expose
   all three.
6. **`assertNoFinalRun` reads all `payrollRuns` for a company without a month filter**
   (`payrollFunctions.ts:33-36`) — a full-collection scan per generate; needs an index-friendly
   query in AWS.
7. **Scheduled jobs iterate every company in one invocation** (all three crons) — no fan-out per
   tenant; large tenants will need sharding/queueing on AWS.
8. **Dedup queries and stakeholder scans depend on composite/single-field indexes** — port the
   `email_logs(dedupKey,status,createdAt)`, `users(role)`, `users(companyId,role)` and
   `attendance(missedPunchRectification.requested)` queries to the AWS datastore's index design
   (cross-check with `firestore.indexes.json`, see `inventory-collections.md` §5).

---

## 7. Verification checklist for the AWS rewrite

- [ ] 104 endpoints exist (or their responsibilities are explicitly merged), each mapped to a row in §2.
- [ ] Every callable rejects unauthenticated callers and re-reads the caller's role server-side (§5).
- [ ] Tier chains: sequential gate, mandatory rejection remarks, auto-skips, MA gate — unit tests per §4.1.
- [ ] `gracePeriodMinutes` default 15; OT > 30 min; `Early Checkout` > 30 min early (§4.2, §4.3).
- [ ] Payroll divisor `payrollSettings.workingDaysPerMonth || 26` in **both** calculation paths (§4.4).
- [ ] Encashment only when `monthIndex === 11` (§4.5).
- [ ] Slip correction = 5 *working* days (weekends + holidays excluded), master-admin override with
      mandatory reason after expiry; attendance re-submission window = 2 working days (§4.6).
- [ ] Email dedup: 60 s window over `email_logs(dedupKey, status=success, createdAt >= now-60s)`,
      `force` bypass, `skipped-duplicate` logging (§4.7).
- [ ] Stakeholder resolver returns the exact 7-field structure with the same resolution order,
      including RM employee-id → uid de-referencing and platform-wide master-admins (§4.8).
- [ ] Three scheduled jobs with the same crons/timezone (Asia/Kolkata) and the shared
      `missedPunchNotified` / `missedPunchNotifications` idempotency.
- [ ] Push: Expo push URL, `DeviceNotRegistered` token cleanup.
- [ ] Claims: `{role, companyId}` only, written after the user doc, self-escalation forbidden.
