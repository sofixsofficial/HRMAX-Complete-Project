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
exports.haversineDistance = haversineDistance;
exports.validateGeolocation = validateGeolocation;
exports.validateNetwork = validateNetwork;
exports.validateAntiSpoofing = validateAntiSpoofing;
exports.validateSelfie = validateSelfie;
exports.validateCheckInDouble = validateCheckInDouble;
exports.validateCheckOutDouble = validateCheckOutDouble;
exports.determineAttendanceStatus = determineAttendanceStatus;
exports.getDistanceFromLatLonInMeters = getDistanceFromLatLonInMeters;
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
const EARTH_RADIUS_METERS = 6371000;
function toRadians(deg) {
    return deg * (Math.PI / 180);
}
function haversineDistance(lat1, lon1, lat2, lon2) {
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
}
async function validateGeolocation(currentLat, currentLon, policy) {
    if (!policy.enableGeofence) {
        return { valid: true, reasonCode: null, reasonMessage: null };
    }
    if (!policy.officeLocation || !policy.officeLocation.latitude || !policy.officeLocation.longitude) {
        return { valid: false, reasonCode: 'NO_OFFICE_LOCATION', reasonMessage: 'Office location not configured' };
    }
    const distance = haversineDistance(currentLat, currentLon, policy.officeLocation.latitude, policy.officeLocation.longitude);
    if (distance > policy.officeLocation.radiusMeters) {
        return {
            valid: false,
            reasonCode: 'GPS_OUT_OF_BOUNDS',
            reasonMessage: `Your location (${distance.toFixed(0)}m from office) exceeds the allowed radius of ${policy.officeLocation.radiusMeters}m`,
        };
    }
    return { valid: true, reasonCode: null, reasonMessage: null };
}
async function validateNetwork(networkType, wifiSsid, isVpn, policy) {
    if (!policy.enableNetworkGuard) {
        return { valid: true, reasonCode: null, reasonMessage: null };
    }
    if (isVpn) {
        return { valid: false, reasonCode: 'VPN_DETECTED', reasonMessage: 'VPN or proxy detected. Please disconnect and try again.' };
    }
    if (policy.wifiOnly) {
        if (networkType !== 'wifi') {
            return { valid: false, reasonCode: 'WIFI_REQUIRED', reasonMessage: 'Please connect to the office Wi-Fi network' };
        }
        if (policy.allowedWifis.length > 0 && wifiSsid) {
            const allowed = policy.allowedWifis.some((w) => w.ssid.toLowerCase() === wifiSsid.toLowerCase());
            if (!allowed) {
                return { valid: false, reasonCode: 'WRONG_WIFI', reasonMessage: `Connected to "${wifiSsid}" which is not an authorized office network` };
            }
        }
    }
    if (networkType === 'mobile' && !policy.mobileDataAllowed) {
        return { valid: false, reasonCode: 'MOBILE_DATA_DENIED', reasonMessage: 'Mobile data is not allowed. Please use office Wi-Fi.' };
    }
    return { valid: true, reasonCode: null, reasonMessage: null };
}
async function validateAntiSpoofing(isMockLocation, isEmulator, deviceId, userId, policy) {
    if (!policy.enableAntiSpoofing) {
        return { valid: true, reasonCode: null, reasonMessage: null };
    }
    if (isMockLocation) {
        return { valid: false, reasonCode: 'MOCK_LOCATION_DETECTED', reasonMessage: 'Mock location detected. Please disable developer mock location settings.' };
    }
    if (deviceId && userId) {
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            const registeredDeviceId = userData?.deviceId;
            if (registeredDeviceId && registeredDeviceId !== deviceId) {
                return { valid: false, reasonCode: 'DEVICE_MISMATCH', reasonMessage: 'This account is registered to a different device. Please use your registered device.' };
            }
        }
    }
    return { valid: true, reasonCode: null, reasonMessage: null };
}
async function validateSelfie(userId, companyId, policy, selfieUri) {
    if (!policy.enableSelfie && !policy.requireSelfie) {
        return { valid: true, reasonCode: null, reasonMessage: null };
    }
    if (!selfieUri) {
        return { valid: false, reasonCode: 'SELFIE_REQUIRED', reasonMessage: 'Selfie verification is required for check-in' };
    }
    // The selfie must be a Firebase Storage download URL from THIS user's own
    // selfie path. Storage rules already restrict writes to the user's own path;
    // this check prevents submitting a URL for another user/company.
    try {
        const url = new URL(selfieUri);
        const decodedPath = decodeURIComponent(url.pathname);
        const expectedPath = `/selfies/${companyId}/${userId}`;
        if (!decodedPath.includes(expectedPath)) {
            return { valid: false, reasonCode: 'INVALID_SELFIE', reasonMessage: 'Selfie could not be verified. Please take a new selfie.' };
        }
    }
    catch {
        return { valid: false, reasonCode: 'INVALID_SELFIE', reasonMessage: 'Selfie could not be verified. Please take a new selfie.' };
    }
    return { valid: true, reasonCode: null, reasonMessage: null };
}
async function validateCheckInDouble(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const existingSnap = await db.collection('attendance')
        .where('userId', '==', userId)
        .where('date', '>=', today)
        .where('date', '<', tomorrow)
        .limit(1)
        .get();
    if (!existingSnap.empty) {
        const record = existingSnap.docs[0].data();
        if (!record.checkOut) {
            return { valid: false, reasonCode: 'ALREADY_CHECKED_IN', reasonMessage: 'You have already checked in today. Please check out first.' };
        }
        if (record.checkOut) {
            return { valid: false, reasonCode: 'ALREADY_CHECKED_OUT', reasonMessage: 'You have already completed your attendance for today.' };
        }
    }
    return { valid: true, reasonCode: null, reasonMessage: null };
}
async function validateCheckOutDouble(attendanceId) {
    const snap = await db.collection('attendance').doc(attendanceId).get();
    if (!snap.exists) {
        return { valid: false, reasonCode: 'NO_RECORD', reasonMessage: 'Attendance record not found' };
    }
    const data = snap.data();
    if (data.checkOut) {
        return { valid: false, reasonCode: 'ALREADY_CHECKED_OUT', reasonMessage: 'You have already checked out' };
    }
    return { valid: true, reasonCode: null, reasonMessage: null };
}
function getMinutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}
function parseTimeString(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}
async function determineAttendanceStatus(checkInDate, policy) {
    const shiftStart = policy.defaultShiftStart || '09:00';
    const gracePeriod = policy.gracePeriodMinutes || 15;
    const checkInMinutes = getMinutesSinceMidnight(checkInDate);
    const shiftStartMinutes = parseTimeString(shiftStart);
    if (checkInMinutes <= shiftStartMinutes) {
        return { status: 'Present', lateMinutes: 0 };
    }
    const diff = checkInMinutes - shiftStartMinutes;
    if (diff <= gracePeriod) {
        return { status: 'Present', lateMinutes: 0 };
    }
    return { status: 'Late', lateMinutes: diff };
}
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    return haversineDistance(lat1, lon1, lat2, lon2);
}
//# sourceMappingURL=attendanceEngine.js.map