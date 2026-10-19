import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Icon } from '../utils/icons';

interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.emoji}>
            <Icon name="warning-outline" size={48} color="#FF6600" />
          </View>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error?.message || 'An unexpected error occurred'}</Text>
          <TouchableOpacity style={styles.button} onPress={this.handleReset}>
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 32 },
  emoji: { marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  message: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  button: { backgroundColor: '#FF6600', borderRadius: 10, paddingHorizontal: 32, paddingVertical: 14 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
