import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { CompanyProvider } from './src/context/CompanyContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { NetworkStatus } from './src/components/NetworkStatus';
import { View } from 'react-native';

// Keep the native splash (app.json: logo + #111827) on screen until the auth
// session has been restored, instead of flashing an empty frame while the
// cached user loads. hideAsync() is called below once isLoading settles.
SplashScreen.preventAutoHideAsync().catch(() => {});

function AppContent() {
  const { colors } = useTheme();
  const { isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync().catch(() => {});
  }, [isLoading]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <NetworkStatus />
      <StatusBar style={colors.statusBar} />
      <RootNavigator />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ThemeProvider>
          <AuthProvider>
            <CompanyProvider>
              <AppContent />
            </CompanyProvider>
          </AuthProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
