/**
 * Unsaved-changes registry. Each editor reports a dirty flag under a key;
 * the study editor reads the combined state for its tab / page guards.
 */
import { createContext, useContext, useEffect } from 'react'

export const DirtyContext = createContext(null)

export function useDirtyFlag(key, dirty) {
  const ctx = useContext(DirtyContext)
  useEffect(() => {
    ctx?.(key, Boolean(dirty))
  }, [ctx, key, dirty])
  useEffect(() => () => ctx?.(key, false), [ctx, key])
}

export const LEAVE_MESSAGE = 'You have unsaved changes. Leave without saving?'

/**
 * Ask before leaving with unsaved changes — without react-router's
 * useBlocker (which would add code to the public vendor-react chunk).
 *
 * Catches clicks on in-app links in the capture phase, before React
 * Router's <Link> handler (which skips navigation when defaultPrevented),
 * plus tab close / reload via beforeunload. Browser Back is not caught.
 *
 * leaveDirty   unsaved changes that a different page would lose
 * searchDirty  unsaved changes that a same-page ?query change would lose
 */
export function useLeaveGuard(leaveDirty, searchDirty) {
  useEffect(() => {
    if (!leaveDirty && !searchDirty) return
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = e.target?.closest?.('a[href]')
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.getAttribute('href'), window.location.href)
      const here = window.location
      const samePath = url.origin === here.origin && url.pathname === here.pathname
      if (samePath && url.search === here.search) return
      if ((samePath ? searchDirty : leaveDirty) && !window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onUnload = (e) => {
      if (!leaveDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [leaveDirty, searchDirty])
}
