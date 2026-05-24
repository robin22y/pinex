// ErrorBoundary — catches uncaught React errors
// at the app root with two distinct UX paths:
//
//   1. CHUNK LOAD ERRORS (the common case after
//      a Netlify deploy): the browser holds an
//      old index.html that references chunk
//      hashes which no longer exist on the
//      server. We auto-reload once to fetch the
//      new build. The sessionStorage rate-limit
//      stops an infinite reload loop if reload
//      itself fails.
//
//   2. GENERIC ERRORS: we still show a friendly
//      "Something went wrong" screen with a
//      reload button, so users aren't staring at
//      a blank page when the app blows up.

import { Component } from 'react'

function isChunkError(err) {
  return !!(
    err?.name === 'ChunkLoadError' ||
    err?.message?.includes('Failed to fetch dynamically') ||
    err?.message?.includes('Loading chunk') ||
    err?.message?.includes('Loading CSS chunk')
  )
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      isChunkError: false,
    }
  }

  static getDerivedStateFromError(err) {
    return {
      hasError: true,
      isChunkError: isChunkError(err),
    }
  }

  componentDidCatch(err) {
    // WHY auto-reload only on chunk errors:
    // when Netlify deploys a new build the old
    // chunk hashes vanish. The browser still
    // holds the previous index.html (cached
    // for the user's tab lifetime even if our
    // Cache-Control says no-store, because they
    // never refreshed). One window.location
    // .reload() fixes it by fetching the latest
    // index.html which references the new
    // chunk hashes.
    //
    // sessionStorage rate-limit prevents an
    // infinite loop if the reload itself fails
    // (e.g. the new build is also broken).
    if (isChunkError(err)) {
      const lastReload = sessionStorage.getItem('chunk_error_reload')
      const now = Date.now()

      if (!lastReload || now - Number(lastReload) > 10_000) {
        sessionStorage.setItem('chunk_error_reload', String(now))
        window.location.reload()
      }
    }
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.state.isChunkError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            background: '#0B0E11',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 360 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔄</div>
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#E2E8F0',
                marginBottom: 8,
              }}
            >
              New version available
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#64748B',
                lineHeight: 1.6,
                marginBottom: 24,
              }}
            >
              PineX has been updated. Reload to get the latest version.
            </div>
            <button
              onClick={() => {
                // Clear the rate-limit guard so
                // a manual reload can succeed
                // even if the auto-reload was
                // blocked by it.
                sessionStorage.removeItem('chunk_error_reload')
                window.location.reload()
              }}
              style={{
                padding: '12px 28px',
                borderRadius: 8,
                border: 'none',
                background: '#00C805',
                color: '#000',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Reload PineX →
            </button>
          </div>
        </div>
      )
    }

    // Generic uncaught error — not a chunk load.
    // Show a recoverable screen with a reload
    // button rather than the previous tiny card.
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0B0E11',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: '#E2E8F0',
              marginBottom: 8,
            }}
          >
            Something went wrong
          </div>
          <div
            style={{
              fontSize: 13,
              color: '#64748B',
              lineHeight: 1.6,
              marginBottom: 24,
            }}
          >
            Please reload the page. If the problem persists, contact support.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 28px',
              borderRadius: 8,
              border: 'none',
              background: '#00C805',
              color: '#000',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reload page →
          </button>
        </div>
      </div>
    )
  }
}
