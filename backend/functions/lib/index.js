"use strict";
/**
 * HRMS Cloud Functions
 * Handles authentication, custom claims, and secure operations
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.mobileCancelLeaveRequest = exports.mobileReviewMasterAdminLeave = exports.mobileReviewLeaveTier = exports.mobileCreateLeaveRequest = exports.onLeaveRequestUpdated = exports.onLeaveRequestCreated = exports.missedPunchCutoffAlert = exports.monthlyPayrollReminder = exports.dailyAttendanceSweep = exports.retryFailedPayslipEmails = exports.regeneratePayslip = exports.dispatchPayslips = exports.submitPayrollForApproval = exports.previewBulkPayroll = exports.generateBulkPayroll = exports.calculatePayroll = exports.notifyAttendanceCascade = exports.sendPushNotification = exports.onNotificationCreated = exports.migrateLegacyMissedPunchApplicantRoles = exports.onMissedPunchAttendanceUpdated = exports.processCheckIn = exports.registerDevice = exports.markAttendance = exports.logAuditEvent = exports.onUserDeleted = exports.onUserCreated = exports.sendTempPasswordEmail = exports.resetPasswordWithCode = exports.sendResetCode = exports.sendSupportTicket = exports.corporateInquiry = exports.sendEmail = exports.syncUserClaims = exports.createStaffUser = exports.acceptInvitation = exports.inviteUser = exports.permanentlyDeleteUsers = exports.deleteAllCompanyStaff = exports.deleteCompanyData = exports.createCompany = exports.setCustomClaims = exports.listBroadcastJobs = exports.companyAdminBroadcast = exports.retryEmailLog = exports.listEmailLogs = exports.sendEmailSystemTest = exports.testEmailSystemConnection = exports.saveEmailSystemConfig = exports.getEmailSystemConfig = void 0;
exports.mobileDeleteEmail = exports.mobileUpdateEmail = exports.mobileSaveEmail = exports.mobileUpdateAuthProfile = exports.mobileUpdateLastLogin = exports.mobileDeleteAnnouncement = exports.mobileMarkAllAdminAlertsRead = exports.mobileMarkAdminAlertRead = exports.mobileCreateAdminAlert = exports.mobileDeleteNotification = exports.mobileCreateNotification = exports.mobileDeleteTicket = exports.mobileAddTicketMessage = exports.mobileUpdateTicketStatus = exports.mobileDeleteCompanyAdmin = exports.mobileReactivateCompanyAdmin = exports.mobileSuspendCompanyAdmin = exports.mobileRejectCompanyAdmin = exports.mobileApproveCompanyAdmin = exports.mobileSaveAttendancePolicy = exports.mobileDeleteDepartment = exports.mobileUpdateDepartment = exports.mobileCreateDepartment = exports.mobileOnboardCompany = exports.mobileDeleteCompany = exports.mobileUpdateCompany = exports.mobileCreateCompany = exports.mobileDeletePayrollRun = exports.mobileDeleteSalarySlip = exports.mobileMarkSalarySlipPaid = exports.mobileDeleteSalaryStructure = exports.mobileUpdateSalaryStructure = exports.mobileCreateSalaryStructure = exports.mobileUpdateEmployee = exports.mobileCreateEmployee = exports.mobileMarkAllNotificationsRead = exports.mobileMarkNotificationRead = exports.mobileCreateAnnouncement = exports.mobileUpdateTicket = exports.mobileCreateTicket = exports.mobileUpdateTask = exports.mobileCreateTask = exports.mobileDisbursePayroll = exports.mobileUpdatePayrollRun = exports.mobileSavePayrollRun = exports.mobileUpdateAttendance = exports.mobileUpdateUserProfile = exports.mobileReviewMasterAdminMissedPunch = exports.mobileReviewMissedPunchTier = exports.mobileRequestPunchRectification = void 0;
exports.requestAccountDeletion = exports.mobileMarkEmailRead = exports.mobileToggleStarEmail = exports.mobileArchiveEmail = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
// CENTRAL EMAIL SERVICE — every email in the app goes through this module
const emailService_1 = require("./emailService");
var emailService_2 = require("./emailService");
Object.defineProperty(exports, "getEmailSystemConfig", { enumerable: true, get: function () { return emailService_2.getEmailSystemConfig; } });
Object.defineProperty(exports, "saveEmailSystemConfig", { enumerable: true, get: function () { return emailService_2.saveEmailSystemConfig; } });
Object.defineProperty(exports, "testEmailSystemConnection", { enumerable: true, get: function () { return emailService_2.testEmailSystemConnection; } });
Object.defineProperty(exports, "sendEmailSystemTest", { enumerable: true, get: function () { return emailService_2.sendEmailSystemTest; } });
Object.defineProperty(exports, "listEmailLogs", { enumerable: true, get: function () { return emailService_2.listEmailLogs; } });
Object.defineProperty(exports, "retryEmailLog", { enumerable: true, get: function () { return emailService_2.retryEmailLog; } });
// COMPANY ADMIN NOTIFICATION & EMAIL BROADCAST
var broadcastFunctions_1 = require("./broadcastFunctions");
Object.defineProperty(exports, "companyAdminBroadcast", { enumerable: true, get: function () { return broadcastFunctions_1.companyAdminBroadcast; } });
Object.defineProperty(exports, "listBroadcastJobs", { enumerable: true, get: function () { return broadcastFunctions_1.listBroadcastJobs; } });
// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
// ============================================
// HELPER FUNCTIONS
// ============================================
const getFullPermissions = (role) => {
    // Single source of truth for backend role defaults, aligned to the approved
    // hierarchy. master-admin is the sole supreme role (all access); the
    // operational roles beneath it each receive their scoped default set.
    const permissions = {
        'master-admin': {
            employee_view: true, employee_create: true, employee_edit: true, employee_delete: true,
            department_view: true, department_create: true, department_edit: true, department_delete: true,
            payroll_view: true, payroll_edit: true, payroll_process: true,
            attendance_view: true, attendance_edit: true, attendance_approve: true,
            leave_view: true, leave_approve: true, leave_cancel: true,
            reports_view: true, reports_create: true,
            settings_view: true, settings_edit: true,
            user_invite: true, user_manage: true, role_assign: true,
            company_view: true, company_edit: true,
        },
        'company-admin': {
            employee_view: true, employee_create: true, employee_edit: true, employee_delete: true,
            department_view: true, department_create: true, department_edit: true, department_delete: true,
            payroll_view: true, payroll_edit: true, payroll_process: true,
            attendance_view: true, attendance_edit: true, attendance_approve: true,
            leave_view: true, leave_approve: true, leave_cancel: true,
            reports_view: true, reports_create: true,
            settings_view: true, settings_edit: true,
            user_invite: true, user_manage: true, role_assign: true,
            company_view: true, company_edit: true,
        },
        'team-leader': {
            employee_view: true, employee_create: true, employee_edit: true, employee_delete: true,
            department_view: true, department_create: true, department_edit: true, department_delete: true,
            payroll_view: true, payroll_edit: true, payroll_process: true,
            attendance_view: true, attendance_edit: true, attendance_approve: true,
            leave_view: true, leave_approve: true, leave_cancel: true,
            reports_view: true, reports_create: true,
            settings_view: true, settings_edit: true,
            user_invite: true, user_manage: true, role_assign: true,
            company_view: true, company_edit: true,
        },
        'executive': {
            employee_view: true, employee_create: true, employee_edit: true, employee_delete: true,
            department_view: true, department_create: true, department_edit: true, department_delete: true,
            payroll_view: true, payroll_edit: true, payroll_process: true,
            attendance_view: true, attendance_edit: true, attendance_approve: true,
            leave_view: true, leave_approve: true, leave_cancel: true,
            reports_view: true, reports_create: true,
            settings_view: true, settings_edit: true,
            user_invite: true, user_manage: true, role_assign: true,
            company_view: true, company_edit: true,
        },
        'reporting-manager': {
            employee_view: true, employee_create: false, employee_edit: false, employee_delete: false,
            department_view: true, department_create: false, department_edit: false, department_delete: false,
            payroll_view: false, payroll_edit: false, payroll_process: false,
            attendance_view: true, attendance_edit: true, attendance_approve: true,
            leave_view: true, leave_approve: true, leave_cancel: false,
            reports_view: true, reports_create: false,
            settings_view: false, settings_edit: false,
            user_invite: false, user_manage: false, role_assign: false,
            company_view: true, company_edit: false,
        },
        'employee': {
            employee_view: false, employee_create: false, employee_edit: false, employee_delete: false,
            department_view: true, department_create: false, department_edit: false, department_delete: false,
            payroll_view: true, payroll_edit: false, payroll_process: false,
            attendance_view: true, attendance_edit: false, attendance_approve: false,
            leave_view: true, leave_approve: false, leave_cancel: false,
            reports_view: false, reports_create: false,
            settings_view: true, settings_edit: false,
            user_invite: false, user_manage: false, role_assign: false,
            company_view: true, company_edit: false,
        },
    };
    return permissions[role] || permissions.employee;
};
// Legacy getFullPermissions() keys are snake_case singular (employee_view); the
// Firestore rules and the permission matrix check dot-notation plural modules
// (employees.view). Normalize so hasPermission() resolves for these accounts.
const legacyToDotPerms = {
    employee_view: 'employees.view', employee_create: 'employees.create',
    employee_edit: 'employees.edit', employee_delete: 'employees.delete',
    department_view: 'departments.view', department_create: 'departments.create',
    department_edit: 'departments.edit', department_delete: 'departments.delete',
    payroll_view: 'payroll.view', payroll_edit: 'payroll.edit', payroll_process: 'payroll.approve',
    attendance_view: 'attendance.view', attendance_edit: 'attendance.edit', attendance_approve: 'attendance.approve',
    leave_view: 'leave.view', leave_approve: 'leave.approve', leave_cancel: 'leave.cancel',
    reports_view: 'reports.view', reports_create: 'reports.create',
    settings_view: 'settings.view', settings_edit: 'settings.edit',
    user_invite: 'employees.create',
    company_view: 'companies.view', company_edit: 'companies.edit',
};
const normalizeLegacyPermissions = (perms) => {
    const out = [];
    for (const [k, v] of Object.entries(perms)) {
        if (!v)
            continue;
        const dot = legacyToDotPerms[k];
        if (dot && !out.includes(dot))
            out.push(dot);
    }
    return out;
};
// ============================================
// SET CUSTOM CLAIMS
// ============================================
const VALID_ROLES = [
    'master-admin',
    'company-admin',
    'team-leader',
    'executive',
    'reporting-manager',
    'employee',
];
// Full dot-notation permission catalog (53 permissions) matching the
// Executives/TeamLeaders permission matrix on the web dashboard.
const FULL_PERMISSION_CATALOG = [
    // Employees (6)
    'employees.view', 'employees.create', 'employees.edit', 'employees.delete', 'employees.approve', 'employees.manage',
    // Attendance (7)
    'attendance.view', 'attendance.create', 'attendance.edit', 'attendance.delete', 'attendance.approve', 'attendance.reject', 'attendance.manage',
    // Leave (8)
    'leave.view', 'leave.create', 'leave.edit', 'leave.delete', 'leave.approve', 'leave.reject', 'leave.cancel', 'leave.manage',
    // Payroll (8)
    'payroll.view', 'payroll.create', 'payroll.edit', 'payroll.delete', 'payroll.approve', 'payroll.calculate', 'payroll.disburse', 'payroll.manage',
    // Salary (7)
    'salary.view', 'salary.create', 'salary.edit', 'salary.delete', 'salary.approve', 'salary.export', 'salary.manage',
    // Tasks (6)
    'tasks.view', 'tasks.create', 'tasks.edit', 'tasks.delete', 'tasks.approve', 'tasks.manage',
    // Support (6)
    'support.view', 'support.create', 'support.edit', 'support.delete', 'support.approve', 'support.manage',
    // Holidays (7)
    'holidays.view', 'holidays.create', 'holidays.edit', 'holidays.delete', 'holidays.approve', 'holidays.export', 'holidays.manage',
    // Announcements (6)
    'announcements.view', 'announcements.create', 'announcements.edit', 'announcements.delete', 'announcements.approve', 'announcements.manage',
    // Reports (7)
    'reports.view', 'reports.create', 'reports.edit', 'reports.delete', 'reports.export', 'reports.download', 'reports.manage',
    // Settings (6)
    'settings.view', 'settings.create', 'settings.edit', 'settings.delete', 'settings.approve', 'settings.manage',
    // Companies (6)
    'companies.view', 'companies.create', 'companies.edit', 'companies.delete', 'companies.approve', 'companies.manage',
    // Departments (6)
    'departments.view', 'departments.create', 'departments.edit', 'departments.delete', 'departments.approve', 'departments.manage',
    // Assets (6)
    'assets.view', 'assets.create', 'assets.edit', 'assets.delete', 'assets.approve', 'assets.manage',
];
exports.setCustomClaims = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { uid, role, companyId } = data;
    if (!uid || !role || !companyId) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
    }
    // Prevent self-escalation: a user can never modify their own claims.
    if (context.auth.uid === uid) {
        throw new functions.https.HttpsError('permission-denied', 'You cannot modify your own custom claims');
    }
    // Validate role against the whitelist.
    if (!VALID_ROLES.includes(role)) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid role');
    }
    try {
        // Only master-admins may assign claims. Verify against the authoritative
        // Firestore user document (custom claims alone can be stale).
        const callerDoc = await db.collection('users').doc(context.auth.uid).get();
        const callerData = callerDoc.data();
        const isMasterAdmin = callerData?.role === 'master-admin' ||
            context.auth.token?.role === 'master-admin';
        if (!isMasterAdmin) {
            throw new functions.https.HttpsError('permission-denied', 'Only master admins can set custom claims');
        }
        // Get permissions for role (app-role aware), normalized to the dot-notation
        // vocabulary the rules check.
        const permissions = normalizeLegacyPermissions(getFullPermissions(role));
        // Write the Firestore user document FIRST, then the claims — a token whose
        // role/companyId claims point at a missing users doc makes every rules
        // lookup for this uid deny ("Missing or insufficient permissions").
        await db.collection('users').doc(uid).update({
            role,
            companyId,
            permissions,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Set custom claims — only role + companyId (permissions exceed 1000-char limit)
        await auth.setCustomUserClaims(uid, {
            role: role,
            companyId,
        });
        return { success: true, message: 'Custom claims set successfully' };
    }
    catch (error) {
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        console.error('Error setting custom claims:', error);
        throw new functions.https.HttpsError('internal', 'Failed to set custom claims');
    }
});
// ============================================
// CREATE COMPANY AND ADMIN
// ============================================
exports.createCompany = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { companyName, slug, adminEmail, adminName } = data;
    if (!companyName || !slug || !adminEmail || !adminName) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
    }
    const uid = context.auth.uid;
    try {
        // Check if slug is unique
        const slugCheck = await db.collection('companies').where('slug', '==', slug).get();
        if (!slugCheck.empty) {
            throw new functions.https.HttpsError('already-exists', 'Company slug already exists');
        }
        // Create company document
        const companyRef = db.collection('companies').doc();
        const companyId = companyRef.id;
        await companyRef.set({
            id: companyId,
            name: companyName,
            slug,
            email: adminEmail,
            settings: {
                timezone: 'UTC',
                currency: 'INR',
                dateFormat: 'MM/DD/YYYY',
                workingHours: { start: '09:00', end: '17:00' },
                workingDays: [1, 2, 3, 4, 5], // Monday to Friday
            },
            active: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: uid,
            employeeCount: 1,
        });
        // NOTE: No default Leave Policy is seeded here anymore. Leave balances are
        // now per-employee only — set on the Employee Create form as monthly
        // entitlements (Yearly = Monthly × 12). No company-level defaults and no
        // automatic policy assignment are created at company creation.
        // Create admin user document FIRST so the custom claims below never point
        // at a missing users/{uid} doc (claims-before-doc is what breaks rules
        // lookups and produces "Missing or insufficient permissions" on login).
        const adminPerms = getFullPermissions('company-admin');
        // Normalize the legacy snake_case keys (employee_view / user_invite) to the
        // plural dot-notation vocabulary the Firestore rules and the permission
        // matrix actually check (employees.view ...). user_invite aliases to
        // employees.create in the rules, so it is emitted as that same key.
        const adminPermsArray = normalizeLegacyPermissions(adminPerms);
        await db.collection('users').doc(uid).set({
            uid,
            companyId,
            email: adminEmail,
            emailVerified: context.auth.token.email_verified || false,
            name: adminName,
            role: 'company-admin',
            permissions: adminPermsArray,
            employmentType: 'full_time',
            active: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Set admin custom claims (doc now exists — use a merge so any
        // concurrent doc write is preserved).
        await auth.setCustomUserClaims(uid, {
            role: 'company-admin',
            companyId,
        });
        return {
            success: true,
            message: 'Company created successfully',
            companyId,
        };
    }
    catch (error) {
        console.error('Error creating company:', error);
        throw new functions.https.HttpsError('internal', 'Failed to create company');
    }
});
// ============================================
// DELETE COMPANY + ALL ITS DATA
// ============================================
// Master-Admin only. Removes the company document, every company-scoped
// record (employees incl. subcollections, users, departments, attendance,
// leave, payroll, assets, holidays, tasks, announcements, adminAlerts,
// invitations, tickets, conversations, notifications) and the linked Auth
// accounts (except the caller and any master-admin). Used to clean up test /
// stale company data in one predictable pass.
exports.deleteCompanyData = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const callerUid = context.auth.uid;
    const companyId = String(data?.companyId || '').trim();
    if (!companyId) {
        throw new functions.https.HttpsError('invalid-argument', 'companyId is required');
    }
    const callerDoc = await db.collection('users').doc(callerUid).get();
    if (!callerDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Caller not found');
    }
    if (callerDoc.get('role') !== 'master-admin') {
        throw new functions.https.HttpsError('permission-denied', 'Only Master Admin can delete company data');
    }
    const companySnap = await db.collection('companies').doc(companyId).get();
    if (!companySnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Company not found');
    }
    const companyName = companySnap.get('name') || companyId;
    // 1. Capture the company-scoped user records BEFORE deleting anything so we
    //    can remove their Auth accounts too.
    const userQuery = await db.collection('users').where('companyId', '==', companyId)
        .limit(500).get();
    const usersToPurge = userQuery.docs
        .map((d) => ({ uid: d.id, role: d.get('role') || '' }))
        .filter((u) => u.uid !== callerUid && u.role !== 'master-admin');
    // 2. Bulk-delete every company-scoped collection (chunked batches of 200).
    const counts = {};
    const purgeScoped = async (col, field = 'companyId') => {
        let total = 0;
        for (;;) {
            const snap = await db.collection(col).where(field, '==', companyId).limit(200).get();
            if (snap.empty)
                break;
            const batch = db.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            total += snap.size;
        }
        if (total > 0)
            counts[col] = total;
    };
    for (const col of [
        'employees', 'users', 'departments', 'attendance',
        'leave_requests', 'leaveRequests', 'leavePolicies',
        'salary_slips', 'salarySlips', 'payrollRuns', 'payrollAudit', 'salaryStructures',
        'assets', 'holidays', 'tasks', 'announcements', 'adminAlerts',
        'invitations', 'tickets', 'conversations', 'notifications',
    ]) {
        try {
            await purgeScoped(col);
        }
        catch { /* collection absent or unmapped */ }
    }
    // 3. Recursively remove employee subcollections (bankAccounts, documents,
    //    contracts) via recursiveDelete on each employee document.
    const empSnap = await db.collection('employees').where('companyId', '==', companyId)
        .limit(500).get();
    await Promise.all(empSnap.docs.map((d) => db.recursiveDelete(d.ref).catch(() => { })));
    // 4. Delete the linked Auth accounts (non-master-admin, non-caller).
    let authDeleted = 0;
    for (const u of usersToPurge) {
        try {
            await auth.deleteUser(u.uid);
            authDeleted++;
        }
        catch { /* already gone */ }
    }
    // 5. Finally delete the company document itself.
    await db.recursiveDelete(db.collection('companies').doc(companyId));
    return {
        success: true,
        companyId,
        companyName,
        collections: counts,
        authAccountsDeleted: authDeleted,
        message: 'Company and all related data deleted',
    };
});
// ============================================
// DELETE ALL COMPANY STAFF (keep the company)
// ============================================
// Master-Admin only. Removes EVERY person associated with a company in one
// pass: all users (executives, team-leaders, reporting-managers, employees)
// + their Auth login accounts, and all employee records (incl. subcollections).
// The company document, departments, attendance, payroll, etc. are untouched.
// Master-admin accounts and the caller are never deleted (lockout safety).
exports.deleteAllCompanyStaff = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const callerUid = context.auth.uid;
    const companyId = String(data?.companyId || '').trim();
    if (!companyId) {
        throw new functions.https.HttpsError('invalid-argument', 'companyId is required');
    }
    const callerDoc = await db.collection('users').doc(callerUid).get();
    if (!callerDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Caller not found');
    }
    if (callerDoc.get('role') !== 'master-admin') {
        throw new functions.https.HttpsError('permission-denied', 'Only Master Admin can delete all company staff');
    }
    // 1. Capture the people records BEFORE deleting anything.
    let allUsers = [];
    let cursor = null;
    for (;;) {
        let q = db.collection('users').where('companyId', '==', companyId).limit(300);
        if (cursor)
            q = q.startAfter(cursor);
        const snap = await q.get();
        if (snap.empty)
            break;
        snap.docs.forEach((d) => {
            allUsers.push({
                uid: d.id,
                role: d.get('role') || '',
                name: d.get('name') || d.get('displayName') || '',
                email: d.get('email') || '',
            });
        });
        cursor = snap.docs[snap.docs.length - 1].id;
        if (snap.size < 300)
            break;
    }
    const toDelete = allUsers.filter((u) => u.uid !== callerUid && u.role !== 'master-admin');
    // 2. Delete ALL employee records for the company (recursive = subcollections).
    let employeesDeleted = 0;
    for (;;) {
        const empSnap = await db.collection('employees').where('companyId', '==', companyId).limit(300).get();
        if (empSnap.empty)
            break;
        await Promise.all(empSnap.docs.map((d) => db.recursiveDelete(d.ref).catch(() => { })));
        employeesDeleted += empSnap.size;
        if (empSnap.size < 300)
            break;
    }
    // 3. Hard-delete the non-MA user documents (chunked batches).
    let usersDeleted = 0;
    for (let i = 0; i < toDelete.length; i += 500) {
        const chunk = toDelete.slice(i, i + 500);
        for (let j = 0; j < chunk.length; j += 200) {
            const batch = db.batch();
            chunk.slice(j, j + 200).forEach((u) => batch.delete(db.collection('users').doc(u.uid)));
            await batch.commit();
        }
        usersDeleted += chunk.length;
    }
    // 4. Delete the linked Auth login accounts (never MA / caller).
    let authDeleted = 0;
    for (const u of toDelete) {
        try {
            await auth.deleteUser(u.uid);
            authDeleted++;
        }
        catch { /* already gone */ }
    }
    const skipped = allUsers.length - toDelete.length;
    return {
        success: true,
        companyId,
        usersDeleted,
        authAccountsDeleted: authDeleted,
        employeesDeleted,
        skipped,
        kept: skipped, // master-admins + caller whose Auth/docs are preserved
        message: `Deleted ${usersDeleted} user(s), ${employeesDeleted} employee record(s) and ${authDeleted} login(s)`,
    };
});
// ============================================
// PERMANENTLY DELETE SPECIFIC USERS
// ============================================
// Master-Admin only. Hard-deletes the given user records: linked employee
// docs (incl. subcollections), the users/{uid} doc and the Auth login account.
// The caller and any master-admin are never deleted (lockout safety).
exports.permanentlyDeleteUsers = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const callerUid = context.auth.uid;
    const uids = Array.isArray(data?.uids)
        ? data.uids.filter((u) => typeof u === 'string' && u.length > 0)
        : [];
    if (uids.length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'uids is required');
    }
    const callerDoc = await db.collection('users').doc(callerUid).get();
    if (!callerDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Caller not found');
    }
    if (callerDoc.get('role') !== 'master-admin') {
        throw new functions.https.HttpsError('permission-denied', 'Only Master Admin can delete users');
    }
    let processed = 0;
    let usersDocsDeleted = 0;
    let authAccountsDeleted = 0;
    let employeesDeleted = 0;
    const skipped = [];
    for (const uid of uids) {
        if (uid === callerUid) {
            skipped.push(uid);
            continue;
        }
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists && userDoc.get('role') === 'master-admin') {
            skipped.push(uid);
            continue;
        }
        const empQ = await db.collection('employees').where('userId', '==', uid).limit(500).get();
        for (const e of empQ.docs) {
            try {
                await db.recursiveDelete(e.ref);
                employeesDeleted++;
            }
            catch { /* skip */ }
        }
        try {
            await db.collection('users').doc(uid).delete();
            usersDocsDeleted++;
        }
        catch { /* already gone */ }
        try {
            await auth.deleteUser(uid);
            authAccountsDeleted++;
        }
        catch { /* already gone */ }
        processed++;
    }
    return {
        success: true,
        requested: uids.length,
        processed,
        usersDocsDeleted,
        authAccountsDeleted,
        employeesDeleted,
        skipped,
        message: `Deleted ${processed} user(s) permanently`,
    };
});
// ============================================
// INVITE USER
// ============================================
exports.inviteUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { email, name, role, departmentId } = data;
    const inviterUid = context.auth.uid;
    if (!email || !role) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
    }
    try {
        // Get inviter's company
        const inviterDoc = await db.collection('users').doc(inviterUid).get();
        if (!inviterDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Inviter not found');
        }
        const inviterData = inviterDoc.data();
        const companyId = inviterData?.companyId;
        if (!companyId) {
            throw new functions.https.HttpsError('failed-precondition', 'Inviter has no company');
        }
        // Check if inviter has permission to invite
        const inviterRole = inviterData?.role;
        const canInvite = ['master-admin', 'company-admin', 'team-leader', 'executive'].includes(inviterRole);
        if (!canInvite) {
            throw new functions.https.HttpsError('permission-denied', 'Not authorized to invite users');
        }
        // Check if email already exists
        const existingUser = await db.collection('users').where('email', '==', email).get();
        if (!existingUser.empty) {
            throw new functions.https.HttpsError('already-exists', 'User with this email already exists');
        }
        // Generate invite token
        const token = Buffer.from(`${email}:${Date.now()}:${Math.random()}`).toString('base64');
        // Create invitation document
        const inviteRef = db.collection('invitations').doc();
        await inviteRef.set({
            id: inviteRef.id,
            companyId,
            email,
            name: name || '',
            role,
            departmentId: departmentId || null,
            token,
            tokenExpiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days expiry
            ),
            status: 'pending',
            invitedBy: inviterUid,
            invitedByName: inviterData?.name || '',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Send the invite email through the CENTRAL EMAIL SERVICE.
        const appUrl = functions.config().app?.url || 'https://hrm-sofisx.web.app';
        const inviteLink = `${appUrl}/accept-invite?token=${token}`;
        let emailDelivered = false;
        let emailError = '';
        try {
            const companyDoc = await db.collection('companies').doc(companyId).get();
            const companyName = companyDoc.data()?.name || 'HRM';
            const inviterName = inviterData?.name || inviterData?.email || 'an administrator';
            const result = await (0, emailService_1.sendEmailCentral)({
                companyId,
                to: email,
                subject: `You're invited to join ${companyName} on HRM MAX`,
                type: 'invite',
                triggeredBy: inviterUid,
                html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#FF6600;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;">
              <h2 style="margin:0;">Invitation to join ${companyName}</h2>
            </div>
            <div style="padding:24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;">
              <p>Hello ${name || email},</p>
              <p><strong>${inviterName}</strong> has invited you to join <strong>${companyName}</strong> on HRM MAX as a <strong>${role}</strong>.</p>
              <p>Use the button below to accept the invitation and set up your account. This invitation expires in <strong>7 days</strong>.</p>
              <div style="text-align:center;margin-top:24px;">
                <a href="${inviteLink}" style="background:#FF6600;color:white;padding:12px 28px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Accept Invitation</a>
              </div>
              <p style="margin-top:24px;color:#6b7280;font-size:13px;">
                If the button does not work, copy and paste this link into your browser:<br/>
                <a href="${inviteLink}" style="color:#FF6600;word-break:break-all;">${inviteLink}</a>
              </p>
            </div>
          </div>
        `,
            });
            emailDelivered = result.delivered;
            if (!result.delivered)
                emailError = result.error || '';
        }
        catch (emailErr) {
            console.error('Failed to send invite email:', emailErr);
            emailError = emailErr?.message || 'Unknown error';
            // Non-fatal: fall through so the invitation record is preserved
        }
        // Log audit
        await db.collection('audit_logs').add({
            companyId,
            userId: inviterUid,
            userName: inviterData?.name || '',
            userRole: inviterRole,
            userEmail: inviterData?.email || '',
            action: 'USER_INVITE',
            entity: 'invitation',
            entityId: inviteRef.id,
            description: `Invited ${email} as ${role}`,
            ipAddress: context.rawRequest.ip || '',
            userAgent: context.rawRequest.headers['user-agent'] || '',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        return {
            success: true,
            message: emailDelivered ? 'Invitation sent successfully' : `Invitation created (email not delivered${emailError ? `: ${emailError}` : ' — no SMTP configured'})`,
            inviteId: inviteRef.id,
            inviteLink, // Remove in production, use email instead
            emailDelivered,
        };
    }
    catch (error) {
        console.error('Error inviting user:', error);
        throw new functions.https.HttpsError('internal', 'Failed to invite user');
    }
});
// ============================================
// ACCEPT INVITATION
// ============================================
exports.acceptInvitation = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { token, name, password } = data;
    const uid = context.auth.uid;
    const email = context.auth.token.email;
    if (!token || !name || !password) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
    }
    try {
        // Find invitation by token
        const inviteQuery = await db.collection('invitations')
            .where('token', '==', token)
            .where('status', '==', 'pending')
            .get();
        if (inviteQuery.empty) {
            throw new functions.https.HttpsError('not-found', 'Invalid or expired invitation');
        }
        const inviteDoc = inviteQuery.docs[0];
        const inviteData = inviteDoc.data();
        // Check if token is expired
        if (inviteData.tokenExpiresAt.toMillis() < Date.now()) {
            await inviteDoc.ref.update({ status: 'expired' });
            throw new functions.https.HttpsError('deadline-exceeded', 'Invitation has expired');
        }
        // Verify email matches
        if (inviteData.email !== email) {
            throw new functions.https.HttpsError('permission-denied', 'Email does not match invitation');
        }
        const companyId = inviteData.companyId;
        const role = inviteData.role;
        const permissions = normalizeLegacyPermissions(getFullPermissions(role));
        // Update user password
        await auth.updateUser(uid, { password });
        // Create user document FIRST, then set custom claims (a token carrying
        // role/companyId claims while the Firestore user doc is missing would make
        // every rules lookup for this uid deny — the "Missing or insufficient
        // permissions" ghost on first login).
        await db.collection('users').doc(uid).set({
            uid,
            companyId,
            email,
            emailVerified: context.auth.token.email_verified || false,
            name,
            role,
            permissions,
            departmentId: inviteData.departmentId || null,
            employmentType: 'full_time',
            invitedBy: inviteData.invitedBy,
            inviteAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
            active: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Set custom claims (doc exists now)
        await auth.setCustomUserClaims(uid, {
            role,
            companyId,
        });
        // Update invitation status
        await inviteDoc.ref.update({
            status: 'accepted',
            acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
            acceptedBy: uid,
        });
        // Update company employee count
        await db.collection('companies').doc(companyId).update({
            employeeCount: admin.firestore.FieldValue.increment(1),
        });
        // Log audit
        await db.collection('audit_logs').add({
            companyId,
            userId: uid,
            userName: name,
            userRole: role,
            userEmail: email,
            action: 'USER_ACCEPT_INVITE',
            entity: 'user',
            entityId: uid,
            description: 'Accepted invitation and created account',
            ipAddress: context.rawRequest.ip || '',
            userAgent: context.rawRequest.headers['user-agent'] || '',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        return {
            success: true,
            message: 'Invitation accepted successfully',
            companyId,
            role,
        };
    }
    catch (error) {
        console.error('Error accepting invitation:', error);
        throw new functions.https.HttpsError('internal', 'Failed to accept invitation');
    }
});
// ============================================
// CREATE STAFF USER (EXECUTIVE / TEAM LEADER)
// ============================================
// Creates a staff account (executive or team-leader) using the Admin SDK so the
// caller's session is never hijacked. Client-side `createUserWithEmailAndPassword`
// signs the CURRENT user out of their session, which breaks the Save flow:
// follow-up writes (team-leader / company updates, audit logs) run as the brand-new
// user and get denied by security rules. This callable avoids that entirely.
exports.createStaffUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const callerUid = context.auth.uid;
    const { email, password, name, phone, username, role, companyId, departmentId, departmentName, executiveTitle, assignedCompanyIds, assignedTeamLeaderIds, linkedExecutiveIds, designation, contingencyAccess, employmentType, status, joinDate, aadharNumber, panNumber, bankName, accountHolderName, accountNumber, ifscCode, pfAccountNumber, uanNumber, offerLetterDoc, address, emergencyContactName, emergencyContactPhone, monthlyGrossSalary, salaryEffectiveDate, permissions, permissionsConfigured, parentCompanyId, parentCompanyName, attendanceSettings, employeeProfile, } = data || {};
    if (!email || !password || !name || !role) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
    }
    if (typeof password !== 'string' || password.length < 6) {
        throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters');
    }
    if (role !== 'executive' && role !== 'team-leader' && role !== 'company-admin' && role !== 'employee' && role !== 'reporting-manager') {
        throw new functions.https.HttpsError('invalid-argument', 'Role must be executive, team-leader, company-admin, employee or reporting-manager');
    }
    // Tracks a Firebase Auth account created by THIS invocation so the catch
    // block can roll it back (best-effort) if the Firestore records fail to land
    // — prevents "ghost" logins with no Firestore user document.
    let createdFreshUid = null;
    try {
        // Caller must be master-admin or company-admin (verified against Firestore).
        const callerDoc = await db.collection('users').doc(callerUid).get();
        if (!callerDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Caller not found');
        }
        const callerData = callerDoc.data() || {};
        const isMasterAdmin = callerData.role === 'master-admin';
        const isCompanyAdmin = callerData.role === 'company-admin';
        const isExecOrTl = callerData.role === 'executive' || callerData.role === 'team-leader';
        const isReportingManager = callerData.role === 'reporting-manager';
        if (!isMasterAdmin && !isCompanyAdmin && !isExecOrTl && !isReportingManager) {
            throw new functions.https.HttpsError('permission-denied', 'Only master admins, company admins, executives, team leaders and reporting managers can create staff accounts');
        }
        // Company admins may only create staff inside their own company.
        // Executives/Team Leaders may only create staff inside their assigned companies,
        // OR inside a company document this same caller just onboarded (createdBy === caller)
        // so the company-creation flow can attach its first admin account.
        const effectiveCompanyId = companyId || callerData.companyId || null;
        let isOwnNewCompany = false;
        if (effectiveCompanyId && isExecOrTl && role === 'company-admin') {
            try {
                const companySnap = await db.collection('companies').doc(effectiveCompanyId).get();
                if (companySnap.exists && companySnap.data()?.createdBy === callerUid) {
                    isOwnNewCompany = true;
                }
            }
            catch { /* ignore lookup failures */ }
        }
        if (isCompanyAdmin && effectiveCompanyId !== callerData.companyId) {
            throw new functions.https.HttpsError('permission-denied', 'Company admins can only create staff in their own company');
        }
        // Reporting Managers may only create employee / reporting-manager accounts
        // inside their own company.
        if (isReportingManager) {
            if (!effectiveCompanyId || effectiveCompanyId !== callerData.companyId) {
                throw new functions.https.HttpsError('permission-denied', 'You can only create staff inside your own company');
            }
            if (role !== 'employee' && role !== 'reporting-manager') {
                throw new functions.https.HttpsError('permission-denied', 'Reporting managers can only create employee or reporting manager accounts');
            }
        }
        if (isExecOrTl && !isOwnNewCompany) {
            let scopedIds = Array.isArray(callerData.assignedCompanyIds)
                ? [...callerData.assignedCompanyIds]
                : (callerData.companyId ? [callerData.companyId] : []);
            // Team Leaders operate across their linked executives' portfolios.
            if (callerData.role === 'team-leader') {
                const linkedIds = Array.isArray(callerData.linkedExecutiveIds)
                    ? callerData.linkedExecutiveIds
                    : (callerData.reportingExecutiveId ? [callerData.reportingExecutiveId] : []);
                for (const eid of linkedIds) {
                    try {
                        const edoc = await db.collection('users').doc(eid).get();
                        const ecomps = edoc.data()?.assignedCompanyIds;
                        if (Array.isArray(ecomps))
                            scopedIds.push(...ecomps);
                    }
                    catch { /* skip missing executive */ }
                }
            }
            scopedIds = [...new Set(scopedIds)];
            if (!effectiveCompanyId || !scopedIds.includes(effectiveCompanyId)) {
                throw new functions.https.HttpsError('permission-denied', 'You can only create staff inside your assigned companies');
            }
        }
        if (role === 'company-admin') {
            if (!isMasterAdmin && !isOwnNewCompany) {
                throw new functions.https.HttpsError('permission-denied', 'Only master admins or the company creator can create company admin accounts');
            }
            if (!companyId) {
                throw new functions.https.HttpsError('invalid-argument', 'Company admins must be assigned to a company');
            }
        }
        // Resolve the parent company this staff member is tagged under. The parent
        // is (in priority order): an explicitly provided parentCompanyId, the
        // caller's own parentCompanyId, or the caller's own companyId.
        const effParentCompanyId = parentCompanyId || callerData.parentCompanyId || callerData.companyId || effectiveCompanyId || null;
        let effParentCompanyName = parentCompanyName || null;
        if (effParentCompanyId && !effParentCompanyName) {
            try {
                const pSnap = await db.collection('companies').doc(effParentCompanyId).get();
                if (pSnap.exists)
                    effParentCompanyName = pSnap.data()?.name || null;
            }
            catch { /* leave name null */ }
        }
        // Verify a mapped Reporting Manager BEFORE creating any Auth / Firestore
        // records so an invalid RM fails cleanly instead of leaving ghost accounts.
        // The tier-1 approver may be a dedicated Reporting Manager OR the company's
        // Company Admin (either is a valid direct manager in the approval chain).
        if (role === 'employee' && data.reportingManagerId) {
            const rmSnap = await db.collection('users').doc(String(data.reportingManagerId)).get();
            if (!rmSnap.exists) {
                throw new functions.https.HttpsError('invalid-argument', `Reporting manager (${data.reportingManagerId}) does not exist. Please select a valid reporting manager.`);
            }
            const rmData = rmSnap.data() || {};
            const isManager = rmData.role === 'reporting-manager' || rmData.isReportingManager === true || rmData.role === 'company-admin';
            if (!isManager) {
                throw new functions.https.HttpsError('invalid-argument', 'Selected manager is not a valid manager. Please choose a reporting manager or company admin.');
            }
        }
        // Reject duplicate email — but if user already exists in Auth, return their
        // ID so the caller can continue the save flow without a hard failure.
        let existingUser = null;
        try {
            existingUser = await auth.getUserByEmail(email);
        }
        catch {
            // auth/user-not-found is expected — continue with creation.
        }
        let uid;
        if (existingUser) {
            // User already exists in Firebase Auth — reuse them. Refresh the password
            // (and display name) so the temporary credentials shown to the admin
            // actually work at first login. Without this, a reused account keeps its
            // old password and the employee hits auth/invalid-credential.
            uid = existingUser.uid;
            try {
                await auth.updateUser(uid, {
                    password,
                    displayName: name,
                    phoneNumber: phone || undefined,
                });
            }
            catch { /* keep existing record on update failure */ }
        }
        else {
            // Create the Firebase Auth account (caller session untouched).
            const createdUser = await auth.createUser({
                email,
                password,
                displayName: name,
                phoneNumber: phone || undefined,
            });
            uid = createdUser.uid;
            createdFreshUid = uid;
        }
        // Build the user document (same shape as the web app).
        const avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=f97316&color=fff`;
        const baseFields = {
            id: uid,
            uid,
            name,
            email,
            username: username || '',
            password, // stored for temp-credential display (legacy behaviour)
            requirePasswordChange: true,
            role,
            companyId: effectiveCompanyId,
            departmentId: departmentId || null,
            department: departmentName || '',
            avatar,
            permissions: Array.isArray(permissions) && permissions.length > 0
                ? permissions
                : (role === 'executive' || role === 'team-leader')
                    ? FULL_PERMISSION_CATALOG
                    : (role === 'reporting-manager')
                        ? ['employees.view', 'attendance.view', 'leave.view', 'leave.apply', 'leave.create', 'leave.manage', 'reports.view']
                        : ['employees.view', 'attendance.view', 'leave.view', 'leave.apply', 'leave.create'],
            isActive: true,
            phone: phone || '',
            employmentType: employmentType || 'Full-time',
            status: status || 'Active',
            joinDate: joinDate || '',
            aadharNumber: aadharNumber || '',
            aadharDoc: '',
            panNumber: panNumber || '',
            panDoc: '',
            joiningLetterDoc: '',
            offerLetterDoc: offerLetterDoc || '',
            bankName: bankName || '',
            accountHolderName: accountHolderName || '',
            accountNumber: accountNumber || '',
            ifscCode: ifscCode || '',
            pfAccountNumber: pfAccountNumber || '',
            uanNumber: uanNumber || '',
            address: address || '',
            emergencyContactName: emergencyContactName || '',
            emergencyContactPhone: emergencyContactPhone || '',
            monthlyGrossSalary: Number(monthlyGrossSalary) || 0,
            salaryEffectiveDate: salaryEffectiveDate || '',
            parentCompanyId: effParentCompanyId,
            parentCompanyName: effParentCompanyName,
            attendanceSettings: attendanceSettings && typeof attendanceSettings === 'object'
                ? {
                    officeAddress: attendanceSettings.officeAddress || '',
                    latitude: Number(attendanceSettings.latitude) || 0,
                    longitude: Number(attendanceSettings.longitude) || 0,
                    radiusInMeters: Number(attendanceSettings.radiusInMeters) || 100,
                    allowMobileData: attendanceSettings.allowMobileData !== false,
                    requireWifi: !!attendanceSettings.requireWifi,
                    wifiSSID: attendanceSettings.wifiSSID || '',
                    requireSelfie: !!attendanceSettings.requireSelfie,
                }
                : null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (role === 'executive' || role === 'team-leader') {
            baseFields.permissionsConfigured = typeof permissionsConfigured === 'boolean' ? permissionsConfigured : true;
        }
        if (role === 'executive') {
            baseFields.executiveTitle = executiveTitle || '';
            baseFields.assignedCompanyIds = Array.isArray(assignedCompanyIds) ? assignedCompanyIds : [];
            baseFields.assignedTeamLeaderIds = Array.isArray(assignedTeamLeaderIds) ? assignedTeamLeaderIds : [];
        }
        else if (role === 'reporting-manager') {
            baseFields.designation = designation || '';
            baseFields.isReportingManager = true;
            baseFields.reportingManagerId = '';
            baseFields.reportingManagerName = '';
            baseFields.reportsToRole = 'company-admin';
        }
        else if (role === 'employee') {
            baseFields.designation = designation || '';
            baseFields.isReportingManager = false;
            baseFields.reportingManagerId = data.reportingManagerId || '';
            baseFields.reportingManagerName = data.reportingManagerName || '';
            baseFields.reportsToRole = data.reportsToRole || '';
        }
        else {
            baseFields.designation = designation || '';
            baseFields.contingencyAccess = !!contingencyAccess;
            baseFields.linkedExecutiveIds = Array.isArray(linkedExecutiveIds) ? linkedExecutiveIds : [];
            baseFields.reportingExecutiveId = Array.isArray(linkedExecutiveIds) && linkedExecutiveIds.length > 0 ? linkedExecutiveIds[0] : null;
        }
        // Employee / Reporting Manager profile fields used by the employees collection.
        if (role === 'employee' || role === 'reporting-manager') {
            if (data.employeeId)
                baseFields.employeeId = data.employeeId;
            if (employmentType)
                baseFields.employmentType = employmentType;
        }
        await db.collection('users').doc(uid).set(baseFields);
        // Set custom claims AFTER the users doc exists — a login that carries
        // role/companyId claims while the Firestore user doc is missing makes every
        // security-rules lookup for this uid return denies (the "Missing or
        // insufficient permissions" ghost). Claims carry only role + companyId (too
        // many permissions would exceed Firebase Auth's 1000-char claim limit);
        // permissions are read from the Firestore user document by the client.
        // A failure here must NOT abort the creation (the doc is authoritative).
        try {
            await auth.setCustomUserClaims(uid, {
                role: role,
                companyId: effectiveCompanyId || '',
            });
        }
        catch (claimErr) {
            console.error(`[createStaffUser] setCustomUserClaims failed for ${uid}:`, claimErr);
        }
        // For employees explicitly mapped to a Reporting Manager, backfill the
        // manager's `reportingEmployeeIds` index so the "My Team" view stays
        // authoritative and correctly populated the moment the employee is created.
        // (The RM's existence/validity was validated up front before any writes.)
        if (role === 'employee' && baseFields.reportingManagerId) {
            const rmId = String(baseFields.reportingManagerId);
            const rmDocRef = db.collection('users').doc(rmId);
            try {
                const rmSnap = await rmDocRef.get();
                if (rmSnap.exists) {
                    const rmData = rmSnap.data() || {};
                    const currentReports = Array.isArray(rmData.reportingEmployeeIds)
                        ? rmData.reportingEmployeeIds
                        : [];
                    if (!currentReports.includes(uid)) {
                        await rmDocRef.update({ reportingEmployeeIds: [...currentReports, uid] });
                    }
                }
            }
            catch { /* index backfill must never abort the creation */ }
        }
        // Link team leaders to the new executive. Dashboards/filters derive a team
        // leader's portfolio from their authoritative `linkedExecutiveIds` array, so
        // each assigned TL must get the new executive appended there too.
        if (role === 'executive' && Array.isArray(assignedTeamLeaderIds) && assignedTeamLeaderIds.length > 0) {
            await Promise.all(assignedTeamLeaderIds.map(async (tlId) => {
                const tlDoc = await db.collection('users').doc(tlId).get();
                const currentLinked = (tlDoc.data()?.linkedExecutiveIds) || [];
                const nextLinked = currentLinked.includes(uid) ? currentLinked : [...currentLinked, uid];
                await db.collection('users').doc(tlId).update({
                    reportingExecutiveId: uid,
                    reportingExecutiveName: name,
                    linkedExecutiveIds: nextLinked,
                });
            }));
        }
        // Link companies to the new executive.
        if (role === 'executive' && Array.isArray(assignedCompanyIds) && assignedCompanyIds.length > 0) {
            await Promise.all(assignedCompanyIds.map((cId) => db.collection('companies').doc(cId).update({
                assignedExecutiveId: uid,
                assignedExecutiveName: name,
            })));
        }
        // Link the new team leader to their executives.
        if (role === 'team-leader' && Array.isArray(linkedExecutiveIds) && linkedExecutiveIds.length > 0) {
            await Promise.all(linkedExecutiveIds.map(async (execId) => {
                const execDoc = await db.collection('users').doc(execId).get();
                const currentTLs = (execDoc.data()?.assignedTeamLeaderIds) || [];
                if (!currentTLs.includes(uid)) {
                    await db.collection('users').doc(execId).update({
                        assignedTeamLeaderIds: [...currentTLs, uid],
                    });
                }
            }));
        }
        // Server-authoritative employee-document creation (web + mobile). Writing
        // the employees doc here via the Admin SDK keeps the onboarding write path
        // independent of client security rules — the exact scope checks that gate
        // the account creation above (company-admin own-company, executive assigned
        // companies, reporting-manager own-company + employee/RM role only) already
        // gate this write, so it can never be rejected by Firestore rules.
        let empId;
        if ((role === 'employee' || role === 'reporting-manager') && employeeProfile && typeof employeeProfile === 'object') {
            const profile = employeeProfile;
            const rawJoin = profile.joinDate;
            let empJoinDate = null;
            if (rawJoin) {
                const parsed = new Date(rawJoin);
                if (!isNaN(parsed.getTime()))
                    empJoinDate = parsed;
            }
            const employeeDoc = {
                ...profile,
                joinDate: empJoinDate,
                userId: uid,
                employeeId: data.employeeId || profile.employeeId || '',
                username: username || '',
                password: password,
                name,
                email,
                phone: phone || '',
                role,
                isReportingManager: role === 'reporting-manager',
                reportingManagerId: data.reportingManagerId || profile.reportingManagerId || '',
                reportingManagerName: data.reportingManagerName || profile.reportingManagerName || '',
                reportsToRole: data.reportsToRole || profile.reportsToRole || '',
                companyId: effectiveCompanyId || profile.companyId || '',
                departmentId: departmentId || profile.departmentId || null,
                department: departmentName || profile.department || '',
                designation: designation || '',
                status: profile.status || status || 'Active',
                avatar: profile.avatar || avatar,
                slug: profile.slug || (name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'employee'),
                createdBy: callerUid,
                createdByName: callerData.name || '',
                createdByRole: callerData.role || '',
                parentCompanyId: effParentCompanyId,
                parentCompanyName: effParentCompanyName,
                isActive: profile.isActive !== false,
            };
            const strip = (obj) => {
                Object.keys(obj).forEach((k) => {
                    if (obj[k] === undefined || obj[k] === null)
                        delete obj[k];
                });
                return obj;
            };
            // Retry-safe: reuse an existing employees doc for this uid (a re-submitted
            // create reuses the Auth user) instead of writing a duplicate employee.
            const existingEmp = await db.collection('employees').where('userId', '==', uid).limit(1).get();
            let empRef;
            if (!existingEmp.empty) {
                empRef = existingEmp.docs[0].ref;
                await empRef.update(strip(employeeDoc));
                empId = existingEmp.docs[0].id;
            }
            else {
                empRef = await db.collection('employees').add(strip(employeeDoc));
                empId = empRef.id;
                await db.collection('employees').doc(empId).update({ id: empId });
            }
        }
        // Audit log — non-blocking (don't fail the whole function if this errors)
        const roleLabel = role === 'executive' ? 'Executive' : role === 'team-leader' ? 'Team Leader' : 'Company Admin';
        db.collection('audit_logs').add({
            userId: callerUid,
            userName: callerData.name || '',
            userRole: callerData.role || '',
            action: `${roleLabel} ${name} created`,
            actionType: 'create',
            module: role === 'executive' ? 'Executives' : role === 'team-leader' ? 'Team Leaders' : 'Companies',
            targetEntity: name,
            targetId: uid,
            companyId: effectiveCompanyId || undefined,
            details: `${roleLabel} account created with temporary credentials`,
            status: 'success',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        return {
            success: true,
            uid,
            empId: empId || null,
            username: username || '',
            password,
            message: 'Staff account created successfully',
        };
    }
    catch (error) {
        // Best-effort rollback: a freshly created Auth account that did not finish
        // its Firestore user/employee records is deleted so no ghost login exists
        // (an employee could otherwise "log in" but hit permission denials because
        // get(site data) from security rules finds no user document).
        if (createdFreshUid && !(error instanceof functions.https.HttpsError)) {
            try {
                await auth.deleteUser(createdFreshUid);
                await db.collection('users').doc(createdFreshUid).delete();
            }
            catch { /* rollback is best-effort */ }
        }
        if (error instanceof functions.https.HttpsError)
            throw error;
        if (error?.code === 'auth/email-already-exists') {
            throw new functions.https.HttpsError('already-exists', 'This email is already registered. Please use a different email.');
        }
        const reason = error?.message || error?.code || 'Unknown error';
        console.error(`[createStaffUser] FAILED for ${data?.email || '(no email)'}:`, error);
        throw new functions.https.HttpsError('internal', `Failed to create staff account: ${reason}`);
    }
});
// ============================================
// SYNC USER CLAIMS
// ============================================
exports.syncUserClaims = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    // Only master admins can sync claims (verify both claims and Firestore doc)
    const callerClaims = context.auth.token;
    if (callerClaims.role !== 'master-admin') {
        throw new functions.https.HttpsError('permission-denied', 'Only master admins can sync claims');
    }
    const callerDoc = await db.collection('users').doc(context.auth.uid).get();
    const callerData = callerDoc.data();
    if (callerData?.role !== 'master-admin') {
        throw new functions.https.HttpsError('permission-denied', 'Only master admins can sync claims');
    }
    const { uid } = data;
    if (!uid) {
        throw new functions.https.HttpsError('invalid-argument', 'User ID is required');
    }
    try {
        // Get user document
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }
        const userData = userDoc.data();
        const role = userData?.role;
        const companyId = userData?.companyId;
        if (!role || !companyId) {
            throw new functions.https.HttpsError('failed-precondition', 'User missing role or companyId');
        }
        // Get permissions and normalize to the dot-notation vocabulary the rules
        // check (legacy snake_case overrides would lock the user out of writes).
        const permissions = normalizeLegacyPermissions(getFullPermissions(role));
        // Update custom claims — permissions stay in Firestore only (1000-char Auth limit)
        await auth.setCustomUserClaims(uid, {
            role,
            companyId,
        });
        // Update user document
        await userDoc.ref.update({
            permissions,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { success: true, message: 'User claims synced successfully' };
    }
    catch (error) {
        console.error('Error syncing user claims:', error);
        throw new functions.https.HttpsError('internal', 'Failed to sync user claims');
    }
});
// ============================================
// SEND EMAIL (routed through central email service)
// ============================================
exports.sendEmail = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { to, subject, body, cc, bcc, companyId, emailId } = data;
    if (!to || !subject || !body) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields: to, subject, body');
    }
    // Route through the CENTRAL EMAIL SERVICE (config, dedup, logging, retries)
    const result = await (0, emailService_1.sendEmailCentral)({
        companyId,
        to,
        cc,
        bcc,
        subject,
        html: body,
        type: 'manual',
        triggeredBy: context.auth.uid,
        emailId,
    });
    if (!result.success) {
        throw new functions.https.HttpsError('internal', result.error || 'Failed to send email');
    }
    if (result.delivered) {
        await db.collection('audit_logs').add({
            companyId: companyId || '',
            userId: context.auth.uid,
            userName: context.auth.token.name || '',
            userRole: context.auth.token.role || '',
            userEmail: context.auth.token.email || '',
            action: 'EMAIL_SENT',
            entity: 'email',
            entityId: emailId || '',
            description: `Sent email "${subject}" to ${to}`,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => { });
    }
    return {
        success: true,
        delivered: result.delivered,
        messageId: result.messageId,
        logId: result.logId,
        note: result.skipped === 'no-config' ? 'Configure SMTP in Dashboard > Email System for actual delivery.' : undefined,
    };
});
// ============================================
// CORPORATE INQUIRY (Public - No Auth Required)
// ============================================
exports.corporateInquiry = functions.https.onCall(async (data) => {
    const { companyName, fullName, workEmail, phoneNumber, estimatedTeamSize } = data;
    if (!companyName || !fullName || !workEmail || !estimatedTeamSize) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
    }
    try {
        const timestamp = new Date().toISOString();
        const subject = `[CORPORATE INQUIRY] ${companyName} — ${fullName}`;
        const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#FF6600;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;">New Corporate Inquiry</h2>
        </div>
        <div style="padding:24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;">
          <p style="color:#374151;font-size:14px;margin:0 0 16px;">A new corporate inquiry has been submitted through the HR MAX website.</p>
          <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;width:40%;">Company Name</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${companyName}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Contact Person</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${fullName}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Email</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;"><a href="mailto:${workEmail}" style="color:#FF6600;text-decoration:none;">${workEmail}</a></td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Phone</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${phoneNumber || 'Not provided'}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Team Size</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${estimatedTeamSize} employees</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Submitted At</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${new Date(timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td></tr>
          </table>
          <p style="margin-top:20px;color:#6b7280;font-size:12px;">Source: Corporate Inquiry Form &bull; HR MAX Website</p>
        </div>
      </div>
    `;
        await db.collection('corporate_inquiries').add({
            companyName, fullName, workEmail, phoneNumber: phoneNumber || '', estimatedTeamSize,
            source: 'corporate-inquiry',
            recipientEmail: 'info@hrmax.in',
            subject, timestamp,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const result = await (0, emailService_1.sendEmailCentral)({
            to: 'info@hrmax.in',
            replyTo: workEmail,
            subject,
            html,
            type: 'inquiry',
            triggeredBy: 'public-contact-form',
            dedupKey: `inquiry-${workEmail}-${timestamp}`,
        });
        if (!result.delivered) {
            return { success: true, delivered: false, note: result.error || 'Inquiry saved. Configure SMTP in Dashboard > Email System for delivery.' };
        }
        return { success: true, delivered: true };
    }
    catch (error) {
        console.error('Error sending corporate inquiry:', error);
        throw new functions.https.HttpsError('internal', `Failed to send inquiry: ${error.message}`);
    }
});
// ============================================
// SUPPORT TICKET / CONTACT FORM (Public - No Auth Required)
// ============================================
exports.sendSupportTicket = functions.https.onCall(async (data, context) => {
    // Auth is optional: public Contact page calls this without a session,
    // while the authenticated Support page passes context.auth.
    const callerUid = context.auth?.uid || 'anonymous';
    const { subject, description, category, priority, userName, userEmail, phone, companyName } = data;
    if (!subject || !description || !category) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields: subject, description, category');
    }
    try {
        const timestamp = new Date().toISOString();
        const ticketId = data.ticketId || `contact-${Date.now()}`;
        const subjectLine = `[${category.toUpperCase()}] ${subject}`;
        const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#FF6600;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;">New Contact Form Submission</h2>
        </div>
        <div style="padding:24px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;">
          <p style="color:#374151;font-size:14px;margin:0 0 16px;">A new inquiry has been submitted through the HR MAX website contact form.</p>
          <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;width:35%;">Ticket ID</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${ticketId}</td></tr>
            ${companyName ? `<tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Company Name</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${companyName}</td></tr>` : ''}
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Name</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${userName || 'Not provided'}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Email</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;"><a href="mailto:${userEmail || ''}" style="color:#FF6600;text-decoration:none;">${userEmail || 'Not provided'}</a></td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Phone</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${phone || 'Not provided'}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Subject</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${subject}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Category</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${category}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Priority</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${priority || 'Medium'}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;vertical-align:top;">Message</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;white-space:pre-wrap;">${description}</td></tr>
            <tr><td style="padding:10px 12px;border:1px solid #e5e7eb;font-weight:600;background:#f9fafb;">Submitted At</td><td style="padding:10px 12px;border:1px solid #e5e7eb;color:#111827;">${new Date(timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td></tr>
          </table>
          <p style="margin-top:20px;color:#6b7280;font-size:12px;">Source: Contact Form &bull; HR MAX Website</p>
        </div>
      </div>
    `;
        const result = await (0, emailService_1.sendEmailCentral)({
            to: 'info@hrmax.in',
            replyTo: userEmail || undefined,
            subject: subjectLine,
            html,
            type: 'inquiry',
            triggeredBy: callerUid,
            dedupKey: `contact-${ticketId}`,
        });
        // Persist to Firestore so it appears in the ticket system
        try {
            await db.collection('support_tickets').doc(ticketId).set({
                ticketId,
                subject,
                description,
                category,
                priority: priority || 'Medium',
                userName: userName || '',
                userEmail: userEmail || '',
                phone: phone || '',
                companyName: companyName || '',
                source: 'contact-form',
                status: 'Open',
                emailDelivered: result.delivered,
                emailMessageId: result.messageId || null,
                emailError: result.delivered ? null : (result.error || 'No SMTP configured'),
                emailedAt: result.delivered ? admin.firestore.FieldValue.serverTimestamp() : null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
        }
        catch (firestoreErr) {
            console.error('Failed to persist contact form ticket:', firestoreErr);
        }
        if (result.delivered) {
            return { success: true, delivered: true, ticketId, messageId: result.messageId };
        }
        return { success: true, delivered: false, ticketId, note: result.error || 'No SMTP configured. Submission saved to Firestore.' };
    }
    catch (error) {
        console.error('Error processing contact form submission:', error);
        throw new functions.https.HttpsError('internal', `Failed to process submission: ${error.message}`);
    }
});
// ============================================
// SEND PASSWORD RESET CODE (Public - No Auth Required)
// ============================================
exports.sendResetCode = functions.https.onCall(async (data) => {
    const { email, code } = data;
    if (!email || !code) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields: email, code');
    }
    try {
        const userRecord = await auth.getUserByEmail(email).catch(() => null);
        if (!userRecord) {
            throw new functions.https.HttpsError('not-found', 'No account found with this email address.');
        }
        const result = await (0, emailService_1.sendEmailCentral)({
            to: email,
            subject: 'Your Password Reset Code',
            type: 'otp',
            triggeredBy: 'password-reset-flow',
            dedupKey: `reset-code-${email}-${code}`,
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1e293b;">Password Reset Code</h2>
          <p style="color: #475569; font-size: 14px;">You requested a password reset. Use the code below:</p>
          <div style="background: #f8fafc; padding: 24px; border-radius: 12px; text-align: center; margin: 20px 0; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #f97316;">
            ${code}
          </div>
          <p style="color: #94a3b8; font-size: 12px;">This code expires in 10 minutes. If you did not request this, please ignore this email.</p>
        </div>
      `,
        });
        if (!result.delivered) {
            console.error('Reset code NOT delivered for', email, ':', result.error);
            throw new functions.https.HttpsError('internal', result.error || 'Email service is not configured. Contact your administrator.');
        }
        return { success: true, delivered: true };
    }
    catch (error) {
        console.error('Error sending reset code:', error);
        if (error instanceof functions.https.HttpsError)
            throw error;
        throw new functions.https.HttpsError('internal', 'Failed to send reset code. Please try again later.');
    }
});
// ============================================
// RESET PASSWORD WITH CODE (Public - No Auth Required)
// ============================================
exports.resetPasswordWithCode = functions.https.onCall(async (data) => {
    const { email, code, newPassword } = data;
    if (!email || !code || !newPassword) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required fields: email, code, newPassword');
    }
    if (newPassword.length < 6) {
        throw new functions.https.HttpsError('invalid-argument', 'Password must be at least 6 characters');
    }
    try {
        // Find and verify the reset code document
        const codesSnap = await db
            .collection('resetCodes')
            .where('email', '==', email.toLowerCase())
            .where('code', '==', code)
            .where('used', '==', false)
            .get();
        if (codesSnap.empty) {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid or expired reset code.');
        }
        const codeDoc = codesSnap.docs[0];
        const codeData = codeDoc.data();
        const expiresAt = codeData.expiresAt?.toDate?.() || codeData.expiresAt;
        const now = new Date();
        if (expiresAt && now > expiresAt) {
            await codeDoc.ref.update({ used: true });
            throw new functions.https.HttpsError('invalid-argument', 'Reset code has expired. Please request a new one.');
        }
        // Update the Firebase Auth user's password
        const userRecord = await auth.getUserByEmail(email.toLowerCase());
        await auth.updateUser(userRecord.uid, { password: newPassword });
        // Invalidate the code
        await codeDoc.ref.update({
            used: true,
            usedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Remove requirePasswordChange flag if present
        await db.collection('users').doc(userRecord.uid).update({
            requirePasswordChange: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => { });
        return { success: true };
    }
    catch (error) {
        console.error('Error resetting password with code:', error);
        if (error instanceof functions.https.HttpsError)
            throw error;
        throw new functions.https.HttpsError('internal', 'Failed to reset password. Please try again.');
    }
});
// ============================================
// SEND TEMP PASSWORD EMAIL (Firestore trigger)
// ============================================
exports.sendTempPasswordEmail = functions.firestore
    .document('users/{userId}')
    .onCreate(async (snap, context) => {
    const data = snap.data();
    // Only send if there's a temp password stored
    const tempPassword = data.password;
    if (!tempPassword || typeof tempPassword !== 'string')
        return;
    const email = data.email;
    const name = data.name || 'User';
    if (!email) {
        console.warn('User document created without email — cannot send temp password');
        return;
    }
    try {
        const result = await (0, emailService_1.sendEmailCentral)({
            to: email,
            subject: 'Your Account Has Been Created',
            type: 'welcome',
            triggeredBy: 'user-creation-trigger',
            dedupKey: `welcome-${email}`,
            html: `
          <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
            <h2 style="color: #1e293b;">Welcome to HR MAX</h2>
            <p style="color: #475569; font-size: 14px;">Hello ${name},</p>
            <p style="color: #475569; font-size: 14px;">Your account has been created. Use the credentials below to sign in:</p>
            <div style="background: #f8fafc; padding: 20px; border-radius: 12px; margin: 20px 0;">
              <p style="margin: 8px 0; font-size: 14px; color: #1e293b;"><strong>Email:</strong> ${email}</p>
              <p style="margin: 8px 0; font-size: 14px; color: #1e293b;"><strong>Password:</strong> <span style="font-family: monospace; font-size: 16px; color: #f97316;">${tempPassword}</span></p>
            </div>
            <p style="color: #dc2626; font-size: 13px; font-weight: 600;">You will be required to change this password on your first login.</p>
            <p style="color: #94a3b8; font-size: 12px;">If you did not expect this email, please contact your system administrator.</p>
          </div>
        `,
        });
        if (!result.delivered) {
            console.warn('Temp password for', email, 'not delivered:', result.error || result.skipped);
        }
        // Remove the plaintext password from the Firestore document and set requirePasswordChange
        await snap.ref.update({
            password: admin.firestore.FieldValue.delete(),
            requirePasswordChange: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (error) {
        console.error('Error sending temp password email for', email, ':', error);
        // Don't throw — this is a background function; failure should not block user creation
    }
});
// ============================================
// ON USER CREATE TRIGGER
// ============================================
exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
    console.log('New user created:', user.uid);
});
// ============================================
// ON USER DELETE TRIGGER
// ============================================
exports.onUserDeleted = functions.auth.user().onDelete(async (user) => {
    console.log('User deleted:', user.uid);
    try {
        // Get user document
        const userDoc = await db.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            const companyId = userData?.companyId;
            // Soft delete - mark as inactive instead of removing
            await userDoc.ref.update({
                active: false,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            // Update company employee count
            if (companyId) {
                await db.collection('companies').doc(companyId).update({
                    employeeCount: admin.firestore.FieldValue.increment(-1),
                });
            }
        }
    }
    catch (error) {
        console.error('Error handling user deletion:', error);
    }
});
// ============================================
// AUDIT LOG FUNCTION
// ============================================
exports.logAuditEvent = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { action, entity, entityId, description, previousData, newData } = data;
    try {
        // Get user data
        const userDoc = await db.collection('users').doc(context.auth.uid).get();
        const userData = userDoc.data();
        await db.collection('audit_logs').add({
            companyId: userData?.companyId || '',
            userId: context.auth.uid,
            userName: userData?.name || '',
            userRole: userData?.role || '',
            userEmail: userData?.email || context.auth.token.email || '',
            action,
            entity,
            entityId,
            description,
            previousData,
            newData,
            ipAddress: context.rawRequest.ip || '',
            userAgent: context.rawRequest.headers['user-agent'] || '',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { success: true };
    }
    catch (error) {
        console.error('Error logging audit event:', error);
        throw new functions.https.HttpsError('internal', 'Failed to log audit event');
    }
});
// ============================================
// ATTENDANCE ENGINE FUNCTIONS
// ============================================
var attendanceFunctions_1 = require("./attendanceFunctions");
Object.defineProperty(exports, "markAttendance", { enumerable: true, get: function () { return attendanceFunctions_1.markAttendance; } });
Object.defineProperty(exports, "registerDevice", { enumerable: true, get: function () { return attendanceFunctions_1.registerDevice; } });
Object.defineProperty(exports, "processCheckIn", { enumerable: true, get: function () { return attendanceFunctions_1.processCheckIn; } });
// Sequential missed-punch verification (Company Admin → HR/Executive → Team
// Leader, Reporting Manager tier retired): server-side reconciliation of the
// per-tier flags / progress counter, stamping of authoritative approver ids,
// same-company fan-out, and application of the corrected checkout when all
// tiers approve.
var missedPunchFunctions_1 = require("./missedPunchFunctions");
Object.defineProperty(exports, "onMissedPunchAttendanceUpdated", { enumerable: true, get: function () { return missedPunchFunctions_1.onMissedPunchAttendanceUpdated; } });
Object.defineProperty(exports, "migrateLegacyMissedPunchApplicantRoles", { enumerable: true, get: function () { return missedPunchFunctions_1.migrateLegacyMissedPunchApplicantRoles; } });
// ============================================
// NOTIFICATION FUNCTIONS
// ============================================
var notificationFunctions_1 = require("./notificationFunctions");
Object.defineProperty(exports, "onNotificationCreated", { enumerable: true, get: function () { return notificationFunctions_1.onNotificationCreated; } });
Object.defineProperty(exports, "sendPushNotification", { enumerable: true, get: function () { return notificationFunctions_1.sendPushNotification; } });
// Real-time attendance cascade: company-scoped fan-out for missed punch /
// rectification / late check-in triggered by manual (non-scheduled) actions.
var attendanceCascade_1 = require("./attendanceCascade");
Object.defineProperty(exports, "notifyAttendanceCascade", { enumerable: true, get: function () { return attendanceCascade_1.notifyAttendanceCascade; } });
// ============================================
// PAYROLL FUNCTIONS
// ============================================
var payrollFunctions_1 = require("./payrollFunctions");
Object.defineProperty(exports, "calculatePayroll", { enumerable: true, get: function () { return payrollFunctions_1.calculatePayroll; } });
Object.defineProperty(exports, "generateBulkPayroll", { enumerable: true, get: function () { return payrollFunctions_1.generateBulkPayroll; } });
Object.defineProperty(exports, "previewBulkPayroll", { enumerable: true, get: function () { return payrollFunctions_1.previewBulkPayroll; } });
Object.defineProperty(exports, "submitPayrollForApproval", { enumerable: true, get: function () { return payrollFunctions_1.submitPayrollForApproval; } });
// ============================================
// PAYSLIP DISPATCH FUNCTIONS (server-side PDF + email)
// ============================================
var payslipDispatch_1 = require("./payslipDispatch");
Object.defineProperty(exports, "dispatchPayslips", { enumerable: true, get: function () { return payslipDispatch_1.dispatchPayslips; } });
Object.defineProperty(exports, "regeneratePayslip", { enumerable: true, get: function () { return payslipDispatch_1.regeneratePayslip; } });
Object.defineProperty(exports, "retryFailedPayslipEmails", { enumerable: true, get: function () { return payslipDispatch_1.retryFailedPayslipEmails; } });
// ============================================
// SCHEDULED FUNCTIONS
// ============================================
var scheduledFunctions_1 = require("./scheduledFunctions");
Object.defineProperty(exports, "dailyAttendanceSweep", { enumerable: true, get: function () { return scheduledFunctions_1.dailyAttendanceSweep; } });
Object.defineProperty(exports, "monthlyPayrollReminder", { enumerable: true, get: function () { return scheduledFunctions_1.monthlyPayrollReminder; } });
Object.defineProperty(exports, "missedPunchCutoffAlert", { enumerable: true, get: function () { return scheduledFunctions_1.missedPunchCutoffAlert; } });
// ============================================
// LEAVE NOTIFICATION FUNCTIONS
// ============================================
var leaveFunctions_1 = require("./leaveFunctions");
Object.defineProperty(exports, "onLeaveRequestCreated", { enumerable: true, get: function () { return leaveFunctions_1.onLeaveRequestCreated; } });
Object.defineProperty(exports, "onLeaveRequestUpdated", { enumerable: true, get: function () { return leaveFunctions_1.onLeaveRequestUpdated; } });
// ============================================
// MOBILE API (Callable functions for locked DB)
// ============================================
var mobileApi_1 = require("./mobileApi");
// Existing
Object.defineProperty(exports, "mobileCreateLeaveRequest", { enumerable: true, get: function () { return mobileApi_1.mobileCreateLeaveRequest; } });
Object.defineProperty(exports, "mobileReviewLeaveTier", { enumerable: true, get: function () { return mobileApi_1.mobileReviewLeaveTier; } });
Object.defineProperty(exports, "mobileReviewMasterAdminLeave", { enumerable: true, get: function () { return mobileApi_1.mobileReviewMasterAdminLeave; } });
Object.defineProperty(exports, "mobileCancelLeaveRequest", { enumerable: true, get: function () { return mobileApi_1.mobileCancelLeaveRequest; } });
Object.defineProperty(exports, "mobileRequestPunchRectification", { enumerable: true, get: function () { return mobileApi_1.mobileRequestPunchRectification; } });
Object.defineProperty(exports, "mobileReviewMissedPunchTier", { enumerable: true, get: function () { return mobileApi_1.mobileReviewMissedPunchTier; } });
Object.defineProperty(exports, "mobileReviewMasterAdminMissedPunch", { enumerable: true, get: function () { return mobileApi_1.mobileReviewMasterAdminMissedPunch; } });
Object.defineProperty(exports, "mobileUpdateUserProfile", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateUserProfile; } });
Object.defineProperty(exports, "mobileUpdateAttendance", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateAttendance; } });
Object.defineProperty(exports, "mobileSavePayrollRun", { enumerable: true, get: function () { return mobileApi_1.mobileSavePayrollRun; } });
Object.defineProperty(exports, "mobileUpdatePayrollRun", { enumerable: true, get: function () { return mobileApi_1.mobileUpdatePayrollRun; } });
Object.defineProperty(exports, "mobileDisbursePayroll", { enumerable: true, get: function () { return mobileApi_1.mobileDisbursePayroll; } });
Object.defineProperty(exports, "mobileCreateTask", { enumerable: true, get: function () { return mobileApi_1.mobileCreateTask; } });
Object.defineProperty(exports, "mobileUpdateTask", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateTask; } });
Object.defineProperty(exports, "mobileCreateTicket", { enumerable: true, get: function () { return mobileApi_1.mobileCreateTicket; } });
Object.defineProperty(exports, "mobileUpdateTicket", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateTicket; } });
Object.defineProperty(exports, "mobileCreateAnnouncement", { enumerable: true, get: function () { return mobileApi_1.mobileCreateAnnouncement; } });
Object.defineProperty(exports, "mobileMarkNotificationRead", { enumerable: true, get: function () { return mobileApi_1.mobileMarkNotificationRead; } });
Object.defineProperty(exports, "mobileMarkAllNotificationsRead", { enumerable: true, get: function () { return mobileApi_1.mobileMarkAllNotificationsRead; } });
// Employee
Object.defineProperty(exports, "mobileCreateEmployee", { enumerable: true, get: function () { return mobileApi_1.mobileCreateEmployee; } });
Object.defineProperty(exports, "mobileUpdateEmployee", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateEmployee; } });
// Salary Structure
Object.defineProperty(exports, "mobileCreateSalaryStructure", { enumerable: true, get: function () { return mobileApi_1.mobileCreateSalaryStructure; } });
Object.defineProperty(exports, "mobileUpdateSalaryStructure", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateSalaryStructure; } });
Object.defineProperty(exports, "mobileDeleteSalaryStructure", { enumerable: true, get: function () { return mobileApi_1.mobileDeleteSalaryStructure; } });
// Salary Slip
Object.defineProperty(exports, "mobileMarkSalarySlipPaid", { enumerable: true, get: function () { return mobileApi_1.mobileMarkSalarySlipPaid; } });
Object.defineProperty(exports, "mobileDeleteSalarySlip", { enumerable: true, get: function () { return mobileApi_1.mobileDeleteSalarySlip; } });
// Payroll Run
Object.defineProperty(exports, "mobileDeletePayrollRun", { enumerable: true, get: function () { return mobileApi_1.mobileDeletePayrollRun; } });
// Company
Object.defineProperty(exports, "mobileCreateCompany", { enumerable: true, get: function () { return mobileApi_1.mobileCreateCompany; } });
Object.defineProperty(exports, "mobileUpdateCompany", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateCompany; } });
Object.defineProperty(exports, "mobileDeleteCompany", { enumerable: true, get: function () { return mobileApi_1.mobileDeleteCompany; } });
Object.defineProperty(exports, "mobileOnboardCompany", { enumerable: true, get: function () { return mobileApi_1.mobileOnboardCompany; } });
// Department
Object.defineProperty(exports, "mobileCreateDepartment", { enumerable: true, get: function () { return mobileApi_1.mobileCreateDepartment; } });
Object.defineProperty(exports, "mobileUpdateDepartment", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateDepartment; } });
Object.defineProperty(exports, "mobileDeleteDepartment", { enumerable: true, get: function () { return mobileApi_1.mobileDeleteDepartment; } });
// Attendance Settings
Object.defineProperty(exports, "mobileSaveAttendancePolicy", { enumerable: true, get: function () { return mobileApi_1.mobileSaveAttendancePolicy; } });
// Company Admin Approval
Object.defineProperty(exports, "mobileApproveCompanyAdmin", { enumerable: true, get: function () { return mobileApi_1.mobileApproveCompanyAdmin; } });
Object.defineProperty(exports, "mobileRejectCompanyAdmin", { enumerable: true, get: function () { return mobileApi_1.mobileRejectCompanyAdmin; } });
Object.defineProperty(exports, "mobileSuspendCompanyAdmin", { enumerable: true, get: function () { return mobileApi_1.mobileSuspendCompanyAdmin; } });
Object.defineProperty(exports, "mobileReactivateCompanyAdmin", { enumerable: true, get: function () { return mobileApi_1.mobileReactivateCompanyAdmin; } });
Object.defineProperty(exports, "mobileDeleteCompanyAdmin", { enumerable: true, get: function () { return mobileApi_1.mobileDeleteCompanyAdmin; } });
// Support Ticket (extended)
Object.defineProperty(exports, "mobileUpdateTicketStatus", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateTicketStatus; } });
Object.defineProperty(exports, "mobileAddTicketMessage", { enumerable: true, get: function () { return mobileApi_1.mobileAddTicketMessage; } });
Object.defineProperty(exports, "mobileDeleteTicket", { enumerable: true, get: function () { return mobileApi_1.mobileDeleteTicket; } });
// Notification (extended)
Object.defineProperty(exports, "mobileCreateNotification", { enumerable: true, get: function () { return mobileApi_1.mobileCreateNotification; } });
Object.defineProperty(exports, "mobileDeleteNotification", { enumerable: true, get: function () { return mobileApi_1.mobileDeleteNotification; } });
Object.defineProperty(exports, "mobileCreateAdminAlert", { enumerable: true, get: function () { return mobileApi_1.mobileCreateAdminAlert; } });
Object.defineProperty(exports, "mobileMarkAdminAlertRead", { enumerable: true, get: function () { return mobileApi_1.mobileMarkAdminAlertRead; } });
Object.defineProperty(exports, "mobileMarkAllAdminAlertsRead", { enumerable: true, get: function () { return mobileApi_1.mobileMarkAllAdminAlertsRead; } });
// Announcement (extended)
Object.defineProperty(exports, "mobileDeleteAnnouncement", { enumerable: true, get: function () { return mobileApi_1.mobileDeleteAnnouncement; } });
// Auth
Object.defineProperty(exports, "mobileUpdateLastLogin", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateLastLogin; } });
Object.defineProperty(exports, "mobileUpdateAuthProfile", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateAuthProfile; } });
// Email
Object.defineProperty(exports, "mobileSaveEmail", { enumerable: true, get: function () { return mobileApi_1.mobileSaveEmail; } });
Object.defineProperty(exports, "mobileUpdateEmail", { enumerable: true, get: function () { return mobileApi_1.mobileUpdateEmail; } });
Object.defineProperty(exports, "mobileDeleteEmail", { enumerable: true, get: function () { return mobileApi_1.mobileDeleteEmail; } });
Object.defineProperty(exports, "mobileArchiveEmail", { enumerable: true, get: function () { return mobileApi_1.mobileArchiveEmail; } });
Object.defineProperty(exports, "mobileToggleStarEmail", { enumerable: true, get: function () { return mobileApi_1.mobileToggleStarEmail; } });
Object.defineProperty(exports, "mobileMarkEmailRead", { enumerable: true, get: function () { return mobileApi_1.mobileMarkEmailRead; } });
// Account Deletion
Object.defineProperty(exports, "requestAccountDeletion", { enumerable: true, get: function () { return mobileApi_1.requestAccountDeletion; } });
//# sourceMappingURL=index.js.map