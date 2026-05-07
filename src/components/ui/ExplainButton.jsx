import { useState } from 'react'
import { C } from '../../styles/tokens'
import { useToast } from './toast-context'

export default function ExplainButton({ context, symbol }) {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)

  const ask = async () => {
    if (!question.trim()) return
    setLoading(true)
    setAnswer('')
    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: question.trim(),
          context: context || '',
          symbol: symbol || '',
        }),
      })
      const data = await res.json()
      setAnswer(data?.answer || 'No response received.')
    } catch {
      showToast('Could not fetch explanation right now.', 'error')
      setAnswer('Unable to fetch explanation right now.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-xs"
        style={{ background: C.surface2, color: C.textMuted, border: `1px solid ${C.border}` }}
        aria-label="Explain this"
        title="Explain this to me"
      >
        ?
      </button>

      {open ? (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute bottom-0 left-0 right-0 rounded-t-2xl border p-4"
            style={{ background: C.surface, borderColor: C.border }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <p style={{ color: C.text }} className="text-sm font-medium">
                Explain this to me
              </p>
              <button type="button" onClick={() => setOpen(false)} style={{ color: C.textMuted }}>
                Close
              </button>
            </div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask one question..."
              className="w-full rounded-lg border bg-transparent p-2 text-sm outline-none"
              style={{ color: C.text, borderColor: C.border }}
              rows={3}
            />
            <button
              type="button"
              onClick={ask}
              disabled={loading}
              className="mt-2 rounded-lg px-3 py-2 text-sm font-medium"
              style={{ background: C.blueBg, color: C.blue, border: `1px solid ${C.border}` }}
            >
              {loading ? 'Loading...' : 'Ask'}
            </button>
            <div className="mt-3 text-sm leading-6" style={{ color: C.text }}>
              {answer}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
