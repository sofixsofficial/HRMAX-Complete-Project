import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRightLeft, Search, CheckCircle, AlertCircle, X,
  Building2, Users, UserCheck, ChevronDown, ChevronLeft, ChevronRight,
  Loader2, FileText, Calendar
} from 'lucide-react'
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config'
import { Header } from '../components/Header'
import { useAuth } from '../context/AuthContext'
import { logAudit } from '../services/auditLogService'
import { createAdminAlert } from '../services/notificationService'
import './TransferManagement.css'

interface Executive {
  id: string
  name: string
  email: string
  executiveTitle: string
  isActive: boolean
  assignedCompanyIds: string[]
  assignedTeamLeaderIds: string[]
}

interface Company {
  id: string
  name: string
  code: string
  assignedExecutiveId: string | null
  assignedExecutiveName: string | null
}

interface TeamLeader {
  id: string
  name: string
  email: string
  reportingExecutiveId: string | null
  reportingExecutiveName: string | null
}

interface TransferLog {
  id: string
  sourceExecutiveId: string
  sourceExecutiveName: string
  destExecutiveId: string
  destExecutiveName: string
  transferredCompanies: { id: string; name: string }[]
  transferredTeamLeaders: { id: string; name: string }[]
  performedBy: string
  performedByName: string
  timestamp: Date
}

export function TransferManagement() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [executives, setExecutives] = useState<Executive[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [teamLeaders, setTeamLeaders] = useState<TeamLeader[]>([])
  const [transferLogs, setTransferLogs] = useState<TransferLog[]>([])
  const [searchTerm, setSearchTerm] = useState('')

  // Transfer state
  const [sourceExecutive, setSourceExecutive] = useState<Executive | null>(null)
  const [destExecutive, setDestExecutive] = useState<Executive | null>(null)
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const [selectedTeamLeaders, setSelectedTeamLeaders] = useState<string[]>([])
  const [isTransferring, setIsTransferring] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const [summary, setSummary] = useState<{ companies: number; teamLeaders: number } | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Dropdown state
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false)
  const [destDropdownOpen, setDestDropdownOpen] = useState(false)
  const [sourceSearch, setSourceSearch] = useState('')
  const [destSearch, setDestSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) } }, [toast])

  // Redirect non-master-admin
  useEffect(() => {
    if (user && user.role !== 'master-admin') {
      navigate('/unauthorized', { replace: true })
    }
  }, [user, navigate])

  // Fetch data
  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true)
      try {
        const [usersSnap, companiesSnap, logsSnap] = await Promise.all([
          getDocs(collection(db, 'users')),
          getDocs(collection(db, 'companies')),
          getDocs(collection(db, 'audit_logs')).catch(() => ({ docs: [] })),
        ])

        const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as any))
        const execs: Executive[] = allUsers
          .filter((u: any) => u.role === 'executive' && u.isActive !== false)
          .map((u: any) => ({
            id: u.id,
            name: u.name || '',
            email: u.email || '',
            executiveTitle: u.executiveTitle || '',
            isActive: u.isActive !== false,
            assignedCompanyIds: u.assignedCompanyIds || [],
            assignedTeamLeaderIds: u.assignedTeamLeaderIds || [],
          }))
        setExecutives(execs)

        const comps: Company[] = companiesSnap.docs.map(d => ({
          id: d.id,
          name: (d.data() as any).name || '',
          code: (d.data() as any).code || '',
          assignedExecutiveId: (d.data() as any).assignedExecutiveId || null,
          assignedExecutiveName: (d.data() as any).assignedExecutiveName || null,
        }))
        setCompanies(comps)

        const tls: TeamLeader[] = allUsers
          .filter((u: any) => u.role === 'team-leader' && u.isActive !== false)
          .map((u: any) => ({
            id: u.id,
            name: u.name || '',
            email: u.email || '',
            reportingExecutiveId: u.reportingExecutiveId || null,
            reportingExecutiveName: u.reportingExecutiveName || null,
          }))
        setTeamLeaders(tls)

        // Snapshot data is untyped DocumentData — the docs are transfer logs at runtime.
        const logs: TransferLog[] = (logsSnap.docs
          .map(d => ({
            id: d.id,
            ...d.data(),
            timestamp: (d.data() as any).timestamp?.toDate ? (d.data() as any).timestamp.toDate() : new Date(),
          })) as TransferLog[])
          .filter((l: any) => l.type === 'executive_transfer')
          .sort((a: any, b: any) => b.timestamp.getTime() - a.timestamp.getTime())
        setTransferLogs(logs)
      } catch (err) {
        console.error('Error fetching data:', err)
        setToast({ type: 'error', message: 'Failed to load data. Please try again.' })
      } finally {
        setLoading(false)
      }
    }

    if (user?.role === 'master-admin') {
      fetchAll()
    }
  }, [user])

  // Derived data
  const sourceCompanies = useMemo(() => {
    if (!sourceExecutive) return []
    return companies.filter(c => sourceExecutive.assignedCompanyIds.includes(c.id))
  }, [sourceExecutive, companies])

  const sourceTeamLeaders = useMemo(() => {
    if (!sourceExecutive) return []
    return teamLeaders.filter(tl => sourceExecutive.assignedTeamLeaderIds.includes(tl.id))
  }, [sourceExecutive, teamLeaders])

  const availableExecutives = useMemo(() => {
    return executives.filter(e => e.id !== sourceExecutive?.id && e.isActive)
  }, [executives, sourceExecutive])

  const filteredSourceExecs = useMemo(() => {
    if (!sourceSearch) return executives
    const q = sourceSearch.toLowerCase()
    return executives.filter(e => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q))
  }, [executives, sourceSearch])

  const filteredDestExecs = useMemo(() => {
    if (!destSearch) return availableExecutives
    const q = destSearch.toLowerCase()
    return availableExecutives.filter(e => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q))
  }, [availableExecutives, destSearch])

  const filteredLogs = useMemo(() => {
    if (!searchTerm) return transferLogs
    const q = searchTerm.toLowerCase()
    return transferLogs.filter(l =>
      l.sourceExecutiveName.toLowerCase().includes(q) ||
      l.destExecutiveName.toLowerCase().includes(q) ||
      l.performedByName.toLowerCase().includes(q)
    )
  }, [transferLogs, searchTerm])

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize))
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  // Handlers
  const handleSourceSelect = (exec: Executive) => {
    setSourceExecutive(exec)
    setSourceDropdownOpen(false)
    setSourceSearch('')
    setSelectedCompanies(exec.assignedCompanyIds)
    setSelectedTeamLeaders(exec.assignedTeamLeaderIds)
    setDestExecutive(null)
    setDestSearch('')
  }

  const handleDestSelect = (exec: Executive) => {
    setDestExecutive(exec)
    setDestDropdownOpen(false)
    setDestSearch('')
  }

  const toggleCompany = (id: string) => {
    setSelectedCompanies(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id])
  }

  const toggleTeamLeader = (id: string) => {
    setSelectedTeamLeaders(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  const toggleAllCompanies = () => {
    if (selectedCompanies.length === sourceCompanies.length) {
      setSelectedCompanies([])
    } else {
      setSelectedCompanies(sourceCompanies.map(c => c.id))
    }
  }

  const toggleAllTeamLeaders = () => {
    if (selectedTeamLeaders.length === sourceTeamLeaders.length) {
      setSelectedTeamLeaders([])
    } else {
      setSelectedTeamLeaders(sourceTeamLeaders.map(t => t.id))
    }
  }

  const handleTransfer = async () => {
    if (!sourceExecutive || !destExecutive) return
    if (selectedCompanies.length === 0 && selectedTeamLeaders.length === 0) return

    setIsTransferring(true)
    try {
      // Transfer companies
      const transferredCompanies: { id: string; name: string }[] = []
      for (const cId of selectedCompanies) {
        await updateDoc(doc(db, 'companies', cId), {
          assignedExecutiveId: destExecutive.id,
          assignedExecutiveName: destExecutive.name,
        })
        const comp = companies.find(c => c.id === cId)
        if (comp) transferredCompanies.push({ id: comp.id, name: comp.name })
      }

      // Transfer team leaders
      const transferredTeamLeaders: { id: string; name: string }[] = []
      for (const tlId of selectedTeamLeaders) {
        await updateDoc(doc(db, 'users', tlId), {
          reportingExecutiveId: destExecutive.id,
          reportingExecutiveName: destExecutive.name,
        })
        const tl = teamLeaders.find(t => t.id === tlId)
        if (tl) transferredTeamLeaders.push({ id: tl.id, name: tl.name })
      }

      // Update source executive's assignments
      const remainingCompanies = sourceExecutive.assignedCompanyIds.filter(id => !selectedCompanies.includes(id))
      const remainingTLs = sourceExecutive.assignedTeamLeaderIds.filter(id => !selectedTeamLeaders.includes(id))
      await updateDoc(doc(db, 'users', sourceExecutive.id), {
        assignedCompanyIds: remainingCompanies,
        assignedTeamLeaderIds: remainingTLs,
      })

      // Update destination executive's assignments
      const newDestCompanies = [...(destExecutive.assignedCompanyIds || []), ...selectedCompanies]
      const newDestTLs = [...(destExecutive.assignedTeamLeaderIds || []), ...selectedTeamLeaders]
      await updateDoc(doc(db, 'users', destExecutive.id), {
        assignedCompanyIds: newDestCompanies,
        assignedTeamLeaderIds: newDestTLs,
      })

      // Create audit log
      logAudit({
        userId: user?.id || '',
        userName: user?.name || 'Master Admin',
        userRole: user?.role || 'master-admin',
        action: `Transferred ${transferredCompanies.length} companies and ${transferredTeamLeaders.length} team leaders from ${sourceExecutive.name} to ${destExecutive.name}`,
        actionType: 'transfer',
        module: 'Transfer Management',
        targetEntity: `${sourceExecutive.name} → ${destExecutive.name}`,
        status: 'success',
        details: JSON.stringify({
          sourceExecutiveId: sourceExecutive.id,
          destExecutiveId: destExecutive.id,
          transferredCompanies: transferredCompanies.map(c => ({ id: c.id, name: c.name })),
          transferredTeamLeaders: transferredTeamLeaders.map(t => ({ id: t.id, name: t.name })),
        }),
      })

      createAdminAlert('transfer', 'Executive Transfer Completed', `${sourceExecutive.name} → ${destExecutive.name}: ${transferredCompanies.length} companies and ${transferredTeamLeaders.length} TL(s) transferred`, '/transfer-management', 'high', {
        actionBy: user?.id, actionByName: user?.name,
      })
      setSummary({ companies: transferredCompanies.length, teamLeaders: transferredTeamLeaders.length })
      setShowSummary(true)

      // Refresh data
      setExecutives(prev => prev.map(e => {
        if (e.id === sourceExecutive.id) {
          return { ...e, assignedCompanyIds: remainingCompanies, assignedTeamLeaderIds: remainingTLs }
        }
        if (e.id === destExecutive.id) {
          return { ...e, assignedCompanyIds: newDestCompanies, assignedTeamLeaderIds: newDestTLs }
        }
        return e
      }))
      setCompanies(prev => prev.map(c =>
        selectedCompanies.includes(c.id)
          ? { ...c, assignedExecutiveId: destExecutive.id, assignedExecutiveName: destExecutive.name }
          : c
      ))
      setTeamLeaders(prev => prev.map(tl =>
        selectedTeamLeaders.includes(tl.id)
          ? { ...tl, reportingExecutiveId: destExecutive.id, reportingExecutiveName: destExecutive.name }
          : tl
      ))

      setToast({ type: 'success', message: `Successfully transferred ${transferredCompanies.length} companies and ${transferredTeamLeaders.length} team leaders` })
    } catch (err: any) {
      const code = err?.code || ''
      if (code === 'permission-denied') {
        setToast({ type: 'error', message: 'Access denied: You do not have sufficient permissions to perform this transfer. Only Master Admins can execute transfers.' })
      } else if (code === 'not-found') {
        setToast({ type: 'error', message: 'Transfer failed: One or more records could not be found. The data may have been deleted.' })
      } else if (code === 'unavailable') {
        setToast({ type: 'error', message: 'Service temporarily unavailable. Please check your connection and try again.' })
      } else {
        setToast({ type: 'error', message: 'Failed to complete transfer. Please try again.' })
      }
    } finally {
      setIsTransferring(false)
    }
  }

  const resetTransfer = () => {
    setSourceExecutive(null)
    setDestExecutive(null)
    setSelectedCompanies([])
    setSelectedTeamLeaders([])
    setShowSummary(false)
    setSummary(null)
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Transfer Management" breadcrumbs={['Dashboard', 'Transfer Management']} />
        <div className="page-content">
          <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading transfer data...</p></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Transfer Management" breadcrumbs={['Dashboard', 'Transfer Management']} />

      <div className="page-content">
        {/* Toast */}
        {toast && (
          <div className={`tm-toast ${toast.type}`}>
            {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)}><X size={14} /></button>
          </div>
        )}

        {/* Stats */}
        <div className="tm-stats">
          <div className="tm-stat-card">
            <div className="tm-stat-icon" style={{ background: '#fff7ed', color: '#f97316' }}><Users size={24} /></div>
            <div className="tm-stat-info">
              <span className="tm-stat-label">Active Executives</span>
              <span className="tm-stat-value">{executives.length}</span>
            </div>
          </div>
          <div className="tm-stat-card">
            <div className="tm-stat-icon" style={{ background: '#dcfce7', color: '#16a34a' }}><Building2 size={24} /></div>
            <div className="tm-stat-info">
              <span className="tm-stat-label">Assigned Companies</span>
              <span className="tm-stat-value">{companies.filter(c => c.assignedExecutiveId).length}</span>
            </div>
          </div>
          <div className="tm-stat-card">
            <div className="tm-stat-icon" style={{ background: '#eff6ff', color: '#3b82f6' }}><UserCheck size={24} /></div>
            <div className="tm-stat-info">
              <span className="tm-stat-label">Team Leaders Assigned</span>
              <span className="tm-stat-value">{teamLeaders.filter(tl => tl.reportingExecutiveId).length}</span>
            </div>
          </div>
          <div className="tm-stat-card">
            <div className="tm-stat-icon" style={{ background: '#f5f3ff', color: '#8b5cf6' }}><FileText size={24} /></div>
            <div className="tm-stat-info">
              <span className="tm-stat-label">Transfers Logged</span>
              <span className="tm-stat-value">{transferLogs.length}</span>
            </div>
          </div>
        </div>

        {/* Transfer Workflow */}
        <div className="tm-workflow">
          <div className="tm-workflow-header">
            <ArrowRightLeft size={20} color="#f97316" />
            <h3>Transfer Responsibilities</h3>
            <p>Select the outgoing executive, choose a destination, and pick which entities to transfer.</p>
          </div>

          {/* Step 1: Source Executive */}
          <div className="tm-step">
            <div className="tm-step-header">
              <span className="tm-step-number">1</span>
              <h4>Select Outgoing Executive</h4>
            </div>
            <div className="tm-dropdown-wrapper">
              <div className="tm-dropdown-trigger" onClick={() => setSourceDropdownOpen(!sourceDropdownOpen)}>
                {sourceExecutive ? (
                  <div className="tm-selected-item">
                    <span className="tm-selected-name">{sourceExecutive.name}</span>
                    <span className="tm-selected-sub">{sourceExecutive.executiveTitle} · {sourceExecutive.email}</span>
                  </div>
                ) : (
                  <span className="tm-dropdown-placeholder">Search and select an executive to transfer from...</span>
                )}
                <ChevronDown size={16} className={`tm-chevron ${sourceDropdownOpen ? 'open' : ''}`} />
              </div>
              {sourceDropdownOpen && (
                <div className="tm-dropdown">
                  <input
                    type="text"
                    placeholder="Search executives..."
                    value={sourceSearch}
                    onChange={e => setSourceSearch(e.target.value)}
                    className="tm-dropdown-search"
                  />
                  <div className="tm-dropdown-list">
                    {filteredSourceExecs.length === 0 ? (
                      <div className="tm-dropdown-empty">No executives found</div>
                    ) : filteredSourceExecs.map(e => (
                      <div key={e.id} className="tm-dropdown-option" onClick={() => handleSourceSelect(e)}>
                        <div className="tm-option-avatar" style={{ background: '#fff7ed', color: '#f97316' }}>
                          {e.name.charAt(0)}
                        </div>
                        <div className="tm-option-info">
                          <span className="tm-option-name">{e.name}</span>
                          <span className="tm-option-sub">{e.executiveTitle} · {e.assignedCompanyIds.length} companies · {e.assignedTeamLeaderIds.length} team leaders</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Step 2: Destination Executive */}
          {sourceExecutive && (
            <div className="tm-step">
              <div className="tm-step-header">
                <span className="tm-step-number">2</span>
                <h4>Select New Executive</h4>
              </div>
              <div className="tm-dropdown-wrapper">
                <div className="tm-dropdown-trigger" onClick={() => setDestDropdownOpen(!destDropdownOpen)}>
                  {destExecutive ? (
                    <div className="tm-selected-item">
                      <span className="tm-selected-name">{destExecutive.name}</span>
                      <span className="tm-selected-sub">{destExecutive.executiveTitle} · {destExecutive.email}</span>
                    </div>
                  ) : (
                    <span className="tm-dropdown-placeholder">Search and select an executive to transfer to...</span>
                  )}
                  <ChevronDown size={16} className={`tm-chevron ${destDropdownOpen ? 'open' : ''}`} />
                </div>
                {destDropdownOpen && (
                  <div className="tm-dropdown">
                    <input
                      type="text"
                      placeholder="Search executives..."
                      value={destSearch}
                      onChange={e => setDestSearch(e.target.value)}
                      className="tm-dropdown-search"
                    />
                    <div className="tm-dropdown-list">
                      {filteredDestExecs.length === 0 ? (
                        <div className="tm-dropdown-empty">No other active executives available</div>
                      ) : filteredDestExecs.map(e => (
                        <div key={e.id} className="tm-dropdown-option" onClick={() => handleDestSelect(e)}>
                          <div className="tm-option-avatar" style={{ background: '#dcfce7', color: '#16a34a' }}>
                            {e.name.charAt(0)}
                          </div>
                          <div className="tm-option-info">
                            <span className="tm-option-name">{e.name}</span>
                            <span className="tm-option-sub">{e.executiveTitle} · {e.assignedCompanyIds.length} companies · {e.assignedTeamLeaderIds.length} team leaders</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Select Entities */}
          {sourceExecutive && destExecutive && (
            <div className="tm-step">
              <div className="tm-step-header">
                <span className="tm-step-number">3</span>
                <h4>Assign Affected Entities</h4>
              </div>

              <div className="tm-entities-grid">
                {/* Companies */}
                <div className="tm-entity-card">
                  <div className="tm-entity-header">
                    <div className="tm-entity-title">
                      <Building2 size={16} color="#f97316" />
                      <span>Companies ({sourceCompanies.length})</span>
                    </div>
                    <button type="button" className="tm-toggle-all" onClick={toggleAllCompanies}>
                      {selectedCompanies.length === sourceCompanies.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  {sourceCompanies.length === 0 ? (
                    <div className="tm-entity-empty">No companies assigned to this executive</div>
                  ) : (
                    <div className="tm-entity-list">
                      {sourceCompanies.map(c => (
                        <label key={c.id} className={`tm-entity-item ${selectedCompanies.includes(c.id) ? 'selected' : ''}`}>
                          <input type="checkbox" checked={selectedCompanies.includes(c.id)} onChange={() => toggleCompany(c.id)} />
                          <div className="tm-entity-info">
                            <span className="tm-entity-name">{c.name}</span>
                            <span className="tm-entity-sub">{c.code}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Team Leaders */}
                <div className="tm-entity-card">
                  <div className="tm-entity-header">
                    <div className="tm-entity-title">
                      <Users size={16} color="#3b82f6" />
                      <span>Team Leaders ({sourceTeamLeaders.length})</span>
                    </div>
                    <button type="button" className="tm-toggle-all" onClick={toggleAllTeamLeaders}>
                      {selectedTeamLeaders.length === sourceTeamLeaders.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  {sourceTeamLeaders.length === 0 ? (
                    <div className="tm-entity-empty">No team leaders assigned to this executive</div>
                  ) : (
                    <div className="tm-entity-list">
                      {sourceTeamLeaders.map(tl => (
                        <label key={tl.id} className={`tm-entity-item ${selectedTeamLeaders.includes(tl.id) ? 'selected' : ''}`}>
                          <input type="checkbox" checked={selectedTeamLeaders.includes(tl.id)} onChange={() => toggleTeamLeader(tl.id)} />
                          <div className="tm-entity-info">
                            <span className="tm-entity-name">{tl.name}</span>
                            <span className="tm-entity-sub">{tl.email}</span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Transfer Action */}
              <div className="tm-action-bar">
                <div className="tm-action-summary">
                  <span>Transferring:</span>
                  <span className="tm-action-count">{selectedCompanies.length} companies</span>
                  <span className="tm-action-count">{selectedTeamLeaders.length} team leaders</span>
                </div>
                <div className="tm-action-buttons">
                  <button className="tm-btn-secondary" onClick={resetTransfer}>Cancel</button>
                  <button
                    className="tm-btn-primary"
                    disabled={isTransferring || (selectedCompanies.length === 0 && selectedTeamLeaders.length === 0)}
                    onClick={handleTransfer}
                  >
                    {isTransferring ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={16} />}
                    {isTransferring ? 'Transferring...' : 'Confirm Transfer'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Audit Log Table */}
        <div className="tm-audit-section">
          <div className="tm-audit-header">
            <div className="tm-audit-title">
              <FileText size={18} color="#f97316" />
              <h3>Transfer Audit Log</h3>
            </div>
            <div className="tm-audit-search">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search by executive or admin name..."
                value={searchTerm}
                onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1) }}
              />
            </div>
          </div>

          <div className="tm-audit-table-wrapper">
            <table className="tm-audit-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Performed By</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Companies</th>
                  <th>Team Leaders</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="tm-audit-empty">
                      <FileText size={32} color="#d1d5db" />
                      <p>No transfer records found</p>
                    </td>
                  </tr>
                ) : paginatedLogs.map(log => (
                  <tr key={log.id}>
                    <td>
                      <div className="tm-audit-date">
                        <Calendar size={13} />
                        {log.timestamp.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td><span className="tm-audit-admin">{log.performedByName}</span></td>
                    <td>
                      <div className="tm-audit-exec">
                        <span className="tm-audit-exec-name">{log.sourceExecutiveName}</span>
                        <span className="tm-audit-exec-sub">Source</span>
                      </div>
                    </td>
                    <td>
                      <div className="tm-audit-exec">
                        <span className="tm-audit-exec-name">{log.destExecutiveName}</span>
                        <span className="tm-audit-exec-sub">Destination</span>
                      </div>
                    </td>
                    <td>
                      <span className="tm-audit-count">{log.transferredCompanies.length}</span>
                      {log.transferredCompanies.length > 0 && (
                        <div className="tm-audit-tooltip">
                          {log.transferredCompanies.map(c => c.name).join(', ')}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="tm-audit-count">{log.transferredTeamLeaders.length}</span>
                      {log.transferredTeamLeaders.length > 0 && (
                        <div className="tm-audit-tooltip">
                          {log.transferredTeamLeaders.map(tl => tl.name).join(', ')}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredLogs.length > pageSize && (
            <div className="tm-audit-pagination">
              <span>Showing {paginatedLogs.length} of {filteredLogs.length} entries</span>
              <div className="tm-audit-page-btns">
                <button className="tm-page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}><ChevronLeft size={14} /></button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} className={`tm-page-btn ${currentPage === p ? 'tm-page-btn-active' : ''}`} onClick={() => setCurrentPage(p)}>{p}</button>
                ))}
                <button className="tm-page-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}><ChevronRight size={14} /></button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Transfer Summary Modal */}
      {showSummary && summary && sourceExecutive && destExecutive && (
        <div className="tm-summary-overlay" onClick={() => setShowSummary(false)}>
          <div className="tm-summary-modal" onClick={e => e.stopPropagation()}>
            <div className="tm-summary-icon">
              <CheckCircle size={48} color="#16a34a" />
            </div>
            <h3>Transfer Complete</h3>
            <p>Responsibilities have been successfully transferred.</p>
            <div className="tm-summary-details">
              <div className="tm-summary-row">
                <span>From</span>
                <strong>{sourceExecutive.name}</strong>
              </div>
              <div className="tm-summary-row">
                <span>To</span>
                <strong>{destExecutive.name}</strong>
              </div>
              <div className="tm-summary-row">
                <span>Companies Transferred</span>
                <strong>{summary.companies}</strong>
              </div>
              <div className="tm-summary-row">
                <span>Team Leaders Transferred</span>
                <strong>{summary.teamLeaders}</strong>
              </div>
              <div className="tm-summary-row">
                <span>Performed By</span>
                <strong>{user?.name || 'Master Admin'}</strong>
              </div>
              <div className="tm-summary-row">
                <span>Date</span>
                <strong>{new Date().toLocaleString()}</strong>
              </div>
            </div>
            <button className="tm-summary-btn" onClick={() => { setShowSummary(false); resetTransfer() }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
