import { useState, useEffect, useRef } from 'react'
import { Building2, ChevronDown } from 'lucide-react'
import { useCompany } from '../context/CompanyContext'
import './Header.css'

export function CompanySelector() {
  const { selectedCompanyId, setSelectedCompanyId, availableCompanies, isCompanyRestricted, selectedCompanyName, effectiveCompanyId } = useCompany()
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false)
  const companyRef = useRef<HTMLDivElement>(null)

  const selectedCompany = availableCompanies.find(c => c.id === selectedCompanyId)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (companyRef.current && !companyRef.current.contains(e.target as Node)) {
        setShowCompanyDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (!effectiveCompanyId) return null

  return (
    <div className="header-company-selector" ref={companyRef} style={{ position: 'relative' }}>
      {isCompanyRestricted && availableCompanies.length === 1 ? (
        <span className="company-selector-single">
          <Building2 size={16} />
          <span>{availableCompanies[0].name}</span>
        </span>
      ) : (
        <>
          <button
            className="company-selector-btn"
            onClick={() => setShowCompanyDropdown(!showCompanyDropdown)}
            title="Switch company context"
          >
            <Building2 size={16} />
            <span className="company-selector-name">{selectedCompany?.name || selectedCompanyName || 'Select Company'}</span>
            <ChevronDown size={14} className={`company-selector-chevron ${showCompanyDropdown ? 'open' : ''}`} />
          </button>
          {showCompanyDropdown && (
            <div className="company-selector-dropdown">
              <div className="company-selector-header">Switch Company</div>
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
  )
}
