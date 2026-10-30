import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme, ThemeColors } from '../../context/ThemeContext';
import { Icon } from '../../utils/icons';
import { BrandMark } from '../../components/BrandMark';
import { ERROR_MESSAGES, consumeSessionExpired, toDisplayError, validateEmail } from '../../aws/errors';

interface Props {
  navigation: any;
}

export const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const s = useMemo(() => createStyles(colors), [colors]);

  // Explain why the user was signed out (expired session / token refresh failed)
  useEffect(() => {
    if (consumeSessionExpired()) setError(ERROR_MESSAGES.sessionExpired);
  }, []);

  const handleLogin = async () => {
    const emailValue = email.trim();
    if (!emailValue || !password.trim()) {
      setError(ERROR_MESSAGES.missingCredentials);
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
      await login(emailValue, password.trim());
    } catch (err) {
      setError(toDisplayError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={s.inner}>
        <View style={s.logoWrap}>
          <BrandMark iconSize={72} wordmarkColor="#FF6600" stacked />
        </View>
        <Text style={s.subtitle}>Sign in to your account</Text>

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={s.inputContainer}>
          <Text style={s.label}>Email or System Username</Text>
          <TextInput
            style={s.input}
            placeholder="Enter your email or system username"
            placeholderTextColor={colors.textTertiary}
            value={email}
            onChangeText={(v) => { setEmail(v); if (error) setError(''); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={s.inputContainer}>
          <Text style={s.label}>Password</Text>
          <View style={s.passwordRow}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              placeholder="Enter your password"
              placeholderTextColor={colors.textTertiary}
              value={password}
              onChangeText={(v) => { setPassword(v); if (error) setError(''); }}
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
          style={s.forgotButton}
          onPress={() => navigation.navigate('ForgotPassword')}
        >
          <Text style={s.forgotText}>Forgot Password?</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.loginButton, loading && s.loginButtonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.loginText}>Sign In</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: c.textSecondary,
    textAlign: 'center',
    marginBottom: 40,
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
  forgotButton: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  forgotText: {
    color: '#FF6600',
    fontSize: 14,
  },
  loginButton: {
    backgroundColor: '#FF6600',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
