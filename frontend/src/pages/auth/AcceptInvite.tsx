import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { acceptInvitation, getInvitationByToken } from '../../services/authService';
import { User, Mail, Lock, Eye, EyeOff, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { Logo } from '../../components/Logo';
import type { UserRole } from '../../types/user';
import '../Login.css';

interface InvitationData {
  email: string;
  name?: string;
  role: UserRole;
  companyId: string;
  invitedByName: string;
}

export const AcceptInvite: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  
  const [inviteData, setInviteData] = useState<InvitationData | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    password: '',
    confirmPassword: '',
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid invitation link');
      setIsValidating(false);
      return;
    }

    const validateToken = async () => {
      try {
        const data = await getInvitationByToken(token) as any;
        const inviteInfo: InvitationData = {
          email: data.email,
          name: data.name || '',
          role: data.role,
          companyId: data.companyId,
          invitedByName: data.invitedByName || ''
        };
        setInviteData(inviteInfo);
        if (data.name) {
          setFormData(prev => ({ ...prev, name: data.name }));
        }
      } catch (err: any) {
        setError(err.message || 'Invalid or expired invitation');
      } finally {
        setIsValidating(false);
      }
    };

    validateToken();
  }, [token]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!token || !inviteData) return;
    
    if (!formData.name.trim()) {
      setError('Full name is required');
      return;
    }
    if (!formData.password) {
      setError('Password is required');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    
    setIsLoading(true);
    setError('');

    try {
      await acceptInvitation(
        token,
        inviteData.email,
        formData.password,
        formData.name
      );
      
      setSuccess(true);
      
      setTimeout(() => {
        // All roles redirect to main dashboard
        navigate('/');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to create account');
    } finally {
      setIsLoading(false);
    }
  };

  const getRoleDisplayName = (role: UserRole): string => {
    const names: Record<UserRole, string> = {
      'master-admin': 'Master Admin',
      'company-admin': 'Company Admin',
      'team-leader': 'Team Leader',
      'executive': 'Executive',
      'reporting-manager': 'Reporting Manager',
      'employee': 'Employee',
    };
    return names[role] || role;
  };

  if (isValidating) {
    return (
      <div className="login-page" style={{ justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <Loader2 size={48} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
          <p>Validating invitation...</p>
        </div>
      </div>
    );
  }

  if (error && !inviteData) {
    return (
      <div className="login-page" style={{ justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '20px' }}>
          <AlertCircle size={64} style={{ color: '#ef4444', marginBottom: '16px' }} />
          <h2 style={{ color: 'white', marginBottom: '8px' }}>Invalid Invitation</h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '24px' }}>{error}</p>
          <Link to="/login" className="login-btn" style={{ background: '#f97316', display: 'inline-block', textDecoration: 'none' }}>
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="login-page" style={{ justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '20px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <CheckCircle size={32} style={{ color: '#16a34a' }} />
          </div>
          <h2 style={{ color: 'white', marginBottom: '8px' }}>Account Created!</h2>
          <p style={{ color: 'rgba(255,255,255,0.7)' }}>Redirecting to your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-container" style={{ maxWidth: '500px', width: '100%', margin: '0 auto' }}>
        <div className="login-form-container" style={{ width: '100%', borderRadius: '16px' }}>
          <div className="login-form-wrapper">
            {/* Logo */}
            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                <Logo variant="stacked" size="md" />
              </div>
              <p style={{ color: '#6b7280' }}>Accept your invitation</p>
            </div>

            {/* Invitation info */}
            <div style={{ background: '#fff7ed', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
              <p style={{ fontSize: '14px', color: '#1e40af', marginBottom: '4px' }}>
                You've been invited by <strong>{inviteData?.invitedByName}</strong>
              </p>
              <p style={{ fontSize: '14px', color: '#f97316' }}>
                Role: <strong>{getRoleDisplayName(inviteData?.role || 'executive')}</strong>
              </p>
            </div>

            <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '4px' }}>Create your account</h2>
            <p style={{ color: '#6b7280', marginBottom: '24px', fontSize: '14px' }}>
              Complete your profile to join the team
            </p>

            {error && (
              <div className="login-error">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="login-form">
              <div className="form-group">
                <label>Email</label>
                <div className="input-wrapper">
                  <Mail size={18} className="input-icon" />
                  <input
                    type="email"
                    value={inviteData?.email || ''}
                    disabled
                    style={{ background: '#f3f4f6', color: '#6b7280' }}
                  />
                </div>
                <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>Email cannot be changed</p>
              </div>

              <div className="form-group">
                <label>Full Name *</label>
                <div className="input-wrapper">
                  <User size={18} className="input-icon" />
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="John Doe"
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Password *</label>
                <div className="input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    placeholder="Min 6 characters"
                    required
                  />
                  <button
                    type="button"
                    className="toggle-password"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Confirm Password *</label>
                <div className="input-wrapper">
                  <Lock size={18} className="input-icon" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    placeholder="Confirm your password"
                    required
                  />
                </div>
              </div>

              <button 
                type="submit" 
                className="login-btn"
                disabled={isLoading}
                style={{ background: '#f97316' }}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={18} style={{ marginRight: '8px', animation: 'spin 1s linear infinite' }} />
                    Creating...
                  </>
                ) : (
                  'Accept Invitation'
                )}
              </button>
            </form>

            <div className="login-footer" style={{ marginTop: '24px' }}>
              <p>Already have an account? <Link to="/login" style={{ color: '#f97316' }}>Sign in</Link></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
