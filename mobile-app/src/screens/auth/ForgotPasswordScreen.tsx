import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { ScreenHeader } from '../../components/ScreenHeader';
import { resetPassword } from '../../services/authService';

interface Props {
  navigation: any;
}

export const ForgotPasswordScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const s = useMemo(() => createStyles(colors), [colors]);

  const handleReset = async () => {
    if (!email.trim()) {
      Alert.alert('Error', 'Please enter your email address.');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(email.trim());
      navigation.replace('VerifyResetCode', { email: email.trim() });
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to send reset email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Forgot Password" onBack={() => navigation.goBack()} />
      <View style={s.inner}>
        <Text style={s.title}>Forgot Password?</Text>
        <Text style={s.description}>
          Enter your email address and we'll send you a link to reset your password.
        </Text>

        <View style={s.inputContainer}>
          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            placeholder="Enter your email"
            placeholderTextColor={colors.textTertiary}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        <TouchableOpacity
          style={[s.resetButton, loading && s.resetButtonDisabled]}
          onPress={handleReset}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.resetText}>Send Reset Link</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const createStyles = (c: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  icon: {
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: c.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    color: c.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
  },
  inputContainer: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: c.textPrimary,
    marginBottom: 6,
  },
  input: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: c.text,
  },
  resetButton: {
    backgroundColor: '#FF6600',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  resetButtonDisabled: {
    opacity: 0.6,
  },
  resetText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
