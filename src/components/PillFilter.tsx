export function PillFilter({
  names,
  active,
  onChange,
}: {
  names: string[]
  active: string | null
  onChange: (name: string | null) => void
}) {
  if (names.length === 0) return null
  return (
    <div className="pill-row">
      <button className={`pill ${active === null ? 'active' : ''}`} onClick={() => onChange(null)}>
        All
      </button>
      {names.map((name) => (
        <button
          key={name}
          className={`pill ${active === name ? 'active' : ''}`}
          onClick={() => onChange(active === name ? null : name)}
        >
          {name}
        </button>
      ))}
    </div>
  )
}
