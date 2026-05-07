import { useMemo, useState } from 'react'
import { C } from '../../styles/tokens'
import { ToastContext } from './toast-context'

const TYPE_COLOR = {
  success: C.green,
  error: C.red,
  info: C.blue,
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const showToast = (message, type = 'info') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { id, message, type }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }

  const value = useMemo(() => ({ showToast }), [])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-[100] w-[min(92vw,420px)] -translate-x-1/2 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="rounded-lg border px-4 py-3 text-sm"
            style={{
              background: C.surface,
              borderColor: C.border,
              color: C.text,
              boxShadow: `0 0 0 1px ${TYPE_COLOR[t.type] ?? C.blue}33`,
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

