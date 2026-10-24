import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Mail, ArrowLeft, Loader2, CheckCircle, Lock, Shield, Zap, ArrowRight } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { getFunctions, httpsCallable } from '../../aws/functions-compat';
import { ERROR_MESSAGES, toDisplayError, validateEmail } from '../../aws/errors';
import '../../pages/Login.css';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

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

    setIsLoading(true);

    try {
      // Server generates + emails the 6-digit code (stored SHA-256-hashed).
      const functions = getFunctions();
      const sendResetCodeFn = httpsCallable(functions, 'sendResetCode');
      try {
        await sendResetCodeFn({ email: emailValue });
      } catch (fnErr: any) {
        console.warn('SendResetCode failed (email may not be sent):', fnErr);
      }

      setSuccess(true);
      setTimeout(() => {
        navigate(`/verify-reset-code?email=${encodeURIComponent(emailValue)}`);
      }, 1500);
    } catch (err: any) {
      setError(toDisplayError(err).message || ERROR_MESSAGES.generic);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-brand">
          <div className="login-brand-content">
            <div className="login-logo">
              <Logo variant="stacked" size="sm" />
            </div>
            <div className="login-hero">
              <h2>Reset Password</h2>
              <p>Reset your password to regain access to your account</p>
            </div>
            <div className="login-features">
              <div className="login-feature">
                <Lock size={18} />
                <span>Secure email-based password recovery</span>
              </div>
              <div className="login-feature">
                <Zap size={18} />
                <span>Quick and easy reset process</span>
              </div>
              <div className="login-feature">
                <Shield size={18} />
                <span>Bank-grade security</span>
              </div>
            </div>
          </div>
        </div>

        <div className="login-form-container">
          <div className="login-form-wrapper">
            {success ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <CheckCircle size={64} style={{ color: '#10b981', marginBottom: '20px' }} />
                <h2 style={{ marginBottom: '12px', color: '#111827' }}>Check Your Email</h2>
                <p className="login-subtitle" style={{ marginBottom: '24px' }}>
                  A 6-digit verification code has been sent to <strong>{email}</strong>
                </p>
                <Link
                  to={`/verify-reset-code?email=${encodeURIComponent(email)}`}
                  className="login-btn"
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none', textAlign: 'center' }}
                >
                  Enter Code <ArrowRight size={18} />
                </Link>
              </div>
            ) : (
              <>
                <h2>Reset Password</h2>
                <p className="login-subtitle">Enter your email to receive a 6-digit verification code</p>

                {error && (
                  <div className="login-error">{error}</div>
                )}

                <form onSubmit={handleSubmit} className="login-form" noValidate>
                  <div className="form-group">
                    <label>Email Address</label>
                    <div className="input-wrapper">
                      <Mail size={18} className="input-icon" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => { setEmail(e.target.value); if (error) setError(''); }}
                        placeholder="Enter your email"
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="login-btn"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 size={18} style={{ marginRight: '8px', animation: 'spin 1s linear infinite' }} />
                        Sending Code...
                      </>
                    ) : (
                      'Send Verification Code'
                    )}
                  </button>
                </form>

                <div className="login-footer">
                  <p>
                    <Link to="/login" style={{ color: '#f97316', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <ArrowLeft size={16} />
                      Back to Login
                    </Link>
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
