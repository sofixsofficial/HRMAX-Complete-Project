import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { ScreenHeader } from '../../components/ScreenHeader';
import { resetPassword } from '../../services/authService';
import { toDisplayError, validateEmail } from '../../aws/errors';

interface Props {
  navigation: any;
}

export const ForgotPasswordScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const s = useMemo(() => createStyles(colors), [colors]);

  const handleReset = async () => {
    const emailValue = email.trim();
    if (!emailValue) {
      setError('Please enter your email address.');
      return;
    }
    const emailError = validateEmail(emailValue);
    if (emailError) {
      setError(emailError);
      return;
    }
    setError('');
    setLoading(true);
    try {
      await resetPassword(emailValue);
      navigation.replace('VerifyResetCode', { email: emailValue });
    } catch (err) {
      setError(toDisplayError(err).message);
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

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={s.inputContainer}>
          <Text style={s.label}>Email</Text>
          <TextInput
            style={s.input}
            placeholder="Enter your email"
            placeholderTextColor={colors.textTertiary}
            value={email}
            onChangeText={(v) => { setEmail(v); if (error) setError(''); }}
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
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    textAlign: 'center',
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
