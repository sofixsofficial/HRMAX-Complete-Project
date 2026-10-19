import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { auth, db } from '../config/firebase';
import { doc, updateDoc, deleteField } from 'firebase/firestore';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export function useNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<boolean>(false);

  const register = useCallback(async () => {
    // Push tokens are native-only (expo-notifications warns & no-ops on web).
    if (Platform.OS === 'web' || !Device.isDevice) return;
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      setNotificationPermission(false);
      return;
    }
    setNotificationPermission(true);
    try {
      const tokenData = await Notifications.getExpoPushTokenAsync();
      const token = tokenData.data;
      setExpoPushToken(token);
      if (auth.currentUser) {
        await updateDoc(doc(db, 'users', auth.currentUser.uid), { pushToken: token });
      }
    } catch {}
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
      });
    }
  }, []);

  const unregister = useCallback(async () => {
    setExpoPushToken(null);
    setNotificationPermission(false);
    if (auth.currentUser) {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), { pushToken: deleteField() });
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationReceivedListener(() => {});
    return () => sub.remove();
  }, []);

  return { expoPushToken, notificationPermission, register, unregister, isRegistered: !!expoPushToken };
}
