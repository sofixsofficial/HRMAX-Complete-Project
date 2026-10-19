import { useState, useRef, useEffect, useMemo } from 'react'
import { Search, ChevronDown, Loader2, X } from 'lucide-react'

interface Option {
  value: string
  label: string
  [key: string]: any
}

interface SearchableSelectProps {
  options: Option[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  label?: string
  disabled?: boolean
  loading?: boolean
  error?: string
  required?: boolean
  noOptionsMessage?: string
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  label,
  disabled = false,
  loading = false,
  error,
  required = false,
  noOptionsMessage = 'No results found',
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selectedLabel = useMemo(() => {
    return options.find(o => o.value === value)?.label || ''
  }, [options, value])

  const filtered = useMemo(() => {
    if (!search) return options
    const s = search.toLowerCase()
    return options.filter(o => o.label.toLowerCase().includes(s))
  }, [options, search])

  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="form-group" ref={containerRef} style={{ position: 'relative' }}>
      {label && (
        <label>
          {label} {required && <span style={{ color: '#ef4444' }}>*</span>}
        </label>
      )}
      <div
        className={`searchable-select-trigger ${isOpen ? 'open' : ''} ${disabled ? 'disabled' : ''} ${error ? 'input-error' : ''}`}
        onClick={() => { if (!disabled) setIsOpen(!isOpen) }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', border: `1px solid ${error ? '#ef4444' : '#d1d5db'}`,
          borderRadius: 8, background: disabled ? '#f9fafb' : '#fff',
          cursor: disabled ? 'not-allowed' : 'pointer', minHeight: 42,
          transition: 'border-color 0.2s, box-shadow 0.2s',
          position: 'relative',
        }}
        onFocus={(e) => {
          if (!disabled) {
            e.currentTarget.style.borderColor = '#f97316'
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(249,115,22,0.1)'
          }
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = error ? '#ef4444' : '#d1d5db'
          e.currentTarget.style.boxShadow = 'none'
        }}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={isOpen}
      >
        <span style={{ color: selectedLabel ? '#0f172a' : '#9ca3af', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown size={16} style={{ color: '#6b7280', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </div>

      {isOpen && (
        <div
          style={{
            position: 'absolute', zIndex: 100, marginTop: 4, width: '100%',
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 4px 10px -5px rgba(0,0,0,0.04)',
            maxHeight: 300, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          <div style={{ padding: '8px 8px 4px', borderBottom: '1px solid #f3f4f6' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb' }}>
              <Search size={14} style={{ color: '#9ca3af', flexShrink: 0 }} />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, fontSize: 13, color: '#0f172a' }}
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#9ca3af' }}>
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '24px 16px', color: '#6b7280', fontSize: 13 }}>
                <Loader2 size={16} className="animate-spin" />
                Loading...
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                {noOptionsMessage}
              </div>
            ) : (
              filtered.map(opt => (
                <div
                  key={opt.value}
                  onClick={() => { onChange(opt.value); setIsOpen(false); setSearch('') }}
                  style={{
                    padding: '9px 14px', cursor: 'pointer', fontSize: 14, color: '#0f172a',
                    background: opt.value === value ? '#fff7ed' : 'transparent',
                    fontWeight: opt.value === value ? 600 : 400,
                    borderLeft: opt.value === value ? '3px solid #f97316' : '3px solid transparent',
                  }}
                  onMouseEnter={e => { if (opt.value !== value) e.currentTarget.style.background = '#f9fafb' }}
                  onMouseLeave={e => { if (opt.value !== value) e.currentTarget.style.background = 'transparent' }}
                >
                  {opt.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {error && <span className="field-error">{error}</span>}
    </div>
  )
}
