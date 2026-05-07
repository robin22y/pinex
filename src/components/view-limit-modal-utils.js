const REMIND_KEY = 'stockiq_view_limit_remind_until'

export function setViewLimitRemindTomorrow() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  localStorage.setItem(REMIND_KEY, `${y}-${m}-${day}`)
}

export function shouldShowViewLimitModal() {
  const remindUntil = localStorage.getItem(REMIND_KEY)
  if (!remindUntil) return true

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return today >= remindUntil
}
