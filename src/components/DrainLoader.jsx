// Znak oczekiwania w motywie aplikacji: wanna, do której nalewa się woda
import BathTub from './BathTub.jsx'
export default function DrainLoader({ label = 'Ładowanie…', size = 'md', inline = false }) {
  return (
    <div className={`drain-loader ${size}${inline ? ' inline' : ''}`} role="status" aria-live="polite">
      <BathTub size={inline ? 'sm' : size} />
      {label && <span className="drain-label">{label}</span>}
    </div>
  )
}
