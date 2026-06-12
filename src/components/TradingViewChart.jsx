// TradingViewChart — embeds the TradingView Advanced Chart widget.
// Reusable. Each instance gets a unique container id so multiple
// charts can coexist on the same page without script collision.
//
// Lifecycle:
//   - On mount: creates a fresh container, appends the widget script
//     with the config in data-attributes. TradingView's loader reads
//     them, mounts an iframe inside the container.
//   - On unmount: removes the script + clears the container so the
//     widget tears down cleanly when a parent toggles it off.
//
// Caller-controlled props: symbol (string like "NSE:RELIANCE" or
// "NSE:NIFTY") and height (number, default 500).

import { useEffect, useRef } from 'react'

export default function TradingViewChart({ symbol, height = 500 }) {
  const containerRef = useRef(null)
  // Unique id per mount — UUIDs are overkill, a random suffix +
  // useRef-stable seed is enough to avoid collisions between two
  // mounted charts on the same screen.
  const idRef = useRef(`tv_chart_${Math.random().toString(36).slice(2, 10)}`)

  useEffect(() => {
    const host = containerRef.current
    if (!host || !symbol) return

    // TradingView's loader script reads its config from the
    // innerHTML of the immediate sibling block. We construct the
    // skeleton it expects then append the script.
    host.innerHTML = ''
    const widgetDiv = document.createElement('div')
    widgetDiv.id = idRef.current
    widgetDiv.className = 'tradingview-widget-container__widget'
    widgetDiv.style.height = '100%'
    widgetDiv.style.width = '100%'
    host.appendChild(widgetDiv)

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: 'W',
      timezone: 'Asia/Kolkata',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
    })
    host.appendChild(script)

    return () => {
      try {
        host.innerHTML = ''
      } catch { /* host already detached — nothing to clean up */ }
    }
  }, [symbol])

  return (
    <div
      className="tradingview-widget-container"
      ref={containerRef}
      style={{ height, width: '100%' }}
    />
  )
}
