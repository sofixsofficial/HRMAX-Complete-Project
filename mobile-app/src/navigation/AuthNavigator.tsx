import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../context/ThemeContext';
import { LoginScreen } from '../screens/auth/LoginScreen';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen';
import { VerifyResetCodeScreen } from '../screens/auth/VerifyResetCodeScreen';
import { OnboardingScreen, ONBOARDING_KEY } from '../screens/auth/OnboardingScreen';
import { LoadingScreen, useSplashReady } from '../screens/common/LoadingScreen';
import { safeStore } from '../utils/safeStorage';

const Stack = createNativeStackNavigator();

export const AuthNavigator: React.FC = () => {
  const { colors } = useTheme();
  const [ready, setReady] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const splashReady = useSplashReady();

  // One-time intro: read the persisted flag before choosing the initial route,
  // so a returning user never sees the slides again after a logout.
  useEffect(() => {
    let alive = true;
    safeStore
      .getItem(ONBOARDING_KEY)
      .then((v) => {
        if (alive) setFirstRun(v !== '1');
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready || !splashReady) return <LoadingScreen />;

  return (
    <Stack.Navigator
      initialRouteName={firstRun ? 'Onboarding' : 'Login'}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="VerifyResetCode" component={VerifyResetCodeScreen} />
    </Stack.Navigator>
  );
};
