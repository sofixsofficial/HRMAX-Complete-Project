# Firestore Collection Inventory — HRMAX (Firebase reference project)

> **Source of truth:** `C:\Users\azayy\Documents\HRM-Main\HRMAX` (read-only analysis).
> Everything below was derived from actual code (`backend/functions/src`, `frontend/src`,
> `mobile-app/src`, `firestore.rules`, `firestore.indexes.json`) — nothing is assumed from docs.
>
> **Reference notation:** `file:line` points at the exact statement that proves the claim.
> Line numbers are from the original Firebase project at analysis time.

---

## 1. How to read this document

| Column | Meaning |
|---|---|
| **Scope** | `global` (no tenancy), `company` (`companyId` field), `user` (owner `userId`), `subcollection` |
| **Rules** | Has an explicit `match /…` block in `firestore.rules`? If **no**, the collection falls through to the `match /{document=**} allow read, write: if false` default-deny (`firestore.rules:1336`) |
| **Index** | Has ≥1 composite index in `firestore.indexes.json` |
| **Writers/R** | Backend (Cloud Functions, Admin SDK — bypasses rules), Web (`frontend/src`), Mobile (`mobile-app/src`) |

Legend for access columns: `W` = writes, `R` = reads, `—` = not used.

There are **no `collectionGroup(...)` queries anywhere in the repo** (grep for `collectionGroup(` returns
zero hits), so every query is single-collection-scoped. Subcollections are only ever addressed directly
via `collection(db, 'employees', employeeId, 'documents')` style paths.

---

## 2. Master inventory

### 2.1 Business collections (read/written by app code)

| # | Collection | Scope | Rules | Composite idx | Backend | Web | Mobile |
|---|---|---|---|---|---|---|---|
| 1 | `users` | global (doc id = Auth uid) | ✅ | ✅ | W/R | W/R | R |
| 2 | `companies` | global (doc id = company) | ✅ | — | W/R | W/R | W/R |
| 3 | `employees` | company | ✅ | ✅ | W/R | W/R | W/R |
| 4 | `employees/{id}/bankAccounts` | subcollection | ✅ | — | — | W/R | — |
| 5 | `employees/{id}/documents` | subcollection | ✅ | — | — | W/R | — |
| 6 | `employees/{id}/contracts` | subcollection | ✅ | — | — | W/R | — |
| 7 | `departments` | company | ✅ | — | W/R | W/R | W/R |
| 8 | `attendance` | company + user | ✅ | ✅ | W/R | W/R | W/R |
| 9 | `attendanceLogs` | company + user | ✅ | ✅ | W | — | — |
| 10 | `attendanceSettings` | company | ✅ | — | W/R | R | W/R |
| 11 | `leaveRequests` | company + user | ✅ | ✅ | W/R | W/R | W/R |
| 12 | `leavePolicies` | company | ❌ **default-deny** | — | R | R | R |
| 13 | `holidays` | company (nullable = global) | ✅ | ✅ | R | R | W/R |
| 14 | `tasks` | company | ✅ | ✅ | W/R | W/R | W/R |
| 15 | `announcements` | company | ✅ | — | W/R | W/R | W/R |
| 16 | `assets` | company | ✅ | — | — | W/R | R |
| 17 | `invitations` | company | ✅ | ✅ | W/R | W/R | — |
| 18 | `notifications` | user | ✅ | ✅ | W/R | W/R | W/R |
| 19 | `adminAlerts` | company | ✅ | — | W/R | W/R | W/R |
| 20 | `audit_logs` | company | ✅ | ✅ | W/R | W/R | R |
| 21 | `salarySlips` | company + user | ✅ | ✅ | W/R | W/R | R |
| 22 | `payrollRuns` | company | ✅ | ✅ | W/R | W/R | W/R |
| 23 | `payrollAudit` | company | ✅ | ✅ | W/R | W/R | — |
| 24 | `salaryStructures` | company | ✅ | — | W/R | R | W/R |
| 25 | `emails` | company | ✅ | ✅ | W/R | R | W/R |
| 26 | `tickets` | company | ✅ | ✅ | W/R | R | W/R |
| 27 | `ticketMessages` | ticket (top-level) | ❌ **default-deny** | — | W/R | — | — |
| 28 | `documents` | company / user | ✅ | — | — | R | W/R |
| 29 | `performanceReviews` | company | ✅ | — | — | W/R | — |
| 30 | `performance` | company | ❌ **default-deny** | — | — | — | W/R |
| 31 | `roles` | company | ✅ | — | — | R | R |
| 32 | `transfers` | global | ✅ | — | — | R | W/R |
| 33 | `resetCodes` | global | ❌ **default-deny** | (idx mislabelled, see §6) | W/R | W/R | — |
| 34 | `companySettings` | company | ✅ | — | — | W/R | — |
| 35 | `shiftConfigs` | company | ✅ | — | — | W/R | — |
| 36 | `support_tickets` | global | ✅ | — | W/R | R | — |

### 2.2 Backend-only collections (Admin SDK; never touched by clients)

| # | Collection / doc | Written by | Read by | Purpose |
|---|---|---|---|---|
| 37 | `broadcast_jobs` | `broadcastFunctions.ts:121` | `broadcastFunctions.ts:256` | Email-broadcast job log (status/counts/recipients) |
| 38 | `email_logs` | `emailService.ts` (send path) | `emailService.ts:241` (dedup), `listEmailLogs`, `retryEmailLog` | Delivery log + 60 s dedup source |
| 39 | `corporate_inquiries` | `index.ts:1465` | — | Public contact/corporate-inquiry submissions |
| 40 | `accountDeletionRequests` | `mobileApi.ts` (`requestAccountDeletion`) | — | Play-Store account-deletion requests |
| 41 | `missedPunchNotifications` | `missedPunchNotifications.ts:97` | `missedPunchNotifications.ts`, `scheduledFunctions.ts` | Dedupe map (doc id = `dedupeKey`) so sweeps don't double-notify |
| 42 | `emailSystemConfig/{default}` | `mobileApi.ts` | `mobileApi.ts:2028` | Alternate email system config doc |
| 43 | `mail_config/global` (**doc**, not a collection) | `emailService.ts:440` | `emailService.ts:149` | Central SMTP config (`MAIL_CONFIG_DOC`, `emailService.ts:92`) |

### 2.3 Rules/indexes-only (no application code uses them today)

| Collection | Where it exists | Notes |
|---|---|---|
| `conversations` (+ `conversations/{id}/messages`) | `firestore.rules:749-783`, 2 indexes, purge list `index.ts:410` | Legacy chat feature — no `collection(db,'conversations')` reference in web/mobile/backend |
| `dashboardStats` | `firestore.rules:352` | No client/backend reference found |
| `salary_slips` (snake_case) | `firestore.rules:606`, purge list `index.ts:408` | Legacy duplicate of `salarySlips` |
| `leave_requests` (snake_case) | `firestore.rules:624`, purge list `index.ts:407` | Legacy duplicate of `leaveRequests` |
| `jobPosts` | 1 index (`firestore.indexes.json:134`) | No code reference |
| `attendanceQrCodes` | 2 indexes (`firestore.indexes.json:357,367`) | No code reference |
| `leaves` (`collectionGroup: "leaves"`) | 2 indexes (`firestore.indexes.json:43,52`) | Stale — app queries `leaveRequests` |

---

## 3. Field schemas (inferred from write sites)

Schemas below are the **union of fields actually written** by code. Denormalised snapshots
(`employeeName`, `department`, `avatar`, …) are deliberate: list views read one collection only.

### 3.1 `users` (doc id = Firebase Auth uid)

| Group | Fields | Evidence |
|---|---|---|
| Identity | `uid`, `name`, `email`, `emailVerified`, `avatar`, `phone`, `displayName` | `index.ts:216-228`, `index.ts:768-283`, `mobileApi.ts:944` |
| Tenancy / RBAC | `companyId`, `role`, `permissions[]`, `permissionsConfigured`, `permissionScopes{}`, `permissionsUpdatedAt` | `index.ts:188-193` (setCustomClaims sync), `index.ts:316-328`, `AccessManagementScreen.tsx` |
| Employment | `employmentType`, `departmentId`, `department`, `designation`, `active`, `status` (`Pending/Approved/Rejected/Suspended/Active`) | `index.ts:216-228`, `mobileApi.ts:1425/1461/1498` |
| Hierarchy | `assignedCompanyIds[]`, `assignedTeamLeaderIds[]`, `reportingExecutiveId`, `reportingExecutiveName`, `linkedExecutiveIds[]`, `reportingEmployeeIds[]`, `parentCompanyId`, `parentCompanyName` | `index.ts:1136-1195`, `users` updates in `TransferManagement` |
| Approval lifecycle | `approvedBy/approvedAt`, `rejectedBy/rejectedAt/rejectionReason`, `suspendedBy/suspendedAt/suspensionReason`, `reactivatedBy/reactivatedAt`, `isApproved`, `isActive` | `mobileApi.ts:1416-1541`, `companyAdminApprovalService.ts` |
| Auth lifecycle | `password` (temp, then `FieldValue.delete()`), `requirePasswordChange`, `invitedBy`, `inviteAcceptedAt`, `lastLoginAt`, `lastLoginIp` | `index.ts:1694-1745`, `index.ts:781`, `mobileApi.ts:1825` |
| Device / push | `deviceId`, `deviceModel`, `deviceRegisteredAt`, `pushToken`, `notificationsEnabled` | `attendanceFunctions.ts:72-76`, `notificationFunctions.ts:35` |
| Profile extras | `address`, `emergencyContactName`, `emergencyContactPhone`, `updatedAt`, `contingencyAccess` | rules field allow-list `firestore.rules:398-402`, `types/user.ts:5-49` |

> **Auth note:** custom claims carry **only** `role` + `companyId` (`index.ts:324-327`) — the 1000-char
> Firebase Auth claim limit forbids embedding permissions. Permissions live on this document.

### 3.2 `companies` (doc id = company id)

| Group | Fields | Evidence |
|---|---|---|
| Core | `id`, `name`, `slug`, `email`, `status`, `active`, `code`, `domain` | `index.ts:296-213`, `createCompany` slug uniqueness check `index.ts:276` |
| Admin card | `adminId`, `adminName`, `adminEmail`, `adminAvatar`, `employees`, `employeeCount` | `types/user.ts:51-91`, increments `index.ts:812`, `index.ts:1776` |
| Branding | `logoColor`, `logoUrl`, `operationalMode`, `createdOn`, `createdBy`, `createdByName`, `createdByRole` | `companyService.ts` |
| Settings | `settings{timezone,currency,dateFormat,workingHours,workingDays}` | `index.ts:201-207` |
| `attendanceSettings{}` | `officeAddress/latitude/longitude/radiusInMeters/allowMobileData/requireWifi/wifiSSID/requireSelfie` | `types/user.ts:93-102`, `companyService.ts` |
| `payrollSettings{}` | `salaryCycle`, **`workingDaysPerMonth`**, `weekends[]`, `overtimeRatePerHour` | `types/user.ts:104-109` |
| Leave | `leaveAllowances{Casual:12,…}` | `types/user.ts:87`, rules allow-list `firestore.rules:341` |
| Portfolio | `assignedExecutiveId`, `assignedExecutiveName` | `index.ts:1183-1186` |
| Misc | `averageSalary`, `mandatoryAttendanceDays`, `address`, `phone`, `website`, `description`, `parentCompanyId`, `parentCompanyName`, `updatedAt` | rules update allow-list `firestore.rules:336-342` |

### 3.3 `employees` (doc id = employee id)

Fields come from the `Employee` interface (`types/user.ts:137-184`) plus the create path
(`employeeService.ts:527-544`, `index.ts:1240-1263`, `mobileApi.ts:970`):

`id`, `slug`, `userId`, `name`, `email`, `avatar`, `employeeId`, `username`, `password`, `department`,
`departmentId`, `departmentColor`, `designation`, `phone`, `status (Active/Inactive/On Leave)`,
`joinDate`, `companyId`, `salary`, `monthlyGrossSalary`, `salaryEffectiveDate`, `salaryStructureId`,
`employmentType`, `address`, `emergencyContact`, `birthDate`, `shiftId`, `shiftStart`, `shiftEnd`,
`shiftType`, `reportingManagerId`, `reportingManagerName`, `isReportingManager`, `role`,
`leavePolicyId`, `monthlyLeaveEntitlements{}`, `leaveEntitlementYear`, `salaryCycle`,
`workingDaysPerMonth`, `overtimeRatePerHour`, `weekendDays[]`, `parentCompanyId`, `parentCompanyName`,
`createdBy`, `createdByName`, `createdByRole`, `createdAt`, `updatedAt`.

**Subcollections** (typed in `types/employeeProfile.ts`, accessed in `frontend/src/services`):

| Subcollection | Fields | Service |
|---|---|---|
| `employees/{id}/bankAccounts` | `accountHolderName, bankName, accountNumber, ifscCode, panNumber, upiId, isDefault, createdAt, updatedAt` | `bankAccountService.ts:5` |
| `employees/{id}/documents` | `name, category(Identity/Education/Experience/Bank/Other), fileUrl, fileSize, mimeType, uploadedAt, uploadedBy` | `documentService.ts:5` |
| `employees/{id}/contracts` | `type, startDate, endDate, status, documentUrl, salary, notes, createdAt, updatedAt` | `contractService.ts:5` |

### 3.4 `attendance` (doc id = auto)

Written at check-in (`attendanceFunctions.ts:205-237`), GPS-only fallback (`:435-444`),
nightly sweep (`scheduledFunctions.ts:123-1425` region), check-out update (`attendanceFunctions.ts:340-349`).

| Group | Fields |
|---|---|
| Identity snapshot | `userId`, `companyId`, `name`, `email`, `avatar`, `employeeId`, `department`, `departmentColor`, `departmentId` |
| Times | `date`, `checkIn`, `checkOut`, `workHours`, `overtimeHours`, `lateMinutes`, `createdAt`, `updatedAt` |
| Status | `status` ∈ `Present / Absent / Late / Approved / Miss Punch / On Leave / Early Checkout`, `isAutoApproved`, `approved`, `approvedOn`, `approvedByName` |
| Geo/device | `latitude`, `longitude`, `distance`, `method`, `deviceId`, `networkType`, `wifiSsid`, `selfieUrl` |
| Shift | `shiftId`, `shiftStart`, `shiftEnd`, `shiftType` |
| Missed punch | `missedPunchRectification{requested, requestedAt, correctedCheckOut, employeeRemark, resolved, resolvedAt, resolvedBy, resolvedByName, remark, applicantRole, masterAdminRequired, masterAdminApproverId, masterAdminApproveStatus, masterAdminApprovedBy/Name/On/Note, approvalStatus{reportingManager,companyAdmin,executive,teamLeader}, approvalLog[], approverIds{…}, approvalCount, reportingManagerApproved, companyAdminApproved, executiveApproved, teamLeaderApproved, status, currentTier, assignee}`, `missedPunchNotified`, `missedPunchNotifiedAt` |
| Batch-only (sweep) | `notes`, `approvedBy`, `rejectedBy`, `rejectedByName`, `rejectedOn`, `rejectionReason` (`types/user.ts:186-263`) |

### 3.5 `leaveRequests` (doc id = auto)

Canonical shape = `LeaveRequest` (`types/user.ts:511-567`); creation in `leaveService.ts:662-675` and
`mobileApi.ts:475-684`; server reconciliation in `leaveFunctions.ts:177-223`.

| Group | Fields |
|---|---|
| Request | `userId`, `employeeName`, `employeeId`, `employeeEmail`, `avatar`, `department`, `departmentId`, `companyId`, `leaveType`, `startDate`, `endDate`, `totalDays`, `reason`, `isPaid`, `appliedOn`, `createdAt`, `updatedAt` |
| 4-tier chain | `approvalStatus{reportingManager,companyAdmin,executive,teamLeader}`, `approverIds{…}`, `approvalLog[]`, `approvalCount`, `reportingManagerApproved`, `companyAdminApproved`, `executiveApproved`, `teamLeaderApproved` |
| Outcome | `status (Pending/Approved/Rejected/Cancelled/On Leave)`, `reviewedBy`, `reviewedByName`, `reviewedOn`, `rejectedAt`, `reviewNote`, `notifiedFinalStatus` |
| Master-admin gate | `applicantRole`, `masterAdminRequired`, `masterAdminApproveStatus`, `masterAdminApproverId`, `masterAdminApprovedBy/Name/On`, `masterAdminNote` |

### 3.6 Payroll family

**`salarySlips`** — written by `payrollFunctions.ts:1199-1239` / `:875-1322`, `mobileApi.ts:748`,
corrections in `payslipDispatch.ts:640-641`; typed by `SalarySlip` (`types/user.ts:302-357`):

`userId`, `employeeName`, `employeeEmail`, `avatar`, `employeeId`, `department`, `departmentColor`,
`designation`, `dateOfJoining`, `month`, `year`, `basicSalary`, `allowances`, `deductions`, `netSalary`,
`status (Pending/Paid/Processing/Emailed)`, `paidOn`, `companyId`, `payrollRunId`, `payrollRef`,
`payroll{workingDays, presentDays, paidLeaveDays, unpaidLeaveDays, halfDays, holidayDays, absentDays,
overtimeHours, totalPayableDays, unresolvedMissPunchDays, grossSalary, overtimePay, leaveEncashment,
leaveEncashmentDays, absentDeduction}`, `breakdown{hra, da, pf, tax, otherDeductions, absentDeduction,
leaveEncashment}`, `createdAt`, `updatedAt`, correction/versioning (`version`, `supersedesId`,
`superseded`, `supersededBy`, `supersededAt`, `correction{reason, correctedBy/Name/At, previous, current,
overrideReason, payrollRef}`), email state (`emailStatus`, `emailError`, `emailSentAt`,
`payslipEmailStatus`, `payslipEmailAt`).

**`payrollRuns`** — `payrollFunctions.ts:1242-1258`/`:1325-1339`, status transitions at
`:620-628`, `payslipDispatch.ts:498`, `:647`, `mobileApi.ts:772`; typed `PayrollRun` (`types/user.ts:628-661`):

`companyId`, `month`, `year`, `monthIndex`, `status (Draft→Calculated→Submitted→Approved→Generated→Emailed→Corrected→Disbursed→Locked)`,
`payrollRef`, `workingDays`, `totalEmployees`, `totalNet`, `items[]` (full `PayrollItem` snapshot,
`types/user.ts:584-626`), `createdBy`, `departmentId`, `isBulk`, `createdAt`, `updatedAt`,
`submittedBy/Name/At`, `submissionNote`, `disbursedOn`, `locked`, `lockedAt`, `lockReason`,
`lockOverrideReason`, `payslipEmailsDispatched/Count/Failed/At`, `correctedBy/Name/At`.

**`payrollAudit`** — `action`, `companyId`, `departmentId`, `employeeCount`, `month`, `year`,
`performedBy`, `performerName`, `performerRole`, `runId`, `totalNet`, `timestamp` (`payrollService.ts`, `payrollFunctions.ts`).

**`salaryStructures`** — `SalaryStructure` (`types/user.ts:468-489`): `name`, `companyId`,
`basicSalary`, `hra`, `da`, `conveyance`, `medical`, `specialAllowance`, `pf`, `professionalTax`,
`overtimeRate`, `grossSalary`, `description`, `createdBy`, `createdAt`, `updatedAt` (`mobileApi.ts:1036`).

### 3.7 Communication / audit

| Collection | Fields (write sites) |
|---|---|
| `notifications` | `userId`, `companyId`, `type`, `title`, `body`, `read`, `link`, `createdAt` (`attendanceCascade.ts:164-184`, `leaveNotifications.ts:90-108`); payroll variant `message`, `recipients[]`, `readBy[]` (`payrollFunctions.ts:711-719`); mobile variant `relatedId` (`mobileApi.ts:1094`) — typed `AppNotification` (`types/user.ts:722-732`) |
| `adminAlerts` | `companyId`, `companyName`, `type`, `title`, `body`, `link`, `read`, `priority (normal/high)`, `createdAt`, `actionBy`, `actionByName`, `createdBy`, `readAt` (`attendanceCascade.ts:197`, `broadcastFunctions.ts:203`, `mobileApi.ts:1743`, `scheduledFunctions.ts:194`) |
| `audit_logs` | `companyId`, `userId`, `userName`, `userRole`, `userEmail`, `action`, `actionType`, `module`, `entity`, `entityId`, `targetEntity`, `targetId`, `description`, `details`, `previousData`, `newData`, `status`, `ipAddress`, `userAgent`, `timestamp` (`index.ts:701`, `:1801`, `broadcastFunctions.ts:220`, `emailService.ts:177`) |
| `emails` | `to/cc/bcc/subject/html/body/type/date`, `fromUserId`, `read`, `starred`, `deleted`, `archived`, `readAt`, `deletedAt`, `archivedAt`, `createdAt`, `updatedAt` (`mobileApi.ts:1885-1973`); delivery fields `status`, `sentAt`, `deliveredAt`, `messageId`, `error`, `entity`, `action`, `userId`, `userName`, `userRole` (`emailService.ts:342-369`) |
| `email_logs` | `dedupKey`, `status`, `createdAt`, `companyId`, `attempts`, `lastRetryAt`, `lastRetriedBy`, `linkedEmailId`, `triggeredBy`, `updatedAt` (`emailService.ts:241-244`, `:531`) |
| `tickets` | `SupportTicket` (`types/user.ts:395-415`): `title`, `description`, `status`, `priority`, `createdBy`, `createdById`, `assignedTo`, `category`, `companyId`, `companyName`, `executiveId/Name`, `tlId/Name`, `conversation[]`, `createdAt`, `updatedAt`, `resolvedAt`; plus `lastMessage`, `lastMessageBy`, `lastMessageByName`, `updatedBy`, `updatedByName` (`mobileApi.ts:1652-1657`) |
| `ticketMessages` | `ticketId`, sender + message payload passed as `messageData` (`mobileApi.ts:1652`) |
| `support_tickets` | `title`, `description`, `category`, `createdBy`, `createdById`, `status`, `priority`, `source`, `phone`, `email`, `userName`, `userEmail`, `companyName`, `emailDelivered`, `emailedAt`, `emailMessageId`, `emailError`, `createdAt` (`index.ts:1497+`, `sendSupportTicket`) |
| `corporate_inquiries` | `companyName`, `fullName`, `workEmail`, `phoneNumber`, `estimatedTeamSize`, `source`, `recipientEmail`, `subject`, `timestamp`, `createdAt` (`index.ts:1465-1473`) |
| `broadcast_jobs` | `id`, `companyId`, `subject`, `messageType`, `recipientMode`, `departmentId`, `total`, `dispatched`, `failed`, `skipped`, `recipients[]`, `status`, `triggeredBy`, `triggeredByName`, `createdAt`, `updatedAt` (`broadcastFunctions.ts:121-191`) |

### 3.8 Remaining collections

| Collection | Fields (evidence) |
|---|---|
| `departments` | `name`, `code`, `color`, `companyId`, `managerId/Name`, `description`, `employeeCount`, `executiveName`, `teamLeaderName`, `createdBy/Name/Role`, `createdAt`, `updatedAt` (`Department` type `types/user.ts:447-463`, `companyService.ts`, `mobileApi.ts:1302`) |
| `holidays` | `name`, `date`, `type (Public/Company/Optional)`, `description`, `companyId` (nullable ⇒ global) — `Holiday` type `types/user.ts:377-384` |
| `tasks` | `title`, `description`, `assignedTo`, `assignedToId`, `avatar`, `priority`, `status`, `dueDate`, `progress`, `companyId`, `departmentId`, `createdBy`, `createdAt`, `updatedAt` — `Task` type `types/user.ts:359-375` |
| `announcements` | `title`, `content`, `author`, `category`, `priority`, `pinned`, `companyId`, `createdBy`, `createdAt`, `updatedAt` (`Announcements.tsx`, `mobileApi.ts:855`) |
| `assets` | company-scoped asset records created from `frontend/src/pages/Assets.tsx` (rules keys `asset_create/asset_edit/asset_delete`) |
| `invitations` | `id`, `companyId`, `email`, `name`, `role`, `departmentId`, `token`, `tokenExpiresAt` (+7 days), `status (pending/accepted/expired)`, `invitedBy`, `invitedByName`, `designation`, `avatar`, `employeeId`, `userId`, `createdAt`, `updatedAt`, `acceptedAt`, `acceptedBy` (`index.ts:631-646`, `:761`, `:805`, `authService.ts`) |
| `resetCodes` | `email`, `code`, `expiresAt` (10 min), `used`, `createdAt`, `usedAt` (`authService.ts:340-347`, `index.ts:1661-1676`) |
| `documents` | `name`, `url`, `category`, `companyId`, `userId`, `uploadedBy`, `uploadedById`, `storagePath`, `size`, `createdAt` (`DocumentsScreen.tsx`, `DocumentsManagementScreen.tsx`, `DocumentsManagement.tsx:180`) |
| `performanceReviews` | `companyId`, `name`, `department`, `rating`, `kpi`, `reviews` + reviewer meta (`Performance.tsx:39-55`) |
| `performance` (mobile-only twin) | `employeeId`, `employeeName`, `employeeEmail`, `department`, `feedback`, `reviewerId`, `reviewerName`, `companyId`, `createdAt` (`PerformanceScreen.tsx:48+`) |
| `roles` | `RolePermission` (`types/user.ts:432-445`): `roleId`, `roleName`, `permissions[]`, `module`, `canCreate/Read/Update/Delete/Approve/Export`, `createdAt` |
| `transfers` | **Rules contract:** `sourceExecutiveId/Name`, `destExecutiveId/Name`, `transferredCompanies`, `transferredTeamLeaders`, `initiatorId/Name`, `status='completed'`, `createdAt` (`firestore.rules:1233-1241`). **Mobile writer uses a different shape:** `employeeId`, `employeeName`, `employeeEmail`, `fromCompanyId/Name`, `toCompanyId/Name`, `requestedBy/Id`, `approvedBy/Id/At`, `status`, `createdAt` (`TransferManagementScreen.tsx:44+`) — see §6 |
| `companySettings` | `companyId`, `gracePeriodMinutes`, `missedPunchThresholdMinutes`, `autoApprovalEnabled`, `createdAt`, `updatedAt` (`CompanySettings` type `types/user.ts:752-760`) |
| `shiftConfigs` | `companyId`, `name`, `type`, `startTime`, `endTime`, `description`, `createdAt`, `updatedAt` (`ShiftConfig` `types/user.ts:737-747`, `shiftService.ts`) |
| `attendanceSettings` | `companyId`, `mode`, `officeLocation/address`, `latitude`, `longitude`, `radiusMeters`, `allowedWifis[]`, `wifiOnly`, `mobileDataAllowed`, `requireSelfie`, `selfieExpirySeconds`, `gracePeriodMinutes`, `enableGeofence`, `defaultShiftStart`, `defaultShiftEnd`, `name`, `createdBy`, `createdAt`, `updatedAt` (`companyService.ts`, `attendanceEngine.ts:39+`, `mobileApi.ts:1283/1397`) |
| `attendanceLogs` | `userId`, `companyId`, `deviceId`, `deviceModel`, `batteryLevel`, `networkType`, `wifiSsid`, `isVpn`, `isMockLocation`, `isEmulator`, `latitude`, `longitude`, `ipAddress`, `timestamp`, `attendanceId`, `action`, `status (success/failure)`, `reasonCode`, `reasonMessage` (`attendanceFunctions.ts:79-94` + `:100-244`) |
| `leavePolicies` | `LeavePolicy` (`types/user.ts:122-135`): `companyId`, `name`, `description`, `isDefault`, `types{Casual:{days,paid,encashable},…}`, `createdBy`, `createdByName`, `createdAt`, `updatedAt` |
| `missedPunchNotifications` | dedupe doc keyed by `dedupeKey`: `attendanceId`, `companyId`, `employeeUserId`, `employeeName`, `dateLabel`, `kind`, `createdAt` (`missedPunchNotifications.ts:97`) |
| `accountDeletionRequests` | `employeeId`, `reason`, `requestedBy`, `requestedByEmail`, `status`, `createdAt`, `updatedAt` (`mobileApi.ts` — `requestAccountDeletion`) |

---

## 4. Query inventory (where / orderBy / limit)

Every Firestore read in the codebase. `BE` = backend (`functions/src`, Admin SDK),
`WEB` = `frontend/src`, `MOB` = `mobile-app/src`.

### 4.1 `users`

| # | Query | Where |
|---|---|---|
| 1 | `where('companyId','==',cid).limit(500)` / `.limit(300)` | BE `index.ts:385`, `index.ts:470` |
| 2 | `where('companyId').limit(300)` + `startAfter(cursor)` (paged) | BE `index.ts:470-472` |
| 3 | `where('email','==',email)` | BE `index.ts:628`; WEB `employeeService.ts:493` |
| 4 | `where('companyId').where('role','==','company-admin').limit(1)` | BE `stakeholderResolver.ts:169`, `payrollFunctions.ts:637`, `payslipDispatch.ts:79`, `scheduledFunctions.ts:177`, `mobileApi.ts:353` |
| 5 | `where('role','==','executive')` | BE `stakeholderResolver.ts:118`, `mobileApi.ts:359,370` |
| 6 | `where('role','==','team-leader')` | BE `stakeholderResolver.ts:148` |
| 7 | `where('role','==','master-admin').limit(1)` / full | BE `stakeholderResolver.ts:182`, `mobileApi.ts:399,2010` |
| 8 | `where('role','==','master-admin')` | WEB `authService.ts:184,920,971`, `notificationService.ts:204`, `leaveService.ts:343` |
| 9 | `where('role','in',['executive','master-admin'])` | WEB `notificationService.ts:175` |
| 10 | `where('role','==','company-admin')` (+`companyId`) | WEB `companyAdminApprovalService.ts:20,184`, `leaveService.ts:481`, `attendanceService.ts:684` |
| 11 | `where('role','==','team-leader')` | WEB `leaveService.ts:373,488`, `attendanceService.ts:627` |
| 12 | `where('role','==','executive')` | WEB `leaveService.ts:503,514`, `attendanceService.ts:620,696` |
| 13 | `where('role','in', MANAGER_ROLES)` / `['company-admin','Company Admin','company_admin']` | WEB `employeeService.ts:269,298` |
| 14 | `where('companyId')` (company roster) | WEB `authService.ts:687` |
| 15 | `where('role','==',<roleName>)` | WEB `roleService.ts:170` |
| 16 | `where('companyId').where('status','==','Active')`, `where('companyId').where('role','in',…)`, `where('companyId').where('role','==',…)` | MOB `EmailCenterScreen.tsx:495-510` |
| 17 | `where('role','in',['company-admin','executive','team-leader'])` | MOB `EmployeeDashboard.tsx:83`, `MyLeavesAttendanceScreen.tsx:214` |
| 18 | `where('role','==',…)` listing screens | MOB `MasterAdminDashboard.tsx:186`, `CompaniesScreen.tsx:160,164`, `TeamLeadersScreen.tsx:89,95,98`, `ExecutivesScreen.tsx:178,199,211`, `ExecutiveDashboard.tsx:59,68`, `TLOperationalDashboard.tsx:85,97`, `ExecutiveOversightScreen.tsx:45`, `ExecutiveProfileScreen.tsx:35`, `ExecutiveTeamLeadersScreen.tsx:24,26`, `HandledCompaniesScreen.tsx:25,27` |

> ⚠️ **Unindexed / composite-needing shapes:** several of these are `role == X` (single-field, automatic
> index) — fine. The composite-sensitive ones are `companyId + role` (`firestore.indexes.json:118` exists).

### 4.2 `companies`

| # | Query | Where |
|---|---|---|
| 1 | `where('slug','==',slug)` (uniqueness at create) | BE `index.ts:276` |
| 2 | `where('status','==',status)` | WEB `companyService.ts:57` |
| 3 | `where('__name__','in', …)` chunked portfolio reads | WEB `scopedQueries.ts:62-75`, MOB `useDashboardStats.ts:183,191` |
| 4 | direct `doc()` gets via `CompanyContext.tsx` | WEB (single-doc get) |

### 4.3 `employees`

| # | Query | Where |
|---|---|---|
| 1 | `where('companyId').limit(300)` / no limit | BE `index.ts:417,493`, `broadcastFunctions.ts:101`, `payrollFunctions.ts:411,771` |
| 2 | `where('companyId').where('departmentId','==',…)` | BE `payrollFunctions.ts:413` |
| 3 | `where('userId','==',uid).limit(1/500)` | BE `attendanceFunctions.ts:190`, `index.ts:568,1254`, `stakeholderResolver.ts:48`, `mobileApi.ts:345` |
| 4 | `where('companyId').limit(10)` (header badge) | WEB `Header.tsx:90` |
| 5 | `where('companyId')` / chunked `where('companyId','in',batch)` | WEB `employeeService.ts:46,61,133,256`; MOB `employeeService.ts:44,54,89` |
| 6 | `where('departmentId','==',…)` | WEB `employeeService.ts:71`; MOB `AnalyticsScreen.tsx:54` |
| 7 | `where('userId','==',managerId)` (direct reports) | WEB `employeeService.ts:99`; MOB `TeamLeaderProfileScreen.tsx:36` uses `reportingManagerId` |
| 8 | `where('slug','==',slug)` | WEB `employeeService.ts:348` |
| 9 | `where('userId','==',uid)` (profile link) | WEB `employeeService.ts:356`, `leaveService.ts:325,471`, `attendanceService.ts:675`; MOB `AuthContext.tsx:120`, `LeaveScreen.tsx:172`, `attendanceApi.ts:187` |
| 10 | `where('reportingManagerId','==',tlId)` | MOB `TeamLeaderProfileScreen.tsx:36` |

Indexes backing these: `employees companyId+status` (`indexes:27`), `companyId+departmentId` (`indexes:36`).

### 4.4 `attendance`

| # | Query | Where |
|---|---|---|
| 1 | `where('userId').where('date','>=',today).where('date','<',tomorrow)` (duplicate check-in) | BE `attendanceEngine.ts:177-179` |
| 2 | `where('date','>=',start).where('date','<',end).where('checkOut','==',null)` (night sweep) | BE `scheduledFunctions.ts:40-42` |
| 3 | `where('companyId').where('date','>=',start).where('date','<',end)` (sweep) | BE `scheduledFunctions.ts:98-100,253-255,286-288` |
| 4 | `where('missedPunchRectification.requested','==',true)` | BE `missedPunchFunctions.ts:534` |
| 5 | `where('companyId')` / `where('userId')` | WEB `attendanceService.ts:85,91`; MOB `payrollService.ts:273,354`, `AttendanceDashboardScreen.tsx:76`, `AnalyticsScreen.tsx:63,73` |
| 6 | `where('date','>=',startOfDay).where('date','<=',endOfDay)` (+`userId`) | WEB `attendanceService.ts:104-105,119-121,1290-1291,1313-1315` |
| 7 | `where('companyId').where('date','>=',startDate).where('date','<=',endDate)` | WEB `attendanceService.ts:1223-1225` |
| 8 | `where('departmentId')` | WEB `attendanceService.ts:1165` |
| 9 | `orderBy('date')` realtime `onSnapshot` (self / all / chunked `companyId`) | WEB `Attendance.tsx:276-291` |
| 10 | `where('userId').orderBy('date','desc').limit(30)` | MOB `AttendanceScreen.tsx:195` |
| 11 | `where('userId').where('date','>=',monthStart).where('date','<',tomorrow)` | MOB `AttendanceScreen.tsx:206`, `useEmployeePersonalStats.ts:89,104`, `EmployeeProfileScreen.tsx:35` |
| 12 | `where('missedPunchRectification.masterAdminRequired','==',true)` | MOB `LeaveApprovalsPanel.tsx:164` |
| 13 | `where('companyId').where('date','>=',since).orderBy('date','desc')` | MOB `AttendanceScreen.tsx:230-232` |
| 14 | `where('date','>=',Timestamp).where('date','<',Timestamp)` (+chunked `companyId`) | MOB `AttendanceOverviewScreen.tsx:87-99` |
| 15 | `where('companyId').limit(50)` / `orderBy('date','desc').limit(50)` | WEB `ExecutiveOversight.tsx:105-106` |
| 16 | `where('companyId').where('date','>=',today).limit(10)` | WEB/MOB `TLOperationalDashboard.tsx:214` / `:197` |

Composite indexes consumed: `companyId+date ASC` (`indexes:2`), `companyId+date DESC` (`:219`),
`userId+date DESC` (`:10`), `userId+date ASC` (`:17`), `companyId+checkOut+date DESC` (`:207`),
`checkOut+date ASC` (`:297`), `departmentId+date` (`:143`).

### 4.5 `leaveRequests`

| # | Query | Where |
|---|---|---|
| 1 | `where('userId').where('status','==','Approved')` (on-leave during check-in) | BE `attendanceFunctions.ts:250-253` |
| 2 | `where('companyId')` | BE `payrollFunctions.ts:430,773`; WEB `leaveService.ts:577`; MOB `AnalyticsScreen.tsx:64,75` |
| 3 | `where('departmentId')` | WEB `leaveService.ts:583` |
| 4 | `where('companyId').where('approverIds.reportingManager','==',uid)` | WEB `leaveService.ts:591-592` |
| 5 | `where('userId')` | WEB `leaveService.ts:599`; MOB `LeaveScreen.tsx:163`(+)`, MyLeavesAttendanceScreen.tsx:146`, `useEmployeePersonalStats.ts:124` |
| 6 | `where('companyId').where('status','==','Pending')` | MOB `LeaveApprovalsPanel.tsx:113` |
| 7 | `where('masterAdminRequired','==',true)` | MOB `LeaveApprovalsPanel.tsx:144` |
| 8 | `where('userId').orderBy('appliedOn','desc').limit(50)` | MOB `LeaveScreen.tsx:163` |
| 9 | `where('companyId').orderBy('appliedOn','desc').limit(15)` | WEB/MOB `TLOperationalDashboard.tsx:211` / `:196` |
| 10 | `where('status','==','Approved')` (sweep on-leave set) | BE `scheduledFunctions.ts:105-106,293-294` |

Composite indexes consumed: `companyId+createdAt DESC` (`:190`), `companyId+appliedOn DESC` (`:199`),
`companyId+status` (`:306`), `userId+status+startDate+endDate` (`:314`),
`approverIds.reportingManager+status` (`:333`), `companyId+approverIds.reportingManager` (`:341`),
`userId+appliedOn DESC` (`:349`).

### 4.6 Payroll family

| Collection | Query | Where |
|---|---|---|
| `payrollRuns` | `where('companyId')` | BE `payrollFunctions.ts:33`; WEB `payrollService.ts:303`; MOB `payrollService.ts:28` |
| `salarySlips` | `where('payrollRunId','==',runId)` | BE `mobileApi.ts:1157` |
| | `where('companyId')` | BE `payslipDispatch.ts:67,390,692` |
| | `where('companyId').where('userId','==',uid)` | BE `payslipDispatch.ts:209-210` |
| | `where('userId')` | MOB `useEmployeePersonalStats.ts:154`; WEB `salaryService.ts:78` |
| | `where('companyId')` | WEB `salaryService.ts:71`; MOB `salaryService.ts:46` |
| `payrollAudit` | written/filtered with `companyId` + `timestamp` | WEB `payrollService.ts` (index `:289`) |
| `salaryStructures` | `where('companyId')` | BE `payrollFunctions.ts:432,775`; MOB `salaryStructureService.ts:32`; WEB `salaryStructureService.ts:50` |
| `leavePolicies` | `where('companyId')` | BE `payrollFunctions.ts:449,793`; WEB `leavePolicyService.ts:62`; MOB `leaveService.ts:306` |

### 4.7 Other collections

| Collection | Queries | Where |
|---|---|---|
| `holidays` | `where('companyId')` BE `payslipDispatch.ts:60`, `payrollFunctions.ts:431,774`, `scheduledFunctions.ts` ; `where('companyId','in',[cid,null])` WEB `holidayService.ts:33` / MOB `holidayService.ts:16`, `AttendanceScreen.tsx:100`, `LeaveScreen.tsx:105` ; `where('date','>=',today).orderBy('date','asc')` WEB `holidayService.ts:50-51` ; date-range MOB `HolidayCalendarScreen.tsx:54-72` |
| `notifications` | `where('userId').limit(50)` MOB `notificationService.ts:37` ; `where('userId').orderBy('createdAt','desc').limit(100)` WEB `notificationService.ts:506-507` ; `where('userId').where('read',false)` WEB `:69-70,91-92,105-106`, MOB `:70,76` ; `where('userId').where('read',false)` BE `mobileApi.ts:887` |
| `adminAlerts` | `where('read',false)` WEB `notificationService.ts:533`, BE `mobileApi.ts:1782` ; `orderBy('createdAt','desc').limit(100)` MOB `notificationService.ts:95` |
| `audit_logs` | `orderBy('timestamp')` (+`companyId`, `limit(5000/10)`) WEB `AuditLogs.tsx:96-100`, `ExecutiveOversight.tsx:127-128`, `Settings.tsx:116` ; MOB `AuditLogsScreen.tsx:38` |
| `tickets` | `orderBy('createdAt','desc')` WEB `ticketService.ts:17` ; `where('companyId').orderBy('createdAt','asc')` `:23` ; `where('companyId','in',…)` `:30` ; `where('createdById')` `:36` ; `where('executiveId')` `:42` ; `where('tlId')` `:48` ; MOB `supportService.ts:42,53,60,65` ; `where('companyId').limit(10)` WEB `Header.tsx:99` ; MOB `ExecutiveProfileScreen.tsx:37` |
| `support_tickets` | `where('companyId')` WEB `Reports.tsx:112` |
| `ticketMessages` | `where('ticketId')` BE `mobileApi.ts:1683` |
| `announcements` | `where('companyId').limit(10)` WEB `Header.tsx:108` ; MOB `announcementService.ts:39,40,73` (`orderBy createdAt desc`) |
| `tasks` | `where('companyId')` WEB `taskService.ts:33`, MOB `taskService.ts:25`, `AnalyticsScreen.tsx:55,74` ; `where('assignedToId')` WEB `:46`, MOB `:31`, `useEmployeePersonalStats.ts:141`, `EmployeeProfileScreen.tsx:46` ; `where('companyId').orderBy('createdAt','desc').limit(15)` WEB/MOB `TLOperationalDashboard.tsx:208/:195` ; `where('assignedToId').orderBy('createdAt','desc').limit(30)` MOB `TasksScreen.tsx:38` ; `where('departmentId')` MOB `AnalyticsScreen.tsx:55` |
| `departments` | `where('companyId')` / chunked `in` — WEB `departmentService.ts:50`, MOB `departmentService.ts:32,42,76` |
| `assets` | `where('companyId')` MOB `AssetsScreen.tsx:78`; WEB `Assets.tsx` |
| `invitations` | `where('companyId').where('status','pending')` WEB `invitationService.ts:38-39` ; `where('status','pending')` `:44` ; `where('token').where('status','pending')` WEB `authService.ts:718,986`, BE `index.ts:748-749` |
| `resetCodes` | `where('email').where('code').where('used',false)` WEB `authService.ts:358-360`, BE `index.ts:1646-1648` ; `where('email')` WEB `:379` |
| `emails` | `where('companyId')` + `orderBy('date','asc')` WEB `emailService.ts:26-35` ; `orderBy('date','desc')` MOB `emailService.ts:54-55,85` ; `where('status')` BE `emailService.ts:531` |
| `email_logs` | `where('dedupKey').where('status','success').where('createdAt','>=',since).limit(1)` BE `emailService.ts:241-244` ; `where('status')` `:531` |
| `attendanceLogs` | `where('companyId').orderBy('timestamp','desc').limit(n)` / `where('userId')…` WEB `attendanceLogService.ts:52-86` |
| `attendanceSettings` | `where('companyId').limit(1)` BE `attendanceFunctions.ts:38-41` ; `where('companyId')` WEB `attendanceSettingsService.ts:42,52,81`, `companyService.ts`; MOB `attendanceSettingsService.ts:72` |
| `documents` | `orderBy('createdAt','desc')` MOB `DocumentsScreen.tsx:55`, `DocumentsManagementScreen.tsx:46` ; `where('companyId').orderBy('createdAt','desc')` `DocumentsScreen.tsx:62` |
| `performanceReviews` | `where('companyId')` (realtime `onSnapshot`) WEB `Performance.tsx:39-43` |
| `performance` | `where('companyId').orderBy('createdAt','desc')` / `orderBy('createdAt','desc')` MOB `PerformanceScreen.tsx:48-49` |
| `roles` | `where('status')` / `where('roleType')` WEB `roleService.ts:71,83` |
| `transfers` | `orderBy('createdAt','desc')` MOB `TransferManagementScreen.tsx:44` |
| `companySettings` / `shiftConfigs` | `where('companyId')` WEB `shiftService.ts:31,67,84` |
| `conversations` | **no queries anywhere** (rules + indexes only) |
| `broadcast_jobs` | `where('companyId')` BE `broadcastFunctions.ts:256` |
| `dashboardStats` | **no queries anywhere** (rules only) |

### 4.8 Shared scoping helper (web)

`frontend/src/services/scopedQueries.ts` builds the company-scoped query used by most list pages:

- master-admin → unscoped collection read (`:38` `__name__ == 'scope-empty'` sentinel when nothing to scope)
- company-admin / employee / reporting-manager → `where('companyId','==', user.companyId)` (`:48`)
- executive → `where('companyId','in', ids.slice(0,10))` chunked (`:62-64`, chunk loop `:75`)
- team-leader → `where('reportingManagerId'/'assignedToId'/'userId','==',user.id)` per module (`:85-120`)
- empty scope → `where('__name__','==','scope-empty')` so the page renders empty instead of leaking (`:50,72,91,97,129`)

The same 10-item `in`-chunking pattern appears in `employeeService.ts:133`, `holidayService.ts:33`,
`ticketService.ts:30` and `useDashboardStats.ts:183` (**Firestore `in` limit = 10**).

---

## 5. Composite index cross-check vs `firestore.indexes.json`

**Total composite indexes: 45** (all `queryScope: COLLECTION`, `fieldOverrides: []`).
Legend: **USED** = a query in §4 requires it · **LEGACY** = no matching query in current code
(harmless, but do not port blindly) · **MISLABELLED** = the `collectionGroup` does not match the
collection the query actually runs against.

| # | Collection group | Fields | `indexes` line | Status / matching query |
|---|---|---|---|---|
| 1 | `attendance` | companyId↑, date↑ | 2 | USED — `attendanceService.ts:1223`, `scheduledFunctions.ts:98` |
| 2 | `attendance` | userId↑, date↓ | 10 | USED — `AttendanceScreen.tsx:195`, `Attendance.tsx:276` |
| 3 | `attendance` | userId↑, date↑ | 17 | USED — `attendanceEngine.ts:177`, personal-stat ranges |
| 4 | `employees` | companyId↑, status↑ | 27 | USED — status-filtered rosters |
| 5 | `employees` | companyId↑, departmentId↑ | 36 | USED — `payrollFunctions.ts:411-413` |
| 6 | `leaves` | companyId, status, startDate↓ | 43 | **LEGACY** — app uses `leaveRequests` |
| 7 | `leaves` | userId↑, startDate↓ | 52 | **LEGACY** — as above |
| 8 | `tasks` | companyId↑, status↑ | 60 | USED (status-filtered task views) |
| 9 | `tasks` | assignedToId↑, status↑ | 69 | USED (my-tasks status views) |
| 10 | `notifications` | userId↑, createdAt↓ | 77 | USED — `notificationService.ts:506`, `notificationService.ts:37` |
| 11 | `conversations` | participants↑, lastMessageTime↓ | 85 | **LEGACY** — no code reads `conversations` |
| 12 | `payrollRuns` | companyId↑, year↓, monthIndex↓ | 93 | USED — payroll history ordering |
| 13 | `holidays` | companyId↑, date↑ | 101 | USED — `holidayService.ts:50`, `HolidayCalendarScreen.tsx:54` |
| 14 | `salarySlips` | companyId↑, month↑, year↓ | 109 | USED — payslip history |
| 15 | `users` | companyId↑, role↑ | 118 | USED — `stakeholderResolver.ts:169`, `payrollFunctions.ts:637`, `EmailCenterScreen.tsx:495` |
| 16 | `invitations` | token↑, status↑ | 127 | USED — `index.ts:748`, `authService.ts:718` |
| 17 | `jobPosts` | companyId, status, postedOn↓ | 134 | **LEGACY** — no `jobPosts` code |
| 18 | `attendance` | departmentId↑, date↑ | 144 | USED — `attendanceService.ts:1165` + date filter |
| 19 | `tickets` | companyId↑, createdAt↓ | 152 | USED — `ticketService.ts:23`, `supportService.ts:42` |
| 20 | `tickets` | createdById↑, createdAt↓ | 160 | USED — `ticketService.ts:36` |
| 21 | `tickets` | executiveId↑, createdAt↓ | 168 | USED — `ticketService.ts:42` |
| 22 | `tickets` | tlId↑, createdAt↓ | 176 | USED — `ticketService.ts:48` |
| 23 | `tasks` | companyId↑, createdAt↓ | 184 | USED — `TLOperationalDashboard.tsx:208` |
| 24 | `leaveRequests` | companyId↑, createdAt↓ | 192 | USED (legacy `orderBy('createdAt')` consumers) |
| 25 | `leaveRequests` | companyId↑, appliedOn↓ | 200 | USED — `TLOperationalDashboard.tsx:211` |
| 26 | `attendance` | companyId↑, checkOut↑, date↓ | 208 | USED — open-checkout / late scans |
| 27 | `attendance` | companyId↑, date↓ | 217 | USED — `ExecutiveOversight.tsx:105` |
| 28 | `audit_logs` | companyId↑, timestamp↓ | 225 | USED — `AuditLogs.tsx:96` |
| 29 | `invitations` | companyId↑, status↑ | 233 | USED — `invitationService.ts:38` |
| 30 | `emails` | companyId↑, date↓ | 241 | USED — `emailService.ts:28` (mobile order desc) |
| 31 | `notifications` | userId↑, read↑ | 249 | USED — unread counters `:69-106`, `mobileApi.ts:887` |
| 32 | `conversations` | participants↑, updatedAt↓ | 257 | **LEGACY** |
| 33 | `attendanceLogs` | companyId↑, timestamp↓ | 265 | USED — `attendanceLogService.ts:52` |
| 34 | `attendanceLogs` | userId↑, timestamp↓ | 273 | USED — `attendanceLogService.ts:66` |
| 35 | `attendanceLogs` | companyId↑, status↑, timestamp↓ | 281 | USED — `attendanceLogService.ts:82-85` |
| 36 | `payrollAudit` | companyId↑, timestamp↓ | 289 | USED — payroll audit list |
| 37 | `attendance` | checkOut↑, date↑ | 297 | USED — `scheduledFunctions.ts:40-42` (`checkOut == null`) |
| 38 | `leaveRequests` | companyId↑, status↑ | 305 | USED — `LeaveApprovalsPanel.tsx:113` |
| 39 | `leaveRequests` | userId↑, status↑, startDate↑, endDate↑ | 314 | USED — leave-balance overlap scans |
| 40 | `users` | email↑, code↑, used↑ | 325 | **MISLABELLED** — the query runs on **`resetCodes`** (`authService.ts:358`, `index.ts:1646`). A `users` index on `code`/`used` never serves it; the `resetCodes` query currently relies on a matching composite that is *not* declared for that collection → verify behaviour before porting |
| 41 | `leaveRequests` | approverIds.reportingManager↑, status↑ | 333 | USED — RM queue (`leaveService.ts:591` + status filter) |
| 42 | `leaveRequests` | companyId↑, approverIds.reportingManager↑ | 341 | USED — `leaveService.ts:591-592` |
| 43 | `leaveRequests` | userId↑, appliedOn↓ | 349 | USED — `LeaveScreen.tsx:163` |
| 44 | `attendanceQrCodes` | code, companyId, isActive | 357 | **LEGACY** — no `attendanceQrCodes` code |
| 45 | `attendanceQrCodes` | companyId↑, isActive↑ | 367 | **LEGACY** |

**Single-field (automatic) indexes cover** the remaining queries: `where('userId','==')`,
`where('status','==')`, `where('role','==')`, `where('slug','==')`, `where('token','==')`,
`where('companyId','in',…)`, `where('__name__','==')`, `where('masterAdminRequired','==')`,
`where('missedPunchRectification.requested','==')`, `where('missedPunchRectification.masterAdminRequired','==')`
(a field-index on that nested path is required — verify it exists in the target DB), etc.

---

## 6. Discrepancies & gaps to resolve in the AWS rewrite

| # | Finding | Evidence | Impact |
|---|---|---|---|
| 1 | **`resetCodes` has no rules match** → default-deny, yet the web client reads/writes it directly (`generateResetCode`, `verifyResetCode`, `invalidateResetCodes`) while the backend callable path (`sendResetCode`/`resetPasswordWithCode`) uses the Admin SDK | `firestore.rules:1336`, `authService.ts:340-383`, `index.ts:1584-1676` | Confirm which path is live in production (there is also a `firestore.rules.backup`); in AWS the reset flow must be API-only |
| 2 | **`leavePolicies` has no rules match** but is read by web (`leavePolicyService.ts:62`) and mobile (`leaveService.ts:306`) clients, and by backend (`payrollFunctions.ts:449`) | `firestore.rules` has no `leavePolicies` block | Client reads would be denied under the shipped ruleset — verify deployed rules, then design the API equivalently |
| 3 | **`performance` (mobile) vs `performanceReviews` (web)** are two different collections for the same feature | `PerformanceScreen.tsx:48` vs `Performance.tsx:39` | Merge or replicate both in AWS |
| 4 | **`supportTickets` (web read) vs `tickets` (everything else) vs `support_tickets` (public form)** — three collections | `Reports.tsx:112`, `index.ts:1497`, rules `:717/:1251` | Consolidate |
| 5 | **`transfers` rules contract ≠ mobile writer shape** — rules demand `sourceExecutiveId/Name, destExecutiveId/Name, transferredCompanies, transferredTeamLeaders, initiatorId/Name, status='completed'`; mobile writes `employeeId, fromCompanyId/Name, toCompanyId/Name, requestedBy/…` | `firestore.rules:1233-1241`, `TransferManagementScreen.tsx:44` | Direct `addDoc` under these rules fails `keys().hasAll(...)` → verify whether the deployed ruleset differs |
| 6 | **`conversations`/`messages`, `dashboardStats`, `jobPosts`, `attendanceQrCodes`, `leaves`** exist only in rules/indexes | §2.3 | Dead schema — safe to drop, but confirm no off-repo client uses them |
| 7 | **Legacy snake_case duplicates** `leave_requests`, `salary_slips` are still in rules and are purged by `deleteCompanyData` | `firestore.rules:606,624`, `index.ts:405-413` | Migration must handle/clean both spellings |
| 8 | **`in`-query chunking (≤10)** is required for multi-company portfolios | `scopedQueries.ts:62-75` | Any NoSQL replacement must keep a 10-value constraint equivalent or re-model |
| 9 | **No `collectionGroup` queries** | repo-wide grep = 0 | Subcollections can be re-modelled freely (e.g. as tables with `employeeId`) |
| 10 | **Denormalised read models**: `employeeName/department/avatar/email` are duplicated on `attendance`, `leaveRequests`, `salarySlips`, `payrollRuns.items[]`, `notifications` | §3 | Writes must keep these in sync or move to joins at read time |

### Migration verification checklist (collections)

1. Port every collection in §2.1 and §2.2 (plus subcollections §3.3).
2. Reproduce every query in §4 — including `orderBy` direction and `limit` values.
3. Decide which of the 45 composite indexes (§5) are still needed: **36 USED**, **9 LEGACY/MISLABELLED**.
4. Enforce tenancy (`companyId`) and ownership (`userId`) at the API layer exactly as §6.1–6.6 describe the Firebase rules gaps.
5. Re-implement the two dedupers: `email_logs` 60 s window and `missedPunchNotifications` doc-keyed dedupe.

---

