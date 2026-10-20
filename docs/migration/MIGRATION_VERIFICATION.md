# Data Migration Verification Report

- Ran: 2026-10-20T09:25:52.923Z
- Table: `HRMAX` (ap-southeast-2) — total items: **1479**
- Source: Firebase project `hrm-sofisx` — 1462 docs exported 2026-10-20T08:50:37.819Z
- Firebase uid references remapped to Cognito subs: **1362**
- Overall: **ALL CHECKS PASSED**

| Check | Result | Detail |
|---|---|---|
| entity-counts | ✅ | 19 collections: exact match, 1479 total items |
| no-firebase-uids | ✅ | deep-scanned 1479 items — 0 Firebase uid references remain |
| profiles | ✅ | 14/14 PROFILE rows keyed by Cognito sub |
| user-topology | ✅ | 31 items = 29 migrated + 2 pre-existing orphan test-account item(s): USER#297ec468-f0e1-7051-c73c-d1004d00aadd/PROFILE, COMPANY#global/user#297ec468-f0e1-7051-c73c-d1004d00aadd |
| read-companies-gsi3 | ✅ | GSI3 global list → 2 companies |
| read-attendance-gsi1 | ✅ | GSI1 user query → 26 attendance items for migrated user |
| read-partition | ✅ | company partition queries → 222 attendance items (all real-company docs) |
| read-salaryslip-gsi1 | ✅ | employee sees 12 payslip(s) via GSI1 (1 source slips reference employee ids, preserved as-is) |
| cognito-users | ✅ | 14/14 mapped emails present in pool ap-southeast-2_DUe0sfFOx (pool total 15) |
| spot-user | ✅ | somnathnmdv@gmail.com: email/role preserved, id=39cec478-f0c1-7094-dc47-74f77e953751 |
| spot-leave | ✅ | leaveRequest 9cDSEgvLA2pkVPsnHmN9: userId remapped to Cognito sub |

## Per-entity counts

| Entity | Items | Source collection | Source docs |
|---|---|---|---|
| company | 2 | companies | 2 |
| employee | 9 | employees | 9 |
| department | 6 | departments | 6 |
| attendance | 230 | attendance | 230 |
| attendanceLog | 33 | attendanceLogs | 33 |
| attendanceSettings | 2 | attendanceSettings | 2 |
| leaveRequest | 21 | leaveRequests | 21 |
| holiday | 2 | holidays | 2 |
| notification | 580 | notifications | 580 |
| adminAlert | 116 | adminAlerts | 116 |
| auditLog | 178 | audit_logs | 178 |
| corporateInquiry | 3 | corporate_inquiries | 3 |
| emailLog | 90 | email_logs | 90 |
| email | 31 | emails | 31 |
| missedPunchNotification | 73 | missedPunchNotifications | 73 |
| payrollRun | 14 | payrollRuns | 14 |
| payrollAudit | 16 | payrollAudit | 16 |
| salarySlip | 39 | salarySlips | 39 |
| salaryStructure | 3 | salaryStructures | 3 |
| user (PROFILE + copies) | 31 | users | 14 |

## Notes

- Notifications/adminAlerts/emails/corporateInquiries were normalized to the `global` partition (the partition every reader/patcher in the app uses for these entities).
- Emails: `userId` derived from `toEmail` where a unique user match exists; unmatched outbox docs preserved without `userId`.
- Passwords are not migratable — all 14 users must change password on first sign-in (temp credentials delivered via secure handoff file).
- Any Cognito pool members beyond the 14 mapped users are pre-existing test accounts, left untouched.
- 2 pre-existing DynamoDB items from the earlier manual test account (`USER#297ec468-f0e1-7051-c73c-d1004d00aadd`) were left untouched — candidate for cleanup with owner approval.
- One salary slip references an employee doc id instead of a user uid (source-data quirk) — preserved verbatim rather than guessed at.
