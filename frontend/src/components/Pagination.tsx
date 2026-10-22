import './Pagination.css'

interface PaginationProps {
  /** Current 1-based page. */
  page: number
  /** Rows per page. */
  pageSize: number
  /** Total (filtered) row count. */
  total: number
  onPageChange: (page: number) => void
  /** When provided, renders the rows-per-page selector. */
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

/** 1 … p-1 p p+1 … N — compact window for long lists. */
function pageWindow(page: number, pageCount: number): Array<number | 'gap'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const wanted = [1, pageCount, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pageCount)
  const sorted = [...new Set(wanted)].sort((a, b) => a - b)
  const out: Array<number | 'gap'> = []
  let prev = 0
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push('gap')
    out.push(p)
    prev = p
  }
  return out
}

/**
 * Shared client-side pagination bar — "Showing X–Y of Z", optional
 * rows-per-page selector, Prev / numbered / Next controls. Clamp-safe: an
 * out-of-range `page` (e.g. after filters shrink the list) renders the last
 * valid page instead of an empty table.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), pageCount)
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1
  const to = Math.min(total, current * pageSize)

  return (
    <div className="pg" role="navigation" aria-label="Pagination">
      <span className="pg-info">
        Showing {from}–{to} of {total}
        {onPageSizeChange && (
          <select
            className="pg-size"
            aria-label="Rows per page"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        )}
      </span>
      <div className="pg-controls">
        <button
          type="button"
          className="pg-btn"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
        >
          Prev
        </button>
        {pageWindow(current, pageCount).map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} className="pg-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className="pg-btn"
              data-active={p === current || undefined}
              aria-current={p === current ? 'page' : undefined}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className="pg-btn"
          disabled={current >= pageCount}
          onClick={() => onPageChange(current + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}

export default Pagination
