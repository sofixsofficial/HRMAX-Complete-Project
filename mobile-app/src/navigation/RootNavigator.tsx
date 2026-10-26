import React, { useEffect } from 'react';
import { ActivityIndicator, View, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { AuthNavigator } from './AuthNavigator';
import { AppNavigator } from './AppNavigator';
import { LoadingScreen, useSplashReady } from '../screens/common/LoadingScreen';
import { navigationRef, navigateToNotificationLink } from './navigationRef';
import { useNotifications } from '../hooks/useNotifications';
import { safeStore } from '../utils/safeStorage';

const Stack = createNativeStackNavigator();

/** Push permission is requested at most once, ever — Settings keeps the toggle. */
const PUSH_PROMPT_KEY = 'hrmax_push_prompted';

export const RootNavigator: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { register } = useNotifications();
  const splashReady = useSplashReady();

  // Push registration was previously manual-only (a Settings/Notifications
  // toggle nobody flips). After sign-in, register this device automatically:
  // permission is requested once — if the user declines, we never nag again
  // and the existing Settings toggle remains the way back in.
  useEffect(() => {
    if (!isAuthenticated || Platform.OS === 'web') return;
    let alive = true;
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status === 'granted') {
          await register();
          return;
        }
        const asked = await safeStore.getItem(PUSH_PROMPT_KEY);
        if (asked === '1') return;
        await new Promise((r) => setTimeout(r, 3000));
        if (!alive) return;
        await safeStore.setItem(PUSH_PROMPT_KEY, '1');
        await register();
      } catch {
        /* push is best-effort — never block sign-in on it */
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAuthenticated, register]);

  useEffect(() => {
    // Push-notification responses are native-only; the expo-notifications web
    // shim throws UnavailabilityError for getLastNotificationResponseAsync /
    // response listeners (uncaught promise crash in the browser preview).
    if (Platform.OS === 'web') return;
    const handleResponse = (response: Notifications.NotificationResponse) => {
      const link = response.notification.request.content.data?.link as string | undefined;
      if (link) {
        setTimeout(() => navigateToNotificationLink(link, user?.role), 400);
      }
    };

    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    if (isAuthenticated) {
      Notifications.getLastNotificationResponseAsync().then((last) => {
        if (last) handleResponse(last);
      });
    }
    return () => sub.remove();
  }, [isAuthenticated, user?.role]);

  if (isLoading || !splashReady) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Auth" component={AuthNavigator} />
        ) : (
          <Stack.Screen name="App" component={AppNavigator} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};
