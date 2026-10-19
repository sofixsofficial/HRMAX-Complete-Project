import '../pages/Dashboard.css'

interface SkeletonProps {
  width?: string
  height?: number
  borderRadius?: number
  style?: React.CSSProperties
}

export function Skeleton({ width = '100%', height = 14, borderRadius = 6, style }: SkeletonProps) {
  return (
    <div
      className="shimmer-line"
      style={{
        width,
        height,
        borderRadius,
        margin: 0,
        ...style,
      }}
    />
  )
}

export function SkeletonCard() {
  return (
    <div className="stat-card stat-card-shimmer" aria-hidden="true">
      <div className="stat-icon shimmer-icon" />
      <div className="stat-info shimmer-info">
        <div className="shimmer-line shimmer-line-label" />
        <div className="shimmer-line shimmer-line-value" />
        <div className="shimmer-line shimmer-line-trend" />
      </div>
    </div>
  )
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 16 }}>
        <Skeleton width="25%" height={14} />
        <Skeleton width="20%" height={14} />
        <Skeleton width="20%" height={14} />
        <Skeleton width="15%" height={14} />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', gap: 16 }}>
          <Skeleton width="25%" height={12} />
          <Skeleton width="20%" height={12} />
          <Skeleton width="20%" height={12} />
          <Skeleton width="15%" height={12} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonChart() {
  return (
    <div className="dashboard-card" style={{ marginTop: 24 }}>
      <div className="card-header">
        <Skeleton width="40%" height={16} />
      </div>
      <div className="card-body">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, padding: '16px 0' }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: '100%', height: `${40 + Math.random() * 80}px`, borderRadius: '4px 4px 0 0',
                background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
                backgroundSize: '800px 100%',
                animation: 'shimmer 1.5s infinite ease-in-out',
              }} />
              <Skeleton width="30px" height={8} borderRadius={4} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
