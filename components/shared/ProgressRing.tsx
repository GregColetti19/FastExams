export function ProgressRing({
  percent,
  size = 120,
  strokeWidth = 4,
}: {
  percent: number
  size?: number
  strokeWidth?: number
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (percent / 100) * circumference

  const getColor = () => {
    if (percent >= 80) return '#22c55e'
    if (percent >= 50) return '#eab308'
    return '#ef4444'
  }

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke="#e2e8f0"
        strokeWidth={strokeWidth}
        fill="none"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        stroke={getColor()}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.3s ease' }}
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dy="0.3em"
        className="text-sm font-semibold fill-slate-900"
        transform={`rotate(90 ${size / 2} ${size / 2})`}
      >
        {percent}%
      </text>
    </svg>
  )
}
