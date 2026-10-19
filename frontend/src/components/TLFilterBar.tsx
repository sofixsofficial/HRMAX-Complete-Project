import { X, ChevronDown, Users, Building2, CheckCircle2 } from 'lucide-react'
import { useTLFilter } from '../context/TLFilterContext'
import './TLFilterBar.css'

interface TLFilterBarProps {
  onScopeChange?: (execId: string | null, companyId: string | null) => void
}

export function TLFilterBar({ onScopeChange }: TLFilterBarProps) {
  const {
    executives, companies, selectedExecutiveId, selectedCompanyId,
    setExecutive, setCompany, resetFilters,
    currentExecutive, currentCompany,
  } = useTLFilter()

  const handleExecutiveChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value || null
    setExecutive(id || '')
    onScopeChange?.(id, null)
  }

  const handleCompanyChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value || null
    setCompany(id || '')
    onScopeChange?.(selectedExecutiveId, id)
  }

  const handleClear = () => {
    resetFilters()
    onScopeChange?.(null, null)
  }

  return (
    <div className="tlf-bar">
      <div className="tlf-group">
        <span className="tlf-label">
          <span className={`tlf-step ${selectedExecutiveId ? 'done' : ''}`}>{selectedExecutiveId ? '✓' : '1'}</span>
          Executive
        </span>
        <div className={`tlf-select-wrap ${selectedExecutiveId ? 'has-value' : ''}`}>
          <Users size={16} className="tlf-select-icon" />
          <select
            value={selectedExecutiveId || ''}
            onChange={handleExecutiveChange}
            className={`tlf-select ${selectedExecutiveId ? 'filled' : ''}`}
          >
            <option value="">Select Executive...</option>
            {executives.map(ex => (
              <option key={ex.id} value={ex.id}>{ex.name}</option>
            ))}
          </select>
          <ChevronDown size={15} className="tlf-chevron" />
        </div>
      </div>

      <div className="tlf-group">
        <span className="tlf-label">
          <span className={`tlf-step ${selectedCompanyId ? 'done' : ''}`}>{selectedCompanyId ? '✓' : '2'}</span>
          Company
        </span>
        <div className={`tlf-select-wrap ${selectedCompanyId ? 'has-value' : ''}`}>
          <Building2 size={16} className="tlf-select-icon" />
          <select
            value={selectedCompanyId || ''}
            onChange={handleCompanyChange}
            className={`tlf-select ${selectedCompanyId ? 'filled' : ''}`}
            disabled={!selectedExecutiveId}
          >
            <option value="">{selectedExecutiveId ? 'Select Company...' : 'Select an executive first'}</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <ChevronDown size={15} className="tlf-chevron" />
        </div>
        {!selectedExecutiveId && executives.length > 0 && (
          <span className="tlf-hint">Pick an executive to load their companies</span>
        )}
      </div>

      <span className="tlf-spacer" />

      {currentExecutive && currentCompany && (
        <span className="tlf-scope-chip" title={`${currentExecutive.name} → ${currentCompany.name}`}>
          <span className="tlf-scope-dot" />
          <CheckCircle2 size={14} />
          <span className="tlf-scope-text">{currentCompany.name}</span>
        </span>
      )}

      {(selectedExecutiveId || selectedCompanyId) && (
        <button className="tlf-clear" onClick={handleClear}>
          <X size={14} /> Clear Filters
        </button>
      )}
    </div>
  )
}
