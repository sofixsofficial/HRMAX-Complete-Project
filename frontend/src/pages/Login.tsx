import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { 
  Mail, Lock, Eye, EyeOff, ArrowRight, CheckCircle, Loader2
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Logo } from '../components/Logo'
import { ERROR_MESSAGES, consumeSessionExpired, toDisplayError, validateEmail } from '../aws/errors'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [passwordResetSuccess, setPasswordResetSuccess] = useState(false)

  const navigate = useNavigate()
  const location = useLocation()
  const { login, user } = useAuth()

  useEffect(() => {
    const state = location.state as any
    if (state?.passwordReset) {
      setPasswordResetSuccess(true)
      setEmail('')
      setPassword('')
    }
  }, [location.state])

  // Explain why the user was sent back here (expired session / token refresh failed)
  useEffect(() => {
    if (consumeSessionExpired()) setError(ERROR_MESSAGES.sessionExpired)
  }, [])

  const rolePathMap: Record<string, string> = {
    'master-admin': '/master-admin/dashboard',
    'company-admin': '/company-admin/dashboard',
    'executive': '/executive/dashboard',
    'team-leader': '/team-leader/dashboard',
    'reporting-manager': '/reporting-manager/dashboard',
    'employee': '/employee/dashboard',
  }

  useEffect(() => {
    if (user) {
      // Forced password change disabled — all users go directly to their dashboard.
      const from = (location.state as any)?.from?.pathname
      const redirect = from || rolePathMap[user.role] || '/'
      navigate(redirect, { replace: true })
    }
  }, [user, navigate, location.state])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const emailValue = email.trim()

    // Client-side validation before hitting the network
    if (!emailValue || !password) {
      setError(ERROR_MESSAGES.missingCredentials)
      return
    }
    const emailError = validateEmail(emailValue)
    if (emailError) {
      setError(emailError)
      return
    }

    setIsLoading(true)
    try {
      await login(emailValue, password)
    } catch (err: any) {
      setError(toDisplayError(err).message)
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-5 font-sans">
      <div className="grid grid-cols-[420px_480px] max-w-[900px] w-full min-h-[500px] bg-white rounded-2xl overflow-hidden shadow-lg border border-gray-100 max-lg:grid-cols-1 max-lg:max-w-[420px]">
        {/* Left Side - Brand */}
        <div className="bg-gradient-to-b from-[#1e293b] to-[#0f172a] p-9 lg:p-12 text-white flex flex-col relative overflow-hidden">
          <div className="absolute -top-1/2 -right-1/2 w-full h-full bg-[radial-gradient(circle,rgba(249,115,22,0.08)_0%,transparent_70%)] pointer-events-none" />
          <div className="relative z-10">
            <div className="mb-10">
              <Logo variant="stacked" size="sm" />
            </div>
            <div className="mb-8">
              <h2 className="text-[28px] font-bold leading-tight mb-3">All-in-One HR<br />Management Platform</h2>
              <p className="text-sm text-white/80 leading-relaxed">
                The all-in-one HR solution for managing companies, employees, attendance, payroll, and more — from a single powerful dashboard.
              </p>
            </div>
            <div className="flex flex-col gap-4">
              {['Multi-company & department management', 'Role-based access control with permissions', 'Automated payroll & attendance tracking', 'Real-time analytics & comprehensive reports'].map((text, i) => (
                <div key={i} className="flex items-center gap-3 text-[13px] text-white/85">
                  <CheckCircle size={18} className="text-orange-500 shrink-0" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Side - Form */}
        <div className="flex items-center justify-center p-9 lg:p-12 bg-white">
          <div className="w-full max-w-[340px]">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome Back</h2>
            <p className="text-sm text-gray-500 mb-7">Sign in to your account to continue</p>

            {passwordResetSuccess && (
              <div className="bg-emerald-50 text-emerald-700 px-3.5 py-2.5 rounded-lg text-[13px] mb-5 border border-emerald-200">
                Password updated successfully. Please enter your new credentials.
              </div>
            )}

            {error && (
              <div className="bg-red-50 text-red-600 px-3.5 py-2.5 rounded-lg text-[13px] mb-5 border border-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]" noValidate>
              {/* Email Field */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-gray-700">Email Address</label>
                <div className="relative flex items-center">
                  <Mail size={18} className="absolute left-3.5 text-gray-500 pointer-events-none z-[1]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (error) setError('') }}
                    placeholder="Enter your email"
                    required
                    autoComplete="off"
                    className="w-full pl-[46px] pr-4 py-3 text-sm border border-gray-200 rounded-xl outline-none transition-all duration-150 focus:border-orange-500 focus:ring-[3px] focus:ring-orange-100 bg-white text-gray-900 placeholder-gray-500"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-gray-700">Password</label>
                <div className="relative flex items-center">
                  <Lock size={18} className="absolute left-3.5 text-gray-500 pointer-events-none z-[1]" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError('') }}
                    placeholder="Enter your password"
                    required
                    autoComplete="new-password"
                    className="w-full pl-[46px] pr-[46px] py-3 text-sm border border-gray-200 rounded-xl outline-none transition-all duration-150 focus:border-orange-500 focus:ring-[3px] focus:ring-orange-100 bg-white text-gray-900 placeholder-gray-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 text-gray-500 hover:text-gray-600 p-0.5 z-[1]"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Options */}
              <div className="flex items-center justify-between text-[13px] -mt-1">
                <label className="flex items-center gap-2 cursor-pointer text-gray-700">
                  <input type="checkbox" className="w-4 h-4 rounded border-gray-300 accent-orange-500 cursor-pointer" />
                  <span>Remember me</span>
                </label>
                <Link to="/forgot-password" className="text-orange-500 font-medium hover:underline">Forgot Password?</Link>
              </div>
              {/* Submit */}
              <button type="submit" disabled={isLoading}
                className="w-full bg-orange-500 text-white font-semibold py-3.5 rounded-xl text-[15px] transition-all duration-150 hover:bg-orange-600 hover:shadow-lg hover:shadow-orange-500/30 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1"
              >
                {isLoading ? (
                  <><Loader2 size={18} className="animate-spin" /> Signing In...</>
                ) : (
                  <>Sign In <ArrowRight size={18} /></>
                )}
              </button>
            </form>

            <p className="mt-7 text-center text-[13px] text-gray-500">
              <Link to="/register" className="text-orange-500 font-medium hover:underline">Corporate Inquiry</Link>
            </p>

            <p className="mt-6 text-center text-[12px] text-gray-400">
              Powered by{' '}
              <a
                href="https://www.sofixs.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-500 font-semibold hover:underline"
              >
                Sofixs
              </a>
            </p>

          </div>
        </div>
      </div>
    </div>
  )
}
