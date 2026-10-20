import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Shield, Lock, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { toDisplayError } from '../../aws/errors';
import '../../pages/Login.css';

function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const map = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong', 'Excellent'];
  const colors = ['#dc2626', '#f59e0b', '#eab308', '#22c55e', '#16a34a', '#15803d'];
  return { score: Math.min(score, 5), label: map[Math.min(score, 5)], color: colors[Math.min(score, 5)] };
}

export function SetNewPassword() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') || '';
  const code = searchParams.get('code') || '';
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const strength = getPasswordStrength(newPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !code) {
      setError('Invalid reset session. Please start the process again.');
      return;
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (strength.score < 2) {
      setError('Password is too weak. Use a mix of uppercase, lowercase, numbers, and special characters.');
      return;
    }

    setIsLoading(true);

    try {
      const functions = getFunctions();
      const resetPasswordFn = httpsCallable(functions, 'resetPasswordWithCode');
      await resetPasswordFn({ email, code, newPassword });

      setSuccess(true);
      setTimeout(() => {
        navigate('/login', { state: { passwordReset: true } });
      }, 2000);
    } catch (err: any) {
      setError(toDisplayError(err).message)
    } finally {
      setIsLoading(false);
    }
  };

  if (!email || !code) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-form-container" style={{ gridColumn: '1 / -1', maxWidth: 480, margin: '0 auto' }}>
            <div className="login-form-wrapper" style={{ textAlign: 'center', padding: '40px 0' }}>
              <XCircle size={48} style={{ color: '#dc2626', marginBottom: 16 }} />
              <h2>Invalid Session</h2>
              <p className="login-subtitle">Missing verification information. Please start the password reset process again.</p>
              <Link to="/forgot-password" className="login-btn" style={{ display: 'inline-block', textDecoration: 'none', marginTop: 16 }}>
                Start Over
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-form-container" style={{ gridColumn: '1 / -1', maxWidth: 480, margin: '0 auto' }}>
            <div className="login-form-wrapper" style={{ textAlign: 'center', padding: '40px 0' }}>
              <CheckCircle size={64} style={{ color: '#10b981', marginBottom: 16 }} />
              <h2>Password Reset!</h2>
              <p className="login-subtitle">Your password has been updated successfully. Redirecting to login...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-brand">
          <div className="login-brand-content">
            <div className="login-logo">
              <Logo variant="stacked" size="sm" />
            </div>
            <div className="login-hero">
              <h2>Set New Password</h2>
              <p>Choose a strong password for your account</p>
            </div>
            <div className="login-features">
              <div className="login-feature">
                <Lock size={18} />
                <span>At least 6 characters</span>
              </div>
              <div className="login-feature">
                <Shield size={18} />
                <span>Mix of letters, numbers & symbols</span>
              </div>
            </div>
          </div>
        </div>

        <div className="login-form-container">
          <div className="login-form-wrapper">
            <h2>New Password</h2>
            <p className="login-subtitle">
              For <strong>{email}</strong>
            </p>

            {error && <div className="login-error">{error}</div>}

            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label>New Password</label>
                <div className="input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    style={{ paddingRight: 48 }}
                    required
                  />
                  <button type="button" className="toggle-password" onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {newPassword && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < strength.score ? strength.color : '#e5e7eb' }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 11, color: strength.color, fontWeight: 600 }}>{strength.label}</span>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Confirm Password</label>
                <div className="input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    style={{ paddingRight: 48 }}
                    required
                  />
                  <button type="button" className="toggle-password" onClick={() => setShowConfirm(!showConfirm)}>
                    {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <span style={{ fontSize: 12, color: '#dc2626', marginTop: 2 }}>Passwords do not match</span>
                )}
              </div>

              <button type="submit" className="login-btn" disabled={isLoading}>
                {isLoading ? (
                  <><Loader2 size={18} style={{ marginRight: 8, animation: 'spin 1s linear infinite' }} /> Resetting...</>
                ) : (
                  'Reset Password'
                )}
              </button>
            </form>

            <div className="login-footer">
              <p>
                <Link to="/login" style={{ color: '#f97316', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ArrowLeft size={16} />
                  Back to Login
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
