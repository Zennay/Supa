type Props = {
  label: string
  value: string
}

export function StatPill({ label, value }: Props) {
  return (
    <div className="stat-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
