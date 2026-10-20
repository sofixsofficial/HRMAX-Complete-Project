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
import { Icon } from '../../utils/icons';
import { ScreenHeader } from '../../components/ScreenHeader';
import { confirmResetPassword } from '../../services/authService';
import { toDisplayError } from '../../aws/errors';

interface Props {
  navigation: any;
  route: any;
}

export const VerifyResetCodeScreen: React.FC<Props> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const s = useMemo(() => createStyles(colors), [colors]);

  const email = route.params?.email || '';

  const handleReset = async () => {
    if (!code.trim() || !newPassword.trim()) {
      setError('Please enter both the code and your new password.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await confirmResetPassword(code.trim(), newPassword.trim());
      Alert.alert('Success', 'Your password has been reset. Please sign in.', [
        { text: 'OK', onPress: () => navigation.navigate('Login') },
      ]);
    } catch (err) {
      setError(toDisplayError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Reset Password" onBack={() => navigation.goBack()} />
      <View style={s.inner}>
        <Text style={s.title}>Reset Password</Text>
        <Text style={s.description}>
          Open the reset link in the email sent to {email}, then paste the code from the link and
          enter your new password.
        </Text>

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={s.inputContainer}>
          <Text style={s.label}>Reset Code</Text>
          <TextInput
            style={s.input}
            placeholder="Paste code from reset email"
            placeholderTextColor={colors.textTertiary}
            value={code}
            onChangeText={(v) => { setCode(v); if (error) setError(''); }}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={s.inputContainer}>
          <Text style={s.label}>New Password</Text>
          <View style={s.passwordRow}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              placeholder="Enter new password"
              placeholderTextColor={colors.textTertiary}
              value={newPassword}
              onChangeText={(v) => { setNewPassword(v); if (error) setError(''); }}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity
              style={s.eyeToggle}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Icon name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[s.resetButton, loading && s.resetButtonDisabled]}
          onPress={handleReset}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.resetText}>Reset Password</Text>
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
    marginBottom: 16,
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
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eyeToggle: {
    position: 'absolute',
    right: 12,
    padding: 8,
  },
  resetButton: {
    backgroundColor: '#FF6600',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
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
