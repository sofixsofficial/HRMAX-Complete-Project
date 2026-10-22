import { useState, useEffect } from 'react'
import { Shield, CheckCircle, XCircle, Ban, RotateCcw, Trash2, Search, Loader2, AlertCircle, UserCheck, Clock, UserX, Users, ArrowUpRight } from 'lucide-react'
import type { User, CompanyAdminStatus } from '../types/user'
import { subscribeCompanyAdmins, approveCompanyAdmin, rejectCompanyAdmin, suspendCompanyAdmin, reactivateCompanyAdmin, deleteCompanyAdmin } from '../services/companyAdminApprovalService'
import { Pagination } from '../components/Pagination'
import './CompanyAdminApprovals.css'

export function CompanyAdminApprovals() {
  const [admins, setAdmins] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CompanyAdminStatus | 'All'>('All')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [rejectModal, setRejectModal] = useState<{ admin: User } | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')

  useEffect(() => {
    const unsub = subscribeCompanyAdmins((data) => {
      setAdmins(data)
      setLoading(false)
    })
    return unsub
  }, [])

  const stats = {
    total: admins.length,
    pending: admins.filter(a => (a.status || 'Pending') === 'Pending').length,
    approved: admins.filter(a => a.status === 'Approved').length,
    rejected: admins.filter(a => a.status === 'Rejected').length,
    suspended: admins.filter(a => a.status === 'Suspended').length,
  }

  const statusColor: Record<string, string> = {
    Pending: '#f59e0b',
    Approved: '#10b981',
    Rejected: '#ef4444',
    Suspended: '#6b7280',
  }

  const statusBg: Record<string, string> = {
    Pending: '#fffbeb',
    Approved: '#f0fdf4',
    Rejected: '#fef2f2',
    Suspended: '#f9fafb',
  }

  const statCards = [
    { label: 'Total Company Admins', value: stats.total, color: '#f97316', icon: Users, filter: 'All' as const },
    { label: 'Pending Approvals', value: stats.pending, color: '#f59e0b', icon: Clock, filter: 'Pending' as const },
    { label: 'Approved', value: stats.approved, color: '#10b981', icon: CheckCircle, filter: 'Approved' as const },
    { label: 'Rejected', value: stats.rejected, color: '#ef4444', icon: XCircle, filter: 'Rejected' as const },
    { label: 'Suspended', value: stats.suspended, color: '#6b7280', icon: Ban, filter: 'Suspended' as const },
  ]

  const filtered = admins.filter(a => {
    const matchesSearch = 
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.email.toLowerCase().includes(search.toLowerCase()) ||
      (a.companyId || '').toLowerCase().includes(search.toLowerCase())
    const matchesStatus = statusFilter === 'All' || (a.status || 'Pending') === statusFilter
    return matchesSearch && matchesStatus
  })

  // Back to page 1 whenever the search / status filter changes
  useEffect(() => {
    setPage(1)
  }, [search, statusFilter])

  const safePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)))
  const pagedRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  const handleApprove = async (adminId: string) => {
    setActionLoading(adminId)
    try {
      await approveCompanyAdmin(adminId)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async () => {
    if (!rejectModal || !rejectionReason.trim()) return
    setActionLoading(rejectModal.admin.id)
    try {
      await rejectCompanyAdmin(rejectModal.admin.id, rejectionReason.trim())
      setRejectModal(null)
      setRejectionReason('')
    } catch (err: any) {
      alert(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleSuspend = async (adminId: string) => {
    if (!window.confirm('Are you sure you want to suspend this Company Admin?')) return
    setActionLoading(adminId)
    try {
      await suspendCompanyAdmin(adminId)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleReactivate = async (adminId: string) => {
    setActionLoading(adminId)
    try {
      await reactivateCompanyAdmin(adminId)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const handleDelete = async (adminId: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this Company Admin account? This action cannot be undone.')) return
    setActionLoading(adminId)
    try {
      await deleteCompanyAdmin(adminId)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
          <div style={{ textAlign: 'center' }}>
            <Loader2 className="animate-spin" size={32} style={{ margin: '0 auto 12px', color: '#f97316' }} />
            <p style={{ color: '#6b7280' }}>Loading company admin accounts...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <div className="page-content">
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>Company Admin Approval Management</h2>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Manage Company Admin registrations — approve, reject, suspend, or reactivate accounts</p>
        </div>

        {/* Stats Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
          {statCards.map((card, idx) => {
            const Icon = card.icon
            const isActive = statusFilter === card.filter
            return (
              <div
                key={idx}
                onClick={() => setStatusFilter(isActive ? 'All' : card.filter)}
                style={{
                  background: '#fff',
                  border: `1px solid ${isActive ? card.color : '#f3f4f6'}`,
                  borderRadius: 12,
                  padding: '16px 20px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: isActive ? `0 0 0 1px ${card.color}20, 0 4px 12px ${card.color}15` : '0 1px 3px rgba(0,0,0,0.04)',
                }}
                onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.borderColor = card.color; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 12px ${card.color}10` } }}
                onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.borderColor = '#f3f4f6'; (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)' } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: `${card.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={18} color={card.color} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{card.label}</span>
                </div>
                <p style={{ fontSize: 28, fontWeight: 700, color: '#111827', margin: 0 }}>{card.value}</p>
              </div>
            )
          })}
        </div>

        {/* Search + Filter Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
            <input
              type="text"
              placeholder="Search by name, email, or company..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', background: '#fff' }}
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as CompanyAdminStatus | 'All')}
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: '#fff', outline: 'none' }}
          >
            <option value="All">All Status</option>
            <option value="Pending">Pending</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Suspended">Suspended</option>
          </select>
        </div>

        {/* Company Admin Table */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f3f4f6', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Admin</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Company</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Registered</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', fontWeight: 600, color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 40, textAlign: 'center' }}>
                      <Shield size={32} style={{ color: '#d1d5db', marginBottom: 8 }} />
                      <p style={{ color: '#9ca3af', fontSize: 13, margin: 0 }}>No company admin accounts found</p>
                    </td>
                  </tr>
                ) : (
                  pagedRows.map(admin => {
                    const st = admin.status || 'Pending'
                    return (
                      <tr key={admin.id} style={{ borderBottom: '1px solid #f9fafb', transition: 'background 0.15s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f9fafb' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontWeight: 600, color: '#111827' }}>{admin.name}</span>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px', color: '#6b7280' }}>{admin.email}</td>
                        <td style={{ padding: '12px 16px', maxWidth: 160 }}>
                          <span style={{ color: '#374151', fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {admin.companyId || '-'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', color: '#6b7280', whiteSpace: 'nowrap', fontSize: 12 }}>
                          {admin.createdAt ? new Date(admin.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '-'}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '4px 10px', borderRadius: 6,
                            fontSize: 11, fontWeight: 600,
                            background: statusBg[st] || '#f3f4f6',
                            color: statusColor[st] || '#374151',
                          }}>
                            {st === 'Pending' && <Clock size={12} />}
                            {st === 'Approved' && <CheckCircle size={12} />}
                            {st === 'Rejected' && <XCircle size={12} />}
                            {st === 'Suspended' && <Ban size={12} />}
                            {st}
                          </span>
                          {admin.rejectionReason && st === 'Rejected' && (
                            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Reason: {admin.rejectionReason}</div>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                            {st === 'Pending' && (
                              <>
                                <button
                                  onClick={() => handleApprove(admin.id)}
                                  disabled={actionLoading === admin.id}
                                  title="Approve"
                                  style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#10b981', color: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                >
                                  {actionLoading === admin.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                                  Approve
                                </button>
                                <button
                                  onClick={() => setRejectModal({ admin })}
                                  title="Reject"
                                  style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ef4444', background: '#fff', color: '#ef4444', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                >
                                  <XCircle size={12} />
                                  Reject
                                </button>
                              </>
                            )}
                            {st === 'Approved' && (
                              <button
                                onClick={() => handleSuspend(admin.id)}
                                disabled={actionLoading === admin.id}
                                title="Suspend"
                                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #f59e0b', background: '#fff', color: '#f59e0b', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                {actionLoading === admin.id ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                                Suspend
                              </button>
                            )}
                            {(st === 'Suspended' || st === 'Rejected') && (
                              <button
                                onClick={() => handleReactivate(admin.id)}
                                disabled={actionLoading === admin.id}
                                title="Reactivate"
                                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #10b981', background: '#fff', color: '#10b981', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                {actionLoading === admin.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                                Reactivate
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(admin.id)}
                              disabled={actionLoading === admin.id}
                              title="Delete"
                              style={{ padding: '6px', borderRadius: 6, border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                            >
                              {actionLoading === admin.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <Pagination
            page={safePage}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
          />
        </div>

        {/* Rejection Reason Modal */}
        {rejectModal && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20
          }} onClick={() => { setRejectModal(null); setRejectionReason('') }}>
            <div style={{
              background: '#fff', borderRadius: 16, padding: 28, maxWidth: 480, width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.15)'
            }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <AlertCircle size={22} color="#ef4444" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Reject Company Admin</h3>
              </div>
              <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>
                Provide a reason for rejecting <strong>{rejectModal.admin.name}</strong> ({rejectModal.admin.email}).
              </p>
              <textarea
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
                placeholder="Enter rejection reason..."
                rows={3}
                style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button
                  onClick={() => { setRejectModal(null); setRejectionReason('') }}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={!rejectionReason.trim() || actionLoading === rejectModal.admin.id}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: rejectionReason.trim() ? '#ef4444' : '#e5e7eb', color: '#fff', fontSize: 13, fontWeight: 600, cursor: rejectionReason.trim() ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {actionLoading === rejectModal.admin.id && <Loader2 size={14} className="animate-spin" />}
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
