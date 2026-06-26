import { useState, useEffect } from 'react'
import MarketPulse from '../components/MarketPulse'

export default function MarketPulsePage() {
  const [data, setData] = useState(null)

  useEffect(() => {
    // Sample data - in production this would come from your API
    setData({
      date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
      breadth: 55.3,
      breadth_change: 2.1,
      advances: 654,
      advances_change: 8.7,
      declines: 1450,
      declines_change: 6.1,
      ad_ratio: 0.45,
      vix: 13.4,
      vix_change: -4.2,
      highs52: 105,
      lows52: 35,
      stages: {
        advancing: { value: 992, change: 7.5, icon: '🐂' },
        basing: { value: 594, change: 3.1, icon: '〰️' },
        topping: { value: 162, change: -4.6, icon: '∧' },
        declining: { value: 259, change: -5.2, icon: '🐻' }
      },
      strongest_sectors: [
        { name: 'IT', change: 2.8 },
        { name: 'Capital Goods', change: 2.3 },
        { name: 'Auto', change: 1.9 }
      ],
      weakest_sectors: [
        { name: 'FMCG', change: -1.6 },
        { name: 'Realty', change: -1.2 },
        { name: 'Media', change: -0.8 }
      ]
    })
  }, [])

  if (!data) return <div style={{ padding: '20px', color: '#A0AAB8' }}>Loading...</div>

  return (
    <div style={{ padding: '20px' }}>
      <MarketPulse data={data} />
    </div>
  )
}
