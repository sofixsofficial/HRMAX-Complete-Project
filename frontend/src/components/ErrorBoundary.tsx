import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { safeDisplayText } from '../aws/errors'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error.message, info.componentStack)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 16, padding: '64px 24px', textAlign: 'center', minHeight: 300,
        }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={28} color="#ef4444" />
          </div>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: '#1f2937' }}>Something went wrong</h3>
            <p style={{ margin: 0, fontSize: 14, color: '#6b7280', maxWidth: 400 }}>
              {safeDisplayText(this.state.error?.message) || 'An unexpected error occurred.'}
            </p>
          </div>
          <button onClick={this.handleRetry} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px',
            borderRadius: 8, border: 'none', background: '#f97316',
            color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
            <RefreshCw size={16} /> Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
