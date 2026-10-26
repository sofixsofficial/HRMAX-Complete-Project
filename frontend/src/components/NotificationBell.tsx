import { useState, useEffect, useRef } from 'react'
import { Bell, CheckCheck, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { subscribeToNotifications, markNotificationAsRead, markAllNotificationsAsRead } from '../services/notificationService'
import type { AppNotification } from '../types/user'

export function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user?.id) return
    const unsub = subscribeToNotifications(user.id, setNotifications)
    return unsub
  }, [user?.id])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const unreadCount = notifications.filter(n => !n.read).length

  const handleNotificationClick = async (n: AppNotification) => {
    if (!n.read) await markNotificationAsRead(n.id)
    setOpen(false)
    if (n.link) navigate(n.link)
  }

  const handleMarkAllRead = async () => {
    if (user?.id) await markAllNotificationsAsRead(user.id)
  }

  const timeAgo = (date: Date) => {
    const diff = Date.now() - new Date(date).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }

  return (
    <div className="notification-wrapper" ref={ref} style={{ position: 'relative' }}>
      <button className="notification-btn" onClick={() => setOpen(!open)} title="Notifications">
        <Bell size={18} />
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 360,
          background: '#fff', borderRadius: 10, boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
          border: '1px solid #e5e7eb', zIndex: 1000, maxHeight: 420, display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid #f3f4f6' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>Notifications</span>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} style={{ fontSize: 12, color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
          <div style={{ overflow: 'auto', flex: 1 }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '30px 14px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No notifications yet</div>
            ) : (
              notifications.map(n => (
                <div key={n.id} onClick={() => handleNotificationClick(n)}
                  style={{
                    padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f9fafb',
                    background: n.read ? '#fff' : '#fff7ed', transition: 'background 0.1s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={e => e.currentTarget.style.background = n.read ? '#fff' : '#fff7ed'}
                >
                  <div style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: '#0f172a', marginBottom: 2 }}>{n.title}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{n.body}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>{timeAgo(n.createdAt)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
