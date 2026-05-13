import { useEffect } from 'react'
import { CONFIG } from '../config'
import { useAuth } from '../context'

export default function AdUnit({ slot, format = 'auto' }) {
  const { isPaid } = useAuth()
  const client = import.meta.env.VITE_ADSENSE_CLIENT
  const shouldRender = Boolean(
    CONFIG.features.adsActive && !isPaid && client && slot,
  )

  useEffect(() => {
    if (!shouldRender) return

    const pushAd = () => {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({})
      } catch {
        // adblock / not ready
      }
    }

    const src =
      'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js'
    let script = document.getElementById('stockiq-adsense-script')
    if (!script) {
      script = document.createElement('script')
      script.id = 'stockiq-adsense-script'
      script.src = src
      script.async = true
      script.crossOrigin = 'anonymous'
      script.onerror = () => {}
      document.head.appendChild(script)
    }

    if (window.adsbygoogle) {
      pushAd()
    } else {
      script.addEventListener('load', pushAd, { once: true })
    }
  }, [shouldRender, slot, format])

  if (!shouldRender) return null

  const minHeight =
    format === 'rectangle' ? 250 : format === 'horizontal' ? 120 : 100

  return (
    <div className="w-full overflow-hidden rounded-xl border border-[#1E293B] bg-[#111827] p-2">
      <ins
        className="adsbygoogle block"
        style={{ display: 'block', minHeight }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  )
}
