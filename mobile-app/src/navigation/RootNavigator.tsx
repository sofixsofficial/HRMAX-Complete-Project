import React, { useEffect } from 'react';
import { ActivityIndicator, View, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { AuthNavigator } from './AuthNavigator';
import { AppNavigator } from './AppNavigator';
import { LoadingScreen } from '../screens/common/LoadingScreen';
import { navigationRef, navigateToNotificationLink } from './navigationRef';

const Stack = createNativeStackNavigator();

export const RootNavigator: React.FC = () => {
  const { isAuthenticated, isLoading, user } = useAuth();

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

  if (isLoading) {
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
