// Znak oczekiwania w motywie aplikacji: kratka odpływu liniowego, przez którą spływa woda
export default function DrainLoader({ label = 'Ładowanie…', size = 'md', inline = false }) {
  return (
    <div className={`drain-loader ${size}${inline ? ' inline' : ''}`} role="status" aria-live="polite">
      <span className="drain-grate" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      {label && <span className="drain-label">{label}</span>}
    </div>
  )
}
