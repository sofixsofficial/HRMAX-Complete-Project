import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Users, UserPlus, Search, Copy, Check, X, Loader2, Shield, ShieldCheck, Mail, Clock, Link as LinkIcon, AlertCircle, Crown } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getAllUsers, updateUserRole, inviteUser, updateUserPermissions } from '../services/authService'
import { getPendingInvitations, cancelInvitation, type Invitation } from '../services/invitationService'
import { getDepartmentsByCompany, getAllDepartments } from '../services/departmentService'
import { getAllEmployees, getEmployeesByCompany } from '../services/employeeService'
import { Header } from '../components/Header'
import { Pagination } from '../components/Pagination'
import { logAudit } from '../services/auditLogService'
import {
  CORE_CRUD_ACTIONS, CORE_CRUD_CONFIG, coreModulesForRole, coreKeysForRole,
  totalCoreKeys, isCoreCrudRole, initialCoreEnabled, buildCorePermissionsArray,
} from '../services/permissionConfig'
import type { User, UserRole, Department, Employee } from '../types/user'
import './AccessManagement.css'

const INVITE_ROLE_OPTIONS: { value: UserRole; label: string; color: string }[] = [
  { value: 'team-leader', label: 'Team Leader', color: '#10b981' },
  { value: 'executive', label: 'Executive', color: '#f59e0b' },
  { value: 'employee', label: 'Employee', color: '#6366f1' },
]

const ROLE_DISPLAY: Record<UserRole, { label: string; color: string; bg: string }> = {
  'master-admin': { label: 'Master Admin', color: '#ef4444', bg: '#fef2f2' },
  'company-admin': { label: 'Company Admin', color: '#3b82f6', bg: '#eff6ff' },
  'team-leader': { label: 'Team Leader', color: '#10b981', bg: '#f0fdf4' },
  'executive': { label: 'Executive', color: '#f59e0b', bg: '#fffbeb' },
  'reporting-manager': { label: 'Reporting Manager', color: '#8b5cf6', bg: '#f5f3ff' },
  'employee': { label: 'Employee', color: '#6366f1', bg: '#eef2ff' },
}

export function AccessManagement() {
  const { user, hasRole } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const isMasterAdmin = hasRole(['master-admin'])

  const [activeTab, setActiveTab] = useState<'users' | 'invitations'>('users')
  const [users, setUsers] = useState<User[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterRole, setFilterRole] = useState<UserRole | null>(searchParams.get('role') as UserRole | null)

  // Users table pagination (client-side)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Modal state
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', name: '', role: 'executive' as UserRole, departmentId: '', employeeId: '' })
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [isInviting, setIsInviting] = useState(false)

  // Role change state
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [newRole, setNewRole] = useState<UserRole>('executive')
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false)
  const [isUpdatingRole, setIsUpdatingRole] = useState(false)

  // Permission editor state (core CRUD)
  const [permUser, setPermUser] = useState<User | null>(null)
  const [permRole, setPermRole] = useState<'team-leader' | 'executive'>('team-leader')
  const [coreEnabled, setCoreEnabled] = useState<Record<string, boolean>>({})
  const [permDirty, setPermDirty] = useState(false)
  const [isSavingPerms, setIsSavingPerms] = useState(false)
  const [permError, setPermError] = useState('')
  const [permSuccess, setPermSuccess] = useState('')
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch users
      const usersData = await getAllUsers()
      setUsers(usersData)

      // Fetch invitations
      const companyId = user?.companyId || undefined
      const invitesData = await getPendingInvitations(companyId)
      setInvitations(invitesData)

      // Fetch departments
      let depts: Department[]
      if (isMasterAdmin) {
        depts = await getAllDepartments()
      } else if (user?.companyId) {
        depts = await getDepartmentsByCompany(user.companyId)
      } else {
        depts = []
      }
      setDepartments(depts)

      // Fetch employees
      let emps: Employee[]
      if (isMasterAdmin) {
        emps = await getAllEmployees()
      } else if (user?.companyId) {
        emps = await getEmployeesByCompany(user.companyId)
      } else {
        emps = []
      }
      setEmployees(emps)
    } catch (err) {
      console.error('Error fetching access data:', err)
    } finally {
      setLoading(false)
    }
  }, [user?.companyId, isMasterAdmin])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Reset to the first page whenever the search term or role filter changes.
  useEffect(() => {
    setPage(1)
  }, [searchTerm, filterRole])

  const teamLeaderCount = users.filter(u => u.role === 'team-leader').length

  const filteredUsers = users.filter(u => {
    if (filterRole && u.role !== filterRole) return false
    const term = searchTerm.toLowerCase()
    return (
      u.name.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term) ||
      u.role.toLowerCase().includes(term)
    )
  })

  const filteredInvitations = invitations.filter(inv => {
    const term = searchTerm.toLowerCase()
    return (
      inv.email.toLowerCase().includes(term) ||
      inv.name.toLowerCase().includes(term) ||
      inv.role.toLowerCase().includes(term)
    )
  })

  const safePage = Math.min(page, Math.max(1, Math.ceil(filteredUsers.length / pageSize)))
  const pagedUsers = filteredUsers.slice((safePage - 1) * pageSize, safePage * pageSize)

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteError('')
    setInviteSuccess('')
    setInviteLink('')
    
    if (!inviteForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteForm.email)) {
      setInviteError('Please enter a valid email address')
      return
    }
    if (!inviteForm.name.trim()) {
      setInviteError('Full name is required')
      return
    }
    
    setIsInviting(true)
    try {
      const result = await inviteUser(
        inviteForm.email,
        inviteForm.role,
        inviteForm.name,
        inviteForm.departmentId || undefined,
        inviteForm.employeeId || undefined
      )
      setInviteSuccess(`Invitation sent to ${inviteForm.email}`)
      setInviteLink(result.inviteLink)
      setInviteForm({ email: '', name: '', role: 'executive', departmentId: '', employeeId: '' })
      await fetchData()
    } catch (err: any) {
      setInviteError(err.message || 'Failed to send invitation')
    } finally {
      setIsInviting(false)
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
    } catch {
      // Fallback
    }
  }

  const handleCancelInvite = async (inviteId: string) => {
    if (!window.confirm('Are you sure you want to cancel this invitation?')) return
    try {
      await cancelInvitation(inviteId)
      await fetchData()
    } catch (err: any) {
      alert(err.message || 'Failed to cancel invitation')
    }
  }

  const openRoleModal = (u: User) => {
    setSelectedUser(u)
    setNewRole(u.role)
    setIsRoleModalOpen(true)
  }

  const handleUpdateRole = async () => {
    if (!selectedUser) return
    setIsUpdatingRole(true)
    try {
      await updateUserRole(selectedUser.id, newRole)
      setIsRoleModalOpen(false)
      await fetchData()
    } catch (err: any) {
      alert(err.message || 'Failed to update role')
    } finally {
      setIsUpdatingRole(false)
    }
  }

  // ─── Core CRUD permission editor ─────────────────────────────
  const openPermissionEditor = (u: User) => {
    const role: 'team-leader' | 'executive' = u.role === 'executive' ? 'executive' : 'team-leader'
    setPermRole(role)
    setPermUser(u)
    setCoreEnabled(initialCoreEnabled(role, u.permissions, u.permissionsConfigured === true))
    setPermDirty(false)
    setAutoSaveState('idle')
    setPermError('')
    setPermSuccess('')
    setIsSavingPerms(false)
  }

  const closePermissionEditor = () => {
    if (isSavingPerms) return
    if (permDirty && !window.confirm('You have unsaved permission changes. Discard them?')) return
    setPermUser(null)
  }

  const markPermsDirty = () => setPermDirty(true)

  const togglePerm = (key: string) => {
    setCoreEnabled(m => ({ ...m, [key]: !m[key] }))
    markPermsDirty()
  }

  const toggleModuleAll = (modKey: string, val: boolean) => {
    setCoreEnabled(m => {
      const next = { ...m }
      coreKeysForRole(permRole).filter(k => k.startsWith(`${modKey}.`)).forEach(k => { next[k] = val })
      return next
    })
    markPermsDirty()
  }

  const grantAllCore = () => {
    setCoreEnabled(m => {
      const next = { ...m }
      coreKeysForRole(permRole).forEach(k => { next[k] = true })
      return next
    })
    markPermsDirty()
  }

  const clearAllCore = () => {
    setCoreEnabled(m => {
      const next = { ...m }
      coreKeysForRole(permRole).forEach(k => { next[k] = false })
      return next
    })
    markPermsDirty()
  }

  const enabledCoreCount = coreKeysForRole(permRole).filter(k => coreEnabled[k]).length

  /**
   * Persist the core CRUD matrix to Firestore. The stored array keeps every
   * existing non-core grant, so restricting the core modules never regresses
   * the rest of the app. Autosave (debounced below) fires on every toggle so
   * the rules are enforced immediately; the explicit Save button flushes + audits.
   */
  const persistPermissions = useCallback(async (
    enabled: Record<string, boolean>,
    silent: boolean
  ): Promise<boolean> => {
    if (!permUser) return false
    if (!silent) setIsSavingPerms(true)
    setPermError('')
    setPermSuccess('')
    try {
      const arr = buildCorePermissionsArray(permRole, enabled, permUser.permissions)
      await updateUserPermissions(permUser.id, arr)
      const enabledCount = coreKeysForRole(permRole).filter(k => enabled[k]).length
      if (!silent) {
        try {
          await logAudit({
            userId: user?.id || '',
            userName: user?.name || '',
            userRole: user?.role || 'master-admin',
            action: `Updated permissions for ${permUser.name}`,
            actionType: 'update',
            module: 'Access Management',
            targetEntity: permUser.name,
            targetId: permUser.id,
            status: 'success',
            details: `${enabledCount} of ${totalCoreKeys(permRole)} core permissions enabled`,
          })
        } catch { /* audit is best-effort */ }
      }
      setPermSuccess('Permissions saved. They are enforced immediately.')
      await fetchData()
      return true
    } catch (err: any) {
      setPermError(err.message || 'Failed to save permissions')
      return false
    } finally {
      if (!silent) setIsSavingPerms(false)
    }
  }, [permUser, permRole, user?.id, user?.name, user?.role, fetchData])

  useEffect(() => {
    if (!permUser || !permDirty) return
    setAutoSaveState('dirty')
    const t = setTimeout(async () => {
      setAutoSaveState('saving')
      const ok = await persistPermissions(coreEnabled, true)
      if (ok) {
        setPermDirty(false)
        setAutoSaveState('saved')
      } else {
        setAutoSaveState('idle')
      }
    }, 700)
    return () => clearTimeout(t)
  }, [coreEnabled, permDirty, permUser, persistPermissions])

  const handleSavePermissions = async () => {
    if (!permUser) return
    const ok = await persistPermissions(coreEnabled, false)
    if (ok) setPermDirty(false)
  }

  const activeCount = users.filter(u => u.isActive !== false).length
  const pendingCount = invitations.length

  // Employees who don't have a Firebase auth account yet and aren't already invited
  const invitedEmails = new Set(invitations.map(inv => inv.email.toLowerCase()))
  const existingEmails = new Set(users.map(u => u.email.toLowerCase()))
  const eligibleEmployees = employees.filter(emp =>
    !emp.userId &&
    emp.email &&
    !existingEmails.has(emp.email.toLowerCase()) &&
    !invitedEmails.has(emp.email.toLowerCase())
  )

  const handleSelectEmployee = (employeeId: string) => {
    if (!employeeId) {
      setInviteForm(prev => ({ ...prev, employeeId: '', name: '', email: '', departmentId: '' }))
      return
    }
    const emp = employees.find(e => e.id === employeeId)
    if (emp) {
      setInviteForm(prev => ({
        ...prev,
        employeeId: emp.id,
        name: emp.name || '',
        email: emp.email || '',
        departmentId: emp.departmentId || ''
      }))
    }
  }

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ color: '#6b7280' }}>Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="User Access Management" breadcrumbs={['Dashboard', 'Access Management']} />
      <div className="page-content">

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div
          className="stat-card cursor-pointer transition-all duration-200 hover:shadow-md active:scale-[0.98]"
          style={{ borderColor: filterRole === null ? '#3b82f6' : undefined, boxShadow: filterRole === null ? '0 0 0 2px #3b82f6' : undefined }}
          onClick={() => { setFilterRole(null); setSearchParams(prev => { prev.delete('role'); return prev }) }}
        >
          <div className="stat-icon" style={{ background: '#eff6ff', color: '#3b82f6' }}>
            <Users size={24} />
          </div>
          <div className="stat-info">
            <h3>{users.length}</h3>
            <span>Total Users</span>
          </div>
        </div>
        <div
          className="stat-card cursor-pointer transition-all duration-200 hover:shadow-md active:scale-[0.98]"
          style={{ borderColor: filterRole === null ? '#3b82f6' : undefined, boxShadow: filterRole === null ? '0 0 0 2px #3b82f6' : undefined }}
          onClick={() => { setFilterRole(null); setSearchParams(prev => { prev.delete('role'); return prev }) }}
        >
          <div className="stat-icon" style={{ background: '#f0fdf4', color: '#10b981' }}>
            <Shield size={24} />
          </div>
          <div className="stat-info">
            <h3>{activeCount}</h3>
            <span>Active Users</span>
          </div>
        </div>
        <div
          className="stat-card cursor-pointer transition-all duration-200 hover:shadow-md active:scale-[0.98]"
          style={{ borderColor: filterRole === 'team-leader' ? '#10b981' : undefined, boxShadow: filterRole === 'team-leader' ? '0 0 0 2px #10b981' : undefined }}
          onClick={() => { setFilterRole('team-leader'); setSearchParams(prev => { prev.set('role', 'team-leader'); return prev }) }}
        >
          <div className="stat-icon" style={{ background: '#f0fdf4', color: '#10b981' }}>
            <Crown size={24} />
          </div>
          <div className="stat-info">
            <h3>{teamLeaderCount}</h3>
            <span>Team Leaders</span>
          </div>
        </div>
        <div
          className="stat-card cursor-pointer transition-all duration-200 hover:shadow-md active:scale-[0.98]"
          style={{ borderColor: filterRole === null ? '#3b82f6' : undefined, boxShadow: filterRole === null ? '0 0 0 2px #3b82f6' : undefined }}
          onClick={() => { setFilterRole(null); setSearchParams(prev => { prev.delete('role'); return prev }) }}
        >
          <div className="stat-icon" style={{ background: '#fffbeb', color: '#f59e0b' }}>
            <Mail size={24} />
          </div>
          <div className="stat-info">
            <h3>{pendingCount}</h3>
            <span>Pending Invitations</span>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="access-toolbar">
        <div className="section-tabs">
          <button
            className={`section-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            Users ({filteredUsers.length})
          </button>
          <button
            className={`section-tab ${activeTab === 'invitations' ? 'active' : ''}`}
            onClick={() => setActiveTab('invitations')}
          >
            Invitations ({filteredInvitations.length})
          </button>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: 1, justifyContent: 'flex-end' }}>
          <div className="access-search">
            <Search size={16} style={{ color: '#9ca3af' }} />
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {isMasterAdmin && (
            <button className="btn-primary" onClick={() => setIsInviteModalOpen(true)}>
              <UserPlus size={16} />
              Invite User
            </button>
          )}
        </div>
      </div>

      {/* Users Table */}
      {activeTab === 'users' && (
        <div className="table-card">
          <div className="table-header">
            <h3>Users</h3>
            <span>{filteredUsers.length} total</span>
          </div>
          {filteredUsers.length === 0 ? (
            <div className="empty-state">
              <Users size={48} style={{ color: '#d1d5db' }} />
              <p>No users found</p>
            </div>
          ) : (
            <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Status</th>
                  {isMasterAdmin && <th style={{ width: '120px' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {pagedUsers.map(u => {
                  const roleDisplay = ROLE_DISPLAY[u.role] || ROLE_DISPLAY.executive
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="user-info">
                          <span className="user-name">{u.name}</span>
                          <span className="user-email">{u.email}</span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                          <span className="role-badge" style={{ background: roleDisplay.bg, color: roleDisplay.color }}>
                            {roleDisplay.label}
                          </span>
                          {(u.role === 'team-leader' || u.role === 'executive') && (
                            <span className="perm-count-badge" title={u.permissionsConfigured ? 'Configured via Access Management' : `Default: ${CORE_CRUD_CONFIG[u.role as 'team-leader' | 'executive'].description}`}>
                              {u.permissionsConfigured
                                ? `${coreKeysForRole(u.role).filter(k => u.permissions?.includes(k)).length} / ${totalCoreKeys(u.role)} core`
                                : 'Full core CRUD'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        {u.departmentId
                          ? departments.find(d => d.id === u.departmentId)?.name || '—'
                          : '—'
                        }
                      </td>
                      <td>
                        <span className={`status-badge ${u.isActive !== false ? 'status-active' : 'status-inactive'}`}>
                          {u.isActive !== false ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {isMasterAdmin && (
                        <td>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                            <button className="btn-secondary btn-sm" onClick={() => openRoleModal(u)}>
                              Change Role
                            </button>
                            {(u.role === 'team-leader' || u.role === 'executive') && (
                              <button
                                className="btn-secondary btn-sm perm-manage-btn"
                                onClick={() => openPermissionEditor(u)}
                                title="Edit permission matrix"
                              >
                                <ShieldCheck size={14} />
                                Permissions
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Pagination
              page={safePage}
              pageSize={pageSize}
              total={filteredUsers.length}
              onPageChange={setPage}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
            />
            </>
          )}
        </div>
      )}

      {/* Invitations Table */}
      {activeTab === 'invitations' && (
        <div className="table-card">
          <div className="table-header">
            <h3>Pending Invitations</h3>
            <span>{filteredInvitations.length} pending</span>
          </div>
          {filteredInvitations.length === 0 ? (
            <div className="empty-state">
              <Mail size={48} style={{ color: '#d1d5db' }} />
              <p>No pending invitations</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invitee</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Invited By</th>
                  <th>Expires</th>
                  <th style={{ width: '200px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvitations.map(inv => {
                  const roleDisplay = ROLE_DISPLAY[inv.role as UserRole] || ROLE_DISPLAY.executive
                  const expiresAt = inv.expiresAt?.toDate ? inv.expiresAt.toDate() : null
                  const isExpiringSoon = expiresAt && (expiresAt.getTime() - Date.now()) < 24 * 60 * 60 * 1000
                  return (
                    <tr key={inv.id}>
                      <td>
                        <div className="user-info">
                          <span className="user-name">{inv.name || '—'}</span>
                          <span className="user-email">{inv.email}</span>
                        </div>
                      </td>
                      <td>
                        <span className="role-badge" style={{ background: roleDisplay.bg, color: roleDisplay.color }}>
                          {roleDisplay.label}
                        </span>
                      </td>
                      <td>
                        {inv.departmentId
                          ? departments.find(d => d.id === inv.departmentId)?.name || '—'
                          : '—'
                        }
                      </td>
                      <td>{inv.invitedByName || '—'}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Clock size={14} style={{ color: isExpiringSoon ? '#ef4444' : '#6b7280' }} />
                          <span style={{ fontSize: '13px', color: isExpiringSoon ? '#ef4444' : '#374151' }}>
                            {expiresAt ? expiresAt.toLocaleDateString() : '—'}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            className="btn-secondary btn-sm"
                            onClick={async () => {
                              const link = `${window.location.origin}/accept-invite?token=${inv.token}`
                              try {
                                await navigator.clipboard.writeText(link)
                                alert('Invite link copied to clipboard!')
                              } catch {
                                alert(link)
                              }
                            }}
                          >
                            <LinkIcon size={14} />
                            Copy Link
                          </button>
                          <button className="btn-danger" onClick={() => handleCancelInvite(inv.id)}>
                            <X size={14} />
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Invite Modal */}
      {isInviteModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-3 sm:p-4" onClick={() => setIsInviteModalOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm sm:max-w-lg md:max-w-xl mx-auto max-h-[90vh] overflow-y-auto p-4 sm:p-6 md:p-8 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Invite User</h2>
              <button className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" onClick={() => setIsInviteModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            {inviteError && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">{inviteError}</div>}
            {inviteSuccess && <div className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-lg text-sm mb-4">{inviteSuccess}</div>}

            {inviteLink && (
              <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
                <LinkIcon size={16} className="shrink-0 text-blue-600" />
                <input type="text" value={inviteLink} readOnly className="flex-1 text-sm bg-transparent border-none outline-none text-gray-700" />
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap" onClick={handleCopyLink}>
                  <Copy size={14} />
                  Copy
                </button>
              </div>
            )}

            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Select Employee *</label>
                <select
                  value={inviteForm.employeeId}
                  onChange={(e) => handleSelectEmployee(e.target.value)}
                  required={!inviteForm.name || !inviteForm.email}
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-xl bg-white text-gray-900 outline-none focus:border-blue-500 focus:ring-[3px] focus:ring-blue-100 transition-all appearance-none cursor-pointer"
                >
                  <option value="">— Add Manually —</option>
                  {eligibleEmployees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.email})
                    </option>
                  ))}
                  {eligibleEmployees.length === 0 && employees.length > 0 && (
                    <option value="" disabled>— All employees already invited —</option>
                  )}
                </select>
                {eligibleEmployees.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                    <AlertCircle size={12} />
                    {employees.length === 0
                      ? 'No employees found. Add employees first or enter details manually.'
                      : 'All eligible employees have been invited. Add more employees or enter details manually.'}
                  </p>
                )}
              </div>

              {inviteForm.employeeId ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
                    <input type="text" value={inviteForm.name} disabled className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
                    <input type="email" value={inviteForm.email} disabled className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 text-gray-500 outline-none" />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name *</label>
                    <input
                      type="text"
                      value={inviteForm.name}
                      onChange={(e) => setInviteForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="John Doe"
                      required={!inviteForm.employeeId}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-xl bg-white text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-[3px] focus:ring-blue-100 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address *</label>
                    <input
                      type="email"
                      value={inviteForm.email}
                      onChange={(e) => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="john@company.com"
                      required={!inviteForm.employeeId}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-xl bg-white text-gray-900 placeholder-gray-400 outline-none focus:border-blue-500 focus:ring-[3px] focus:ring-blue-100 transition-all"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Role *</label>
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm(prev => ({ ...prev, role: e.target.value as UserRole }))}
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-xl bg-white text-gray-900 outline-none focus:border-blue-500 focus:ring-[3px] focus:ring-blue-100 transition-all appearance-none cursor-pointer"
                >
                  {INVITE_ROLE_OPTIONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Department (optional)</label>
                <select
                  value={inviteForm.departmentId}
                  onChange={(e) => setInviteForm(prev => ({ ...prev, departmentId: e.target.value }))}
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-xl bg-white text-gray-900 outline-none focus:border-blue-500 focus:ring-[3px] focus:ring-blue-100 transition-all appearance-none cursor-pointer"
                >
                  <option value="">— Select Department —</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                {departments.length === 0 && (
                  <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                    <AlertCircle size={12} />
                    No departments available. Create departments first under Organization settings.
                  </p>
                )}
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-2">
                <button type="button" className="w-full sm:w-auto px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors" onClick={() => setIsInviteModalOpen(false)}>
                  Close
                </button>
                <button type="submit" className="w-full sm:w-auto px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed" disabled={isInviting}>
                  {isInviting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      Send Invite
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Role Change Modal */}
      {isRoleModalOpen && selectedUser && (
        <div className="access-modal-overlay" onClick={() => setIsRoleModalOpen(false)}>
          <div className="access-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="access-modal-header">
              <h2>Change User Role</h2>
              <button className="access-modal-close" onClick={() => setIsRoleModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <p style={{ marginBottom: '16px', color: '#374151', fontSize: '14px' }}>
              Changing role for <strong>{selectedUser.name}</strong> ({selectedUser.email})
            </p>

            <div className="form-group">
              <label>New Role</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
              >
                {Object.entries(ROLE_DISPLAY).map(([value, display]) => (
                  <option key={value} value={value}>{display.label}</option>
                ))}
              </select>
            </div>

            <div className="access-modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setIsRoleModalOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleUpdateRole} disabled={isUpdatingRole}>
                {isUpdatingRole ? (
                  <>
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    Updating...
                  </>
                ) : (
                  'Update Role'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

{/* Core CRUD Permission Editor Modal */}
      {permUser && (
        <div className="perm-modal-overlay" onClick={closePermissionEditor}>
          <div className="perm-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="perm-modal-header">
              <div>
                <h2>Core Access — {CORE_CRUD_CONFIG[permRole].label}</h2>
                <p className="perm-modal-sub">
                  Configure <strong>{permUser.name}</strong> ({permUser.email})
                </p>
              </div>
              <button className="access-modal-close" onClick={closePermissionEditor}>
                <X size={20} />
              </button>
            </div>

            <span className="perm-scope-note">
              <Shield size={13} />
              {CORE_CRUD_CONFIG[permRole].description}
              &nbsp;Every action is granted by default and can be switched off below.
            </span>

            <div className="perm-toolbar">
              <div className="perm-toolbar-actions" style={{ justifyContent: 'flex-end' }}>
                <span className="perm-enabled-chip">
                  <ShieldCheck size={14} />
                  {enabledCoreCount} / {totalCoreKeys(permRole)} enabled
                </span>
                {autoSaveState !== 'idle' && (
                  <span className={`perm-autosave-chip ${autoSaveState}`}>
                    {autoSaveState === 'saving'
                      ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                      : <Check size={12} />}
                    {autoSaveState === 'dirty' ? 'Unsaved changes…' : autoSaveState === 'saving' ? 'Saving…' : 'Saved to Firestore'}
                  </span>
                )}
                <button type="button" className="btn-secondary btn-sm" onClick={grantAllCore}>Grant All</button>
                <button type="button" className="btn-secondary btn-sm" onClick={clearAllCore}>Clear All</button>
              </div>
            </div>

            {permError && <div className="form-error">{permError}</div>}
            {permSuccess && <div className="form-success">{permSuccess}</div>}

            <div className="perm-matrix-wrap">
              <table className="perm-matrix">
                <thead>
                  <tr>
                    <th className="perm-col-module">Module</th>
                    {CORE_CRUD_ACTIONS.map(a => (
                      <th key={a} className="perm-col-action">{a.charAt(0).toUpperCase() + a.slice(1)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coreModulesForRole(permRole).map(mod => {
                    const ModIcon = mod.icon
                    const modKeys = CORE_CRUD_ACTIONS.map(a => `${mod.key}.${a}`)
                    const moduleAllOn = modKeys.every(k => !!coreEnabled[k])
                    const modEnabled = modKeys.filter(k => !!coreEnabled[k]).length
                    return (
                      <tr key={mod.key} className="perm-mod-row">
                        <td className="perm-td-module">
                          <div className="perm-mod-name">
                            <input
                              type="checkbox"
                              className="perm-mod-check"
                              checked={moduleAllOn}
                              onChange={(e) => toggleModuleAll(mod.key, e.target.checked)}
                              title={moduleAllOn ? `Clear all actions in ${mod.label}` : `Select all actions in ${mod.label}`}
                            />
                            <ModIcon size={15} style={{ color: mod.color }} />
                            <span className="perm-mod-label">{mod.label}</span>
                            <span className="perm-mod-count">{modEnabled}/{modKeys.length}</span>
                          </div>
                        </td>
                        {CORE_CRUD_ACTIONS.map(action => {
                          const key = `${mod.key}.${action}`
                          const actionLabel = action.charAt(0).toUpperCase() + action.slice(1)
                          return (
                            <td key={action} className="perm-cell">
                              <input
                                type="checkbox"
                                className="perm-box"
                                checked={!!coreEnabled[key]}
                                onChange={() => togglePerm(key)}
                                title={`${mod.label}: ${actionLabel}`}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="perm-modal-footer">
              <button type="button" className="btn-secondary" onClick={closePermissionEditor} disabled={isSavingPerms}>
                {permDirty ? 'Discard Changes' : 'Close'}
              </button>
              <button type="button" className="btn-primary" onClick={handleSavePermissions} disabled={isSavingPerms}>
                {isSavingPerms ? (
                  <>
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    Save Permissions
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
