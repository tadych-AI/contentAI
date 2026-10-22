// Znak TadychAI: wanna, do której nalewa się woda (kran → strumień → rosnący poziom z falą). animate=false: wanna z wodą, bez ruchu.
let seq = 0
export default function BathTub({ size = 'md', animate = true, className = '', title }) {
  const id = `tub${++seq}`
  return (
    <svg className={`bathtub ${size}${animate ? ' filling' : ''} ${className}`} viewBox="0 0 120 84" role={title ? 'img' : undefined} aria-hidden={title ? undefined : 'true'} aria-label={title}>
      <defs>
        <clipPath id={`${id}-in`}><path d="M13 41h94v5a19 19 0 0 1-19 19H32A19 19 0 0 1 13 46z" /></clipPath>
        <linearGradient id={`${id}-w`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="tub-water-top" /><stop offset="1" className="tub-water-deep" /></linearGradient>
      </defs>
      {/* kran */}
      <path className="tub-tap" d="M108 6H95a7 7 0 0 0-7 7v4" />
      <path className="tub-tap" d="M104 3v6" />
      {/* strumień */}
      <path className="tub-stream" d="M88 19V58" />
      {/* woda w wannie */}
      <g clipPath={`url(#${id}-in)`}>
        <g className="tub-level">
          <g className="tub-wave"><path d="M-30 40q7.5-3 15 0t15 0t15 0t15 0t15 0t15 0t15 0t15 0t15 0t15 0t15 0t15 0t15 0t15 0V90H-30z" fill={`url(#${id}-w)`} /></g>
        </g>
      </g>
      {/* wanna: obrzeże, korpus, nóżki */}
      <path className="tub-body" d="M10 40h100v6a22 22 0 0 1-22 22H32a22 22 0 0 1-22-22z" />
      <path className="tub-rim" d="M5 40h110" />
      <path className="tub-feet" d="M30 68l-3 9M90 68l3 9" />
    </svg>
  )
}
