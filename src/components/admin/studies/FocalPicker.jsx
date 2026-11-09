/** Click (or tap) on the image to set the focal point (0–1 each axis). */
export default function FocalPicker({ src, alt = '', x = 0.5, y = 0.5, onChange }) {
  if (!src) return null
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    onChange(Math.round(fx * 100) / 100, Math.round(fy * 100) / 100)
  }
  const nudge = (e) => {
    const step = e.shiftKey ? 0.1 : 0.02
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100
    onChange(c(x + d[0]), c(y + d[1]))
  }
  return (
    <div className="sa-focal">
      <div
        className="sa-focal-frame"
        onClick={pick}
        onKeyDown={nudge}
        role="slider"
        tabIndex={0}
        aria-label="Focal point. Click the image, or use arrow keys."
        aria-valuetext={`${Math.round(x * 100)}% across, ${Math.round(y * 100)}% down`}
      >
        <img src={src} alt={alt} draggable={false} />
        <span className="sa-focal-dot" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} aria-hidden="true" />
      </div>
      <p className="sa-help">
        Focal point: {Math.round(x * 100)}% across, {Math.round(y * 100)}% down. Click the image to move it — crops keep this spot in view.
      </p>
      <div className="sa-focal-crops" aria-hidden="true">
        {['16 / 9', '1 / 1', '3 / 4'].map((ar) => (
          <img key={ar} src={src} alt="" style={{ aspectRatio: ar, objectPosition: `${x * 100}% ${y * 100}%` }} />
        ))}
      </div>
    </div>
  )
}
