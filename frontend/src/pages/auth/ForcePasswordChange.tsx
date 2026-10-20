import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff, Loader2, Shield, CheckCircle, AlertCircle } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { updateUserPassword, reauthenticateUser } from '../../services/authService';
import { useAuth } from '../../context/AuthContext';
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

export function ForcePasswordChange() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const strength = getPasswordStrength(newPassword);

  const rolePathMap: Record<string, string> = {
    'master-admin': '/master-admin/dashboard',
    'company-admin': '/company-admin/dashboard',
    'executive': '/executive/dashboard',
    'team-leader': '/team-leader/dashboard',
    'reporting-manager': '/reporting-manager/dashboard',
    'employee': '/employee/dashboard',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

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
      await reauthenticateUser(currentPassword);
      await updateUserPassword(newPassword);

      if (user) {
        const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
        const { db } = await import('../../config/firebase');
        await updateDoc(doc(db, 'users', user.id), {
          requirePasswordChange: false,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      await refreshUser();
      setSuccess(true);

      setTimeout(() => {
        const target = user?.role ? rolePathMap[user.role] : '/';
        navigate(target, { replace: true });
      }, 2000);
    } catch (err: any) {
      setError(toDisplayError(err).message)
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-5">
        <div style={{ textAlign: 'center', padding: 40, background: '#fff', borderRadius: 20, maxWidth: 420 }}>
          <CheckCircle size={64} style={{ color: '#10b981', marginBottom: 16 }} />
          <h2 style={{ marginBottom: 8 }}>Password Changed!</h2>
          <p style={{ color: '#6b7280', fontSize: 14 }}>Redirecting to your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-container" style={{ maxWidth: 520, gridTemplateColumns: '1fr' }}>
        <div style={{ padding: '48px 40px' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <Logo variant="stacked" size="sm" />
          </div>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <Shield size={40} style={{ color: '#f97316', marginBottom: 12 }} />
            <h2 style={{ margin: '0 0 4px 0', fontSize: 22 }}>Change Required</h2>
            <p style={{ color: '#6b7280', fontSize: 14, margin: 0 }}>
              For security reasons, you must change your password before continuing.
            </p>
          </div>

          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#92400e' }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>This is a temporary password. Please set a new one.</span>
          </div>

          {error && <div className="login-error">{error}</div>}

          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label>Current Password</label>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                  style={{ paddingRight: 48 }}
                  required
                />
                <button type="button" className="toggle-password" onClick={() => setShowCurrent(!showCurrent)}>
                  {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label>New Password</label>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  style={{ paddingRight: 48 }}
                  required
                />
                <button type="button" className="toggle-password" onClick={() => setShowNew(!showNew)}>
                  {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
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
              <label>Confirm New Password</label>
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
                <><Loader2 size={18} style={{ marginRight: 8, animation: 'spin 1s linear infinite' }} /> Updating...</>
              ) : (
                'Change Password'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
