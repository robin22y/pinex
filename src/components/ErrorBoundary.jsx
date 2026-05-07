import { Component } from 'react'
import { C } from '../styles/tokens'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch() {
    // Intentionally avoid showing raw errors to users.
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center px-4" style={{ background: C.base }}>
          <div className="rounded-xl border p-5 text-center" style={{ borderColor: C.border, background: C.surface }}>
            <p className="text-base font-semibold" style={{ color: C.text }}>
              Something went wrong. Please refresh.
            </p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
