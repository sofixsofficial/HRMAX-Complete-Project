import { useEffect } from 'react'
import { CheckCircle, XCircle, X } from 'lucide-react'

interface ToastProps {
  message: string
  type: 'success' | 'error'
  onClose: () => void
  duration?: number
}

export const Toast = ({ message, type, onClose, duration = 4000 }: ToastProps) => {
  useEffect(() => {
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [onClose, duration])

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '14px 18px',
        borderRadius: 12,
        background: type === 'success' ? '#065f46' : '#991b1b',
        color: '#fff',
        fontSize: 14,
        fontWeight: 500,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        animation: 'slideInRight 0.3s ease',
        maxWidth: 400,
      }}
    >
      {type === 'success' ? <CheckCircle size={20} /> : <XCircle size={20} />}
      <span style={{ flex: 1 }}>{message}</span>
      <button
        onClick={onClose}
        style={{
          background: 'none',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          opacity: 0.7,
          padding: 2,
          display: 'flex',
        }}
      >
        <X size={16} />
      </button>
    </div>
  )
}
