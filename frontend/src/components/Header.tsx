import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Menu, Loader2, Users, Ticket, FileText, ArrowRight, Building2, ChevronDown, Lock, Globe, Clock3, CalendarDays, MapPin } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, getDocs, limit } from 'firebase/firestore'
import { db } from '../config/firebase'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { useAccessControl } from '../context/AccessControlContext'
import { useSidebar } from '../context/SidebarContext'
import { useCompanyStore } from '../store/companyStore'
import { useClock } from '../context/ClockContext'
import { NotificationBell } from './NotificationBell'
import { roleDepartmentLabel } from '../utils/roleLabels'
import './Header.css'

interface HeaderProps {
  title: string;
  breadcrumbs?: string[];
}

interface SearchResult {
  id: string
  label: string
  sublabel: string
  path: string
  category: string
}

export function Header({ title, breadcrumbs = [] }: HeaderProps) {
  const { user } = useAuth()
  const { selectedCompanyId, setSelectedCompanyId, availableCompanies, isCompanyRestricted, selectedCompanyName, effectiveCompanyId, isLoading } = useCompany()
  const { isViewOnly } = useAccessControl()
  const { toggle } = useSidebar()
  const navigate = useNavigate()
  // Shared clock context — SAME time source as the dashboard hero, so the
  // header and hero never disagree. Also carries the live place (location +
  // temperature) for the meta strip.
  const { time, dateShort, greeting, location, tempC } = useClock()

  // Sync CompanyContext → Zustand store (services can read from store directly)
  const syncStore = useCompanyStore.getState()
  useEffect(() => {
    if (syncStore.activeCompanyId !== selectedCompanyId) {
      useCompanyStore.getState().setActiveCompany(selectedCompanyId || '', selectedCompanyName || undefined)
    }
    const storeCompIds = useCompanyStore.getState().availableCompanies.map(c => c.id).sort().join(',')
    const ctxCompIds = availableCompanies.map(c => c.id).sort().join(',')
    if (storeCompIds !== ctxCompIds) {
      useCompanyStore.getState().setAvailableCompanies(availableCompanies)
    }
    useCompanyStore.getState().setScopeReady(!!selectedCompanyId)
  }, [selectedCompanyId, selectedCompanyName, availableCompanies])

  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const companyRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const selectedCompany = availableCompanies.find(c => c.id === selectedCompanyId)

  // Close company dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (companyRef.current && !companyRef.current.contains(e.target as Node)) {
        setShowCompanyDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const runSearch = useCallback(async (term: string) => {
    if (!term.trim() || !selectedCompanyId) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }
    setSearchLoading(true)
    const t = term.toLowerCase()
    const cid = selectedCompanyId
    const results: SearchResult[] = []

    try {
      const empQ = query(collection(db, 'employees'), where('companyId', '==', cid), limit(10))
      const empSnap = await getDocs(empQ)
      empSnap.forEach(d => {
        const data = d.data()
        if ((data.name?.toLowerCase()?.includes(t) || data.email?.toLowerCase()?.includes(t))) {
          results.push({ id: d.id, label: data.name || 'Unnamed', sublabel: data.email || data.department || '', path: '/employees', category: 'Employees' })
        }
      })

      const tixQ = query(collection(db, 'tickets'), where('companyId', '==', cid), limit(10))
      const tixSnap = await getDocs(tixQ)
      tixSnap.forEach(d => {
        const data = d.data()
        if (data.title?.toLowerCase()?.includes(t)) {
          results.push({ id: d.id, label: data.title, sublabel: `${data.priority || ''} · ${data.status || ''}`, path: '/support-tickets', category: 'Tickets' })
        }
      })

      const annQ = query(collection(db, 'announcements'), where('companyId', '==', cid), limit(10))
      const annSnap = await getDocs(annQ)
      annSnap.forEach(d => {
        const data = d.data()
        if (data.title?.toLowerCase()?.includes(t)) {
          results.push({ id: d.id, label: data.title, sublabel: data.category || '', path: '/announcements', category: 'Announcements' })
        }
      })
    } catch (err) {
      console.error('Search error:', err)
    }

    setSearchResults(results.slice(0, 15))
    setShowDropdown(results.length > 0)
    setSearchLoading(false)
  }, [selectedCompanyId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!searchTerm.trim()) {
      setSearchResults([])
      setShowDropdown(false)
      return
    }
    debounceRef.current = setTimeout(() => runSearch(searchTerm), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchTerm, runSearch])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleResultClick = (result: SearchResult) => {
    setShowDropdown(false)
    setSearchTerm('')
    navigate(result.path)
  }

  const groupedResults = searchResults.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.category]) acc[r.category] = []
    acc[r.category].push(r)
    return acc
  }, {})

  return (
    <header className="header">
      <div className="header-left">
        <button className="menu-btn" onClick={toggle} title="Toggle sidebar">
          <Menu size={20} />
        </button>
        <div className="header-title">
          <h2>{title}</h2>
          {breadcrumbs.length > 0 && (
            <div className="breadcrumbs">
              {breadcrumbs.map((crumb, idx) => (
                <span key={idx}>
                  {idx > 0 && <span className="breadcrumb-separator">&gt;</span>}
                  <span className={idx === breadcrumbs.length - 1 ? 'breadcrumb-current' : ''}>
                    {crumb}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="header-right">
        {/* Employee — static company badge (no dropdown, no switch) */}
        {user?.role === 'employee' && (
          <div className="header-company-selector header-company-selector-viewonly" ref={companyRef}>
            <div className="company-selector-label-row">
              <span className="company-selector-label">
                <Globe size={12} />
                My Company:
              </span>
            </div>
            <span className="company-selector-single">
              <Building2 size={14} />
              <span className="company-selector-single-name">{selectedCompanyName || (isLoading ? 'Loading...' : '—')}</span>
            </span>
          </div>
        )}

        {/* Global Company Selector — for Executive/TeamLeader/CompanyAdmin; Master Admin uses per-page filters */}
        {user?.role !== 'master-admin' && user?.role !== 'employee' && availableCompanies.length > 0 && (
          <div className={`header-company-selector${isViewOnly && availableCompanies.length > 0 ? ' header-company-selector-viewonly' : ''}`} ref={companyRef}>
            <div className="company-selector-label-row">
              <span className="company-selector-label">
                <Globe size={12} />
                {isViewOnly ? 'Viewing:' : 'Managing:'}
              </span>
            </div>
            {availableCompanies.length === 1 && selectedCompanyId ? (
              <span className="company-selector-single">
                <Building2 size={14} />
                <span className="company-selector-single-name">{availableCompanies[0].name}</span>
                {isViewOnly && <Lock size={11} className="company-selector-lock-icon" />}
              </span>
            ) : user?.role === 'team-leader' ? (
              /* Team Leaders are locked to the combined view (TL filter drives scope) */
              <span className="company-selector-single">
                <Building2 size={14} />
                <span className="company-selector-single-name">All Companies</span>
              </span>
            ) : (
              <>
                <button
                  className="company-selector-btn"
                  onClick={() => setShowCompanyDropdown(!showCompanyDropdown)}
                  title="Switch company context"
                >
                  <Building2 size={14} />
                  <span className="company-selector-name">{selectedCompany?.name || 'All Companies'}</span>
                  <ChevronDown size={12} className={`company-selector-chevron ${showCompanyDropdown ? 'open' : ''}`} />
                  {isViewOnly && <Lock size={11} className="company-selector-lock-icon" />}
                </button>
                {showCompanyDropdown && (
                  <div className="company-selector-dropdown">
                    <div className="company-selector-header">Switch Company Context</div>
                    <div
                      className={`company-selector-option ${!selectedCompanyId ? 'active' : ''}`}
                      onClick={() => { setSelectedCompanyId(''); setShowCompanyDropdown(false) }}
                    >
                      <Building2 size={14} />
                      <div className="company-selector-option-info">
                        <span className="company-selector-option-name">All Companies</span>
                        <span className="company-selector-option-code">Combined view</span>
                      </div>
                      {!selectedCompanyId && <div className="company-selector-check" />}
                    </div>
                    {availableCompanies.map(comp => (
                      <div
                        key={comp.id}
                        className={`company-selector-option ${comp.id === selectedCompanyId ? 'active' : ''}`}
                        onClick={() => { setSelectedCompanyId(comp.id); setShowCompanyDropdown(false) }}
                      >
                        <Building2 size={14} />
                        <div className="company-selector-option-info">
                          <span className="company-selector-option-name">{comp.name}</span>
                          <span className="company-selector-option-code">{comp.code}</span>
                        </div>
                        {comp.id === selectedCompanyId && <div className="company-selector-check" />}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {/* Fallback for scope-required roles with no assigned companies — skip employees (always assigned) */}
        {user?.role !== 'master-admin' && user?.role !== 'employee' && availableCompanies.length === 0 && (isLoading ? (
          <div className="header-company-badge header-company-loading">
            <Loader2 size={14} className="animate-spin" />
            <span>Loading companies...</span>
          </div>
        ) : (
          <div className="header-company-badge header-company-unassigned" title="No companies have been assigned to your account. Contact your admin.">
            <Lock size={14} />
            <span>No companies assigned</span>
          </div>
        ))}
        {/* Fallback company badge when no companies loaded (non-scope roles) */}
        {availableCompanies.length === 0 && effectiveCompanyId && selectedCompanyName && (
          <div className="header-company-badge">
            <Building2 size={16} />
            <span>{selectedCompanyName}</span>
          </div>
        )}
        <div className="header-welcome">
          {greeting}, {user?.name?.split(' ')[0] || 'User'}
        </div>
        {/* Live clock strip — same shared ClockContext source as the hero.
            Each cell carries a simple icon (clock / calendar / pin). Location
            and temperature render only with real data (never invented). */}
        <div className="hdr-meta" aria-label="Current time and place">
          <b><Clock3 size={15} />{time}</b>
          <span className="hide-mobile"><CalendarDays size={14} />{dateShort}</span>
          {(location || tempC != null) && <span className="sep" />}
          {(location || tempC != null) && (
            <span className="hide-tablet">
              <MapPin size={14} />
              {location}
              {location && tempC != null && ' · '}
              {tempC != null && `${Math.round(tempC)}°C`}
            </span>
          )}
        </div>
        <div className="search-box" ref={searchRef} style={{ position: 'relative' }}>
          <Search size={16} />
          <input type="text" placeholder="Search anything..." value={searchTerm} onChange={e => { setSearchTerm(e.target.value); if (e.target.value) setShowDropdown(true) }} onFocus={() => { if (searchResults.length > 0) setShowDropdown(true) }} />
          {searchLoading && <Loader2 size={14} className="animate-spin" style={{ color: '#9ca3af', flexShrink: 0 }} />}
          {showDropdown && (
            <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, background: '#fff', borderRadius: 10, boxShadow: '0 10px 40px rgba(0,0,0,0.12)', border: '1px solid #e5e7eb', zIndex: 1000, maxHeight: 400, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {Object.entries(groupedResults).map(([cat, items]) => (
                <div key={cat}>
                  <div style={{ padding: '10px 14px 4px', fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>{cat}</div>
                  {items.map(r => (
                    <div key={`${r.category}-${r.id}`} onClick={() => handleResultClick(r)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', transition: 'background 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {cat === 'Employees' ? <Users size={13} color="#f97316" /> : cat === 'Tickets' ? <Ticket size={13} color="#f97316" /> : <FileText size={13} color="#f97316" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sublabel}</div>
                      </div>
                      <ArrowRight size={12} color="#d1d5db" style={{ flexShrink: 0 }} />
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ padding: '8px 14px', borderTop: '1px solid #f3f4f6', fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
              </div>
            </div>
          )}
        </div>
        <NotificationBell />
        <div className="header-profile">
          <div className="header-profile-info">
            <span>{user?.name || 'Admin'}</span>
            <span>{roleDepartmentLabel(user)}</span>
          </div>
        </div>
      </div>
    </header>
  )
}
