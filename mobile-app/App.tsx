import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { CompanyProvider } from './src/context/CompanyContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { NetworkStatus } from './src/components/NetworkStatus';
import { View } from 'react-native';

function AppContent() {
  const { colors } = useTheme();
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
