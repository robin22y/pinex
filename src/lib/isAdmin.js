const ADMIN_EMAIL = 'robin22y@gmail.com'

/** Super-admin gate for /admin routes (email allowlist). */
export function isAdmin(user) {
  const email = String(user?.email || '').trim().toLowerCase()
  return Boolean(email && email === ADMIN_EMAIL)
}

export { ADMIN_EMAIL }
