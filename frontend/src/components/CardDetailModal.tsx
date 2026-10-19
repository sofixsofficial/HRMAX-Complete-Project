import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Modal } from './Modal'
import './CardDetailModal.css'

export interface DetailColumn {
  key: string
  label: string
}

interface CardDetailModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  columns: DetailColumn[]
  rows: Record<string, any>[]
  searchPlaceholder?: string
}

export function CardDetailModal({ isOpen, onClose, title, columns, rows, searchPlaceholder }: CardDetailModalProps) {
  const [searchTerm, setSearchTerm] = useState('')

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return rows
    const s = searchTerm.toLowerCase()
    return rows.filter(r =>
      columns.some(c => String(r[c.key] ?? '').toLowerCase().includes(s))
    )
  }, [rows, columns, searchTerm])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="large">
      <div className="cdm-toolbar">
        <div className="cdm-search">
          <Search size={15} />
          <input
            type="text"
            placeholder={searchPlaceholder || 'Search...'}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <span className="cdm-count">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="cdm-table-wrap">
        <table className="cdm-table">
          <thead>
            <tr>
              {columns.map(c => <th key={c.key}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={columns.length} className="cdm-empty">No records found.</td></tr>
            ) : (
              filtered.map((r, i) => (
                <tr key={r.id || i}>
                  {columns.map(c => <td key={c.key}>{String(r[c.key] ?? '—')}</td>)}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
