"use strict";
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
exports.processCheckIn = exports.registerDevice = exports.markAttendance = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const attendanceEngine_1 = require("./attendanceEngine");
const db = admin.firestore();
exports.markAttendance = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
    }
    try {
        const { action, companyId, latitude, longitude, wifiSsid, networkType, isVpn, isMockLocation, isEmulator, deviceId, deviceModel, batteryLevel, selfieUri, attendanceId } = data;
        const userId = context.auth.uid;
        const timestamp = admin.firestore.Timestamp.now();
        const now = timestamp.toDate();
        // Validate required fields
        if (!action || !['check-in', 'check-out'].includes(action)) {
            throw new functions.https.HttpsError('invalid-argument', 'Valid action (check-in or check-out) is required');
        }
        if (!companyId) {
            throw new functions.https.HttpsError('invalid-argument', 'companyId is required');
        }
        // Fetch attendance policy for this company
        const policySnap = await db.collection('attendanceSettings')
            .where('companyId', '==', companyId)
            .limit(1)
            .get();
        // Fall back to a permissive default policy when the company has not
        // configured explicit attendance settings, so check-in still works.
        let policy = policySnap.empty ? null : policySnap.docs[0].data();
        if (!policy) {
            policy = {
                mode: 'standard',
                officeLocation: null,
                allowedWifis: [],
                wifiOnly: false,
                mobileDataAllowed: true,
                requireSelfie: false,
                enableGeofence: false,
                enableNetworkGuard: false,
                enableAntiSpoofing: false,
                enableSelfie: false,
                selfieExpirySeconds: 300,
                gracePeriodMinutes: 15,
                defaultShiftStart: '09:00',
                defaultShiftEnd: '18:00',
            };
        }
        // Common validation: user belongs to company
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }
        const userData = userDoc.data();
        const assignedCompanies = Array.isArray(userData.assignedCompanyIds) ? userData.assignedCompanyIds : [];
        const belongsToCompany = userData.companyId === companyId || assignedCompanies.includes(String(companyId));
        if (!belongsToCompany) {
            throw new functions.https.HttpsError('permission-denied', 'You do not belong to this company');
        }
        // Build log entry base
        const logBase = {
            userId,
            companyId,
            deviceId: deviceId || null,
            deviceModel: deviceModel || null,
            batteryLevel: batteryLevel ?? null,
            networkType: networkType || null,
            wifiSsid: wifiSsid || null,
            isVpn: isVpn ?? null,
            isMockLocation: isMockLocation ?? null,
            isEmulator: isEmulator ?? null,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            ipAddress: context.rawRequest.ip || null,
            timestamp,
        };
        if (action === 'check-in') {
            // 1. Check for duplicate check-in
            const doubleCheck = await (0, attendanceEngine_1.validateCheckInDouble)(userId);
            if (!doubleCheck.valid) {
                await db.collection('attendanceLogs').add({
                    ...logBase,
                    attendanceId: null,
                    action: 'check-in',
                    status: 'failure',
                    reasonCode: doubleCheck.reasonCode,
                    reasonMessage: doubleCheck.reasonMessage,
                });
                throw new functions.https.HttpsError('already-exists', doubleCheck.reasonMessage);
            }
            // 2. Validate geolocation
            if (latitude && longitude) {
                const geoValidation = await (0, attendanceEngine_1.validateGeolocation)(latitude, longitude, policy);
                if (!geoValidation.valid) {
                    await db.collection('attendanceLogs').add({
                        ...logBase,
                        attendanceId: null,
                        action: 'check-in',
                        status: 'failure',
                        reasonCode: geoValidation.reasonCode,
                        reasonMessage: geoValidation.reasonMessage,
                    });
                    throw new functions.https.HttpsError('failed-precondition', geoValidation.reasonMessage);
                }
            }
            else if (policy.enableGeofence) {
                await db.collection('attendanceLogs').add({
                    ...logBase,
                    attendanceId: null,
                    action: 'check-in',
                    status: 'failure',
                    reasonCode: 'GPS_REQUIRED',
                    reasonMessage: 'GPS location is required for check-in',
                });
                throw new functions.https.HttpsError('failed-precondition', 'GPS location is required for check-in');
            }
            // 3. Validate network
            const netValidation = await (0, attendanceEngine_1.validateNetwork)(networkType, wifiSsid, isVpn, policy);
            if (!netValidation.valid) {
                await db.collection('attendanceLogs').add({
                    ...logBase,
                    attendanceId: null,
                    action: 'check-in',
                    status: 'failure',
                    reasonCode: netValidation.reasonCode,
                    reasonMessage: netValidation.reasonMessage,
                });
                throw new functions.https.HttpsError('failed-precondition', netValidation.reasonMessage);
            }
            // 4. Validate anti-spoofing
            const spoofValidation = await (0, attendanceEngine_1.validateAntiSpoofing)(isMockLocation, isEmulator, deviceId, userId, policy);
            if (!spoofValidation.valid) {
                await db.collection('attendanceLogs').add({
                    ...logBase,
                    attendanceId: null,
                    action: 'check-in',
                    status: 'failure',
                    reasonCode: spoofValidation.reasonCode,
                    reasonMessage: spoofValidation.reasonMessage,
                });
                throw new functions.https.HttpsError('failed-precondition', spoofValidation.reasonMessage);
            }
            // 5. Validate selfie if required
            const selfieValidation = await (0, attendanceEngine_1.validateSelfie)(userId, companyId, policy, selfieUri);
            if (!selfieValidation.valid) {
                await db.collection('attendanceLogs').add({
                    ...logBase,
                    attendanceId: null,
                    action: 'check-in',
                    status: 'failure',
                    reasonCode: selfieValidation.reasonCode,
                    reasonMessage: selfieValidation.reasonMessage,
                });
                throw new functions.https.HttpsError('failed-precondition', selfieValidation.reasonMessage);
            }
            // 6. Determine attendance status
            const { status, lateMinutes } = await (0, attendanceEngine_1.determineAttendanceStatus)(now, policy);
            // 7. Fetch employee data for shift info
            let shiftStart = policy.defaultShiftStart || '09:00';
            let shiftEnd = policy.defaultShiftEnd || '18:00';
            let shiftType = 'Morning';
            let department = '';
            let departmentColor = '';
            let employeeId = '';
            const empSnap = await db.collection('employees')
                .where('userId', '==', userId)
                .limit(1)
                .get();
            if (!empSnap.empty) {
                const empData = empSnap.docs[0].data();
                shiftStart = empData.shiftStart || shiftStart;
                shiftEnd = empData.shiftEnd || shiftEnd;
                shiftType = empData.shiftType || shiftType;
                department = empData.department || '';
                departmentColor = empData.departmentColor || '';
                employeeId = empData.employeeId || '';
            }
            // 8. Create attendance record
            const recordData = {
                userId,
                companyId,
                name: userData.name || '',
                email: userData.email || '',
                avatar: userData.avatar || '',
                employeeId,
                department,
                departmentColor,
                departmentId: userData.departmentId || null,
                date: now,
                checkIn: admin.firestore.FieldValue.serverTimestamp(),
                checkOut: null,
                status,
                workHours: 0,
                latitude: latitude || null,
                longitude: longitude || null,
                deviceId: deviceId || null,
                networkType: networkType || null,
                wifiSsid: wifiSsid || null,
                shiftId: null,
                shiftStart,
                shiftEnd,
                shiftType,
                isAutoApproved: true,
                approved: true,
                approvedByName: 'System (Auto-Approved)',
                lateMinutes,
                selfieUrl: selfieUri || null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            };
            const docRef = await db.collection('attendance').add(recordData);
            // 9. Log success
            await db.collection('attendanceLogs').add({
                ...logBase,
                attendanceId: docRef.id,
                action: 'check-in',
                status: 'success',
                reasonCode: null,
                reasonMessage: null,
            });
            // 11. Check for approved leave
            const leaveSnap = await db.collection('leaveRequests')
                .where('userId', '==', userId)
                .where('status', '==', 'Approved')
                .get();
            const activeLeave = leaveSnap.docs.find(d => {
                const ld = d.data();
                const sd = ld.startDate?.toDate?.() ? ld.startDate.toDate() : new Date(ld.startDate);
                const ed = ld.endDate?.toDate?.() ? ld.endDate.toDate() : new Date(ld.endDate);
                return sd <= now && ed >= now;
            });
            if (activeLeave) {
                await docRef.update({ status: 'On Leave', workHours: 0 });
                return { id: docRef.id, status: 'On Leave', message: 'You are on approved leave today. Marked as On Leave.' };
            }
            return {
                id: docRef.id,
                status,
                lateMinutes,
                message: status === 'Late'
                    ? `Checked in! You are ${lateMinutes} min late.`
                    : 'Checked in successfully!',
            };
        }
        if (action === 'check-out') {
            // Validate checkout
            const doubleCheckOut = await (0, attendanceEngine_1.validateCheckOutDouble)(attendanceId);
            if (!doubleCheckOut.valid) {
                await db.collection('attendanceLogs').add({
                    ...logBase,
                    attendanceId,
                    action: 'check-out',
                    status: 'failure',
                    reasonCode: doubleCheckOut.reasonCode,
                    reasonMessage: doubleCheckOut.reasonMessage,
                });
                throw new functions.https.HttpsError('failed-precondition', doubleCheckOut.reasonMessage);
            }
            // Fetch the attendance record
            const recordSnap = await db.collection('attendance').doc(attendanceId).get();
            if (!recordSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Attendance record not found');
            }
            const recordData = recordSnap.data();
            if (recordData.userId !== userId) {
                throw new functions.https.HttpsError('permission-denied', 'This attendance record does not belong to you');
            }
            // Tolerate every timestamp shape cloud clients can leave behind (Firestore
            // Timestamp, Date, ISO string, missing) so check-out never enters the
            // `internal` error path from a stray checkIn format.
            const rawIn = recordData.checkIn;
            const checkInTime = rawIn && typeof rawIn.toDate === 'function' ? rawIn.toDate()
                : rawIn instanceof Date ? rawIn
                    : typeof rawIn === 'string' ? new Date(rawIn)
                        : now;
            const workHours = (now.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);
            // Overtime calculation
            const shiftEndStr = recordData.shiftEnd || '18:00';
            let overtimeHours = 0;
            if (shiftEndStr) {
                const [endH, endM] = shiftEndStr.split(':').map(Number);
                const shiftEndToday = new Date(now);
                shiftEndToday.setHours(endH, endM, 0, 0);
                if (now > shiftEndToday) {
                    const diffMinutes = (now.getTime() - shiftEndToday.getTime()) / (1000 * 60);
                    if (diffMinutes > 30) {
                        overtimeHours = Math.round((diffMinutes / 60) * 100) / 100;
                    }
                }
            }
            // Determine if early checkout
            let status = recordData.status || 'Present';
            if (status !== 'Late') {
                const shiftEndMinutes = parseTimeString(shiftEndStr);
                const checkOutMinutes = getMinutesSinceMidnight(now);
                const threshold = 30;
                if (checkOutMinutes < shiftEndMinutes - threshold) {
                    status = 'Early Checkout';
                }
            }
            await db.collection('attendance').doc(attendanceId).update({
                checkOut: admin.firestore.FieldValue.serverTimestamp(),
                workHours: Math.round(workHours * 100) / 100,
                overtimeHours,
                status,
                isAutoApproved: true,
                approved: true,
                approvedOn: admin.firestore.FieldValue.serverTimestamp(),
                approvedByName: 'System (Auto-Approved)',
            });
            await db.collection('attendanceLogs').add({
                ...logBase,
                attendanceId,
                action: 'check-out',
                status: 'success',
                reasonCode: null,
                reasonMessage: null,
            });
            return {
                id: attendanceId,
                workHours: Math.round(workHours * 100) / 100,
                overtimeHours,
                status,
                message: 'Checked out successfully!',
            };
        }
        throw new functions.https.HttpsError('invalid-argument', 'Invalid action');
    }
    catch (err) {
        if (err instanceof functions.https.HttpsError)
            throw err;
        console.error('markAttendance unexpected error:', err);
        throw new functions.https.HttpsError('internal', err?.message || 'An unexpected error occurred during attendance marking');
    }
});
exports.registerDevice = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
    }
    const { deviceId, deviceModel } = data;
    if (!deviceId) {
        throw new functions.https.HttpsError('invalid-argument', 'deviceId is required');
    }
    await db.collection('users').doc(context.auth.uid).update({
        deviceId,
        deviceModel: deviceModel || null,
        deviceRegisteredAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { success: true, message: 'Device registered successfully' };
});
exports.processCheckIn = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in');
    }
    const { employeeId, companyId, latitude, longitude } = data;
    const userId = context.auth.uid;
    if (!employeeId || !companyId || latitude == null || longitude == null) {
        throw new functions.https.HttpsError('invalid-argument', 'employeeId, companyId, latitude, and longitude are required');
    }
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found');
    }
    const userData = userDoc.data();
    const assignedCompanies = Array.isArray(userData.assignedCompanyIds) ? userData.assignedCompanyIds : [];
    const belongsToCompany = userData.companyId === companyId || assignedCompanies.includes(String(companyId));
    if (!belongsToCompany) {
        throw new functions.https.HttpsError('permission-denied', 'You do not belong to this company');
    }
    const companyDoc = await db.collection('companies').doc(companyId).get();
    if (!companyDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Company not found');
    }
    const companyData = companyDoc.data();
    const officeLat = companyData.latitude || 0;
    const officeLng = companyData.longitude || 0;
    const radius = companyData.radius || 100;
    const distance = (0, attendanceEngine_1.haversineDistance)(latitude, longitude, officeLat, officeLng);
    if (distance > radius) {
        throw new functions.https.HttpsError('permission-denied', `Outside office radius. Distance: ${distance.toFixed(0)}m exceeds ${radius}m limit`);
    }
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    const docRef = await db.collection('attendance').add({
        employeeId,
        companyId,
        userId,
        status: 'Present',
        timestamp,
        checkIn: timestamp,
        checkOut: null,
        workHours: 0,
        latitude,
        longitude,
        method: 'GPS_ONLY',
        distance,
    });
    return { id: docRef.id, status: 'Present', method: 'GPS_ONLY', distance };
});
function getMinutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}
function parseTimeString(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}
//# sourceMappingURL=attendanceFunctions.js.map