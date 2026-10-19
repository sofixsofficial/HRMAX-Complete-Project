import { useState, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Shield, KeyRound, CheckCircle, XCircle } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { verifyResetCode } from '../../services/authService';
import '../../pages/Login.css';

export function VerifyResetCode() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') || '';
  const navigate = useNavigate();

  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleDigitChange = (index: number, value: string) => {
    if (value && !/^\d$/.test(value)) return;
    const newDigits = [...digits];
    newDigits[index] = value;
    setDigits(newDigits);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    const newDigits = [...digits];
    pasted.split('').forEach((char, i) => {
      if (i < 6) newDigits[i] = char;
    });
    setDigits(newDigits);
    const nextIndex = Math.min(pasted.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join('');
    if (code.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }
    if (!email) {
      setError('Missing email. Please start the reset process again.');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const valid = await verifyResetCode(email, code);
      if (!valid) {
        setError('Invalid or expired code. Please request a new one.');
        return;
      }
      setVerified(true);
      setTimeout(() => {
        navigate(`/set-new-password?email=${encodeURIComponent(email)}&code=${code}`);
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Failed to verify code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!email) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-form-container" style={{ gridColumn: '1 / -1', maxWidth: 480, margin: '0 auto' }}>
            <div className="login-form-wrapper" style={{ textAlign: 'center', padding: '40px 0' }}>
              <XCircle size={48} style={{ color: '#dc2626', marginBottom: 16 }} />
              <h2>Missing Email</h2>
              <p className="login-subtitle">No email address provided. Please start the password reset process again.</p>
              <Link to="/forgot-password" className="login-btn" style={{ display: 'inline-block', textDecoration: 'none', marginTop: 16 }}>
                Start Over
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (verified) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-form-container" style={{ gridColumn: '1 / -1', maxWidth: 480, margin: '0 auto' }}>
            <div className="login-form-wrapper" style={{ textAlign: 'center', padding: '40px 0' }}>
              <CheckCircle size={64} style={{ color: '#10b981', marginBottom: 16 }} />
              <h2>Code Verified</h2>
              <p className="login-subtitle">Redirecting to set your new password...</p>
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
              <h2>Verify Code</h2>
              <p>Enter the 6-digit code sent to your email</p>
            </div>
            <div className="login-features">
              <div className="login-feature">
                <KeyRound size={18} />
                <span>6-digit verification code</span>
              </div>
              <div className="login-feature">
                <Shield size={18} />
                <span>Code expires in 10 minutes</span>
              </div>
            </div>
          </div>
        </div>

        <div className="login-form-container">
          <div className="login-form-wrapper">
            <h2>Enter Code</h2>
            <p className="login-subtitle">
              We sent a code to <strong>{email}</strong>
            </p>

            {error && <div className="login-error">{error}</div>}

            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label>Verification Code</label>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {digits.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleDigitChange(i, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(i, e)}
                      onPaste={i === 0 ? handlePaste : undefined}
                      style={{
                        width: 48,
                        height: 56,
                        textAlign: 'center',
                        fontSize: 24,
                        fontWeight: 700,
                        border: `2px solid ${digit ? '#f97316' : '#e5e7eb'}`,
                        borderRadius: 10,
                        outline: 'none',
                        background: digit ? '#fff7ed' : '#fff',
                        color: '#111827',
                      }}
                      autoFocus={i === 0}
                      required
                    />
                  ))}
                </div>
              </div>

              <button type="submit" className="login-btn" disabled={isLoading || digits.some(d => !d)}>
                {isLoading ? (
                  <><Loader2 size={18} style={{ marginRight: 8, animation: 'spin 1s linear infinite' }} /> Verifying...</>
                ) : (
                  'Verify Code'
                )}
              </button>
            </form>

            <div className="login-footer">
              <p>
                <Link to="/forgot-password" style={{ color: '#f97316', fontWeight: 500 }}>
                  Request a new code
                </Link>
              </p>
              <p style={{ marginTop: 12 }}>
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
