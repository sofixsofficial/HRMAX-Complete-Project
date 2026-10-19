export interface NetworkInfo {
  networkType: string | null
  wifiSsid: string | null
  isVpn: boolean
  isEmulator: boolean
  ipAddress: string | null
}

export function getNetworkInfo(): NetworkInfo {
  const conn = (navigator as any).connection;
  let networkType: string | null = null;
  let isVpn = false;

  if (conn) {
    const type = conn.type || conn.effectiveType;
    if (type === 'wifi' || type === 'WiFi') networkType = 'wifi';
    else if (type === 'cellular' || type === '4g' || type === '3g' || type === '2g') networkType = 'mobile';
    else if (type === 'ethernet') networkType = 'ethernet';
    else networkType = type || 'unknown';
  }

  if (conn && typeof conn.isVPN !== 'undefined') {
    isVpn = !!conn.isVPN;
  }

  const wifiSsid: string | null = null;

  return {
    networkType,
    wifiSsid,
    isVpn,
    isEmulator: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      ? false
      : navigator.userAgent.includes('Emulator') || navigator.userAgent.includes('Simulator'),
    ipAddress: null,
  };
}

export function isMockLocationEnabled(): boolean {
  const conn = (navigator as any).connection;
  if (conn && typeof conn.isMockLocation !== 'undefined') {
    return !!conn.isMockLocation;
  }
  return false;
}

export function getDeviceId(): string {
  let deviceId = localStorage.getItem('_deviceId');
  if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    localStorage.setItem('_deviceId', deviceId);
  }
  return deviceId;
}
