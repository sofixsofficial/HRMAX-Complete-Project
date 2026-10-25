interface LogoProps {
  variant?: 'stacked' | 'compact' | 'icon'
  size?: 'sm' | 'md' | 'lg'
  onLight?: boolean
}

export function Logo({ variant = 'compact', size = 'md', onLight = false }: LogoProps) {
  const iconDims: Record<string, number> = { sm: 28, md: 36, lg: 48 }
  const compactDims: Record<string, number> = { sm: 100, md: 130, lg: 170 }
  const stackedDims: Record<string, number> = { sm: 70, md: 90, lg: 120 }

  if (variant === 'icon') {
    const dim = iconDims[size] || iconDims.md
    return (
      <svg width={dim} height={dim} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="10" fill="#f97316"/>
        <text x="20" y="27" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontWeight="800" fontSize="18" fill="white">HR</text>
      </svg>
    )
  }

  if (variant === 'compact') {
    const dim = compactDims[size] || compactDims.md
    return (
      <svg width={dim} height={dim * 40 / 150} viewBox="0 0 150 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="4" width="32" height="32" rx="8" fill="#f97316"/>
        <text x="16" y="27" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontWeight="800" fontSize="17" fill="white">HR</text>
        {/* Wordmark "HR" is orange so it matches "MAX" — previously #111827,
            which made the lockup read as a dark/orange mix in the navbar+footer. */}
        <text x="46" y="28" fontFamily="Inter, Arial, sans-serif" fontWeight="700" fontSize="24" fill="#f97316">HR</text>
        <text x="80" y="28" fontFamily="Inter, Arial, sans-serif" fontWeight="800" fontSize="24" fill="#f97316">MAX</text>
      </svg>
    )
  }

  const dim = stackedDims[size] || stackedDims.md
  // Stacked mark: "HR" in an orange rounded box, "MAX" centred below it.
  // The box occupies y=0..50; "MAX" (fontSize 36, baseline y=90) has a cap-top
  // near y=64 — a ~14px clear gap below the box — and the viewBox is 98 tall so
  // neither the box nor the "MAX" glyphs are clipped or overlapping.
  return (
    <svg width={dim} height={dim * 98 / 120} viewBox="0 0 120 98" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="35" y="0" width="50" height="50" rx="12" fill="#f97316"/>
      <text x="60" y="34" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontWeight="800" fontSize="23" fill="white">HR</text>
      {/* Full wordmark below the mark: "HR MAX" (was just "MAX"). Font size
          26 keeps the 6 glyphs inside the 120-unit viewBox when centred. */}
      <text x="60" y="88" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontWeight="800" fontSize="26" fill="#FFFFFF">HR MAX</text>
    </svg>
  )
}
