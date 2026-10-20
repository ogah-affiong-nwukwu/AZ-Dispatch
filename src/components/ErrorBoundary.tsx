import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  label?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[error-boundary]', this.props.label ?? 'view', error, info)
  }

  handleReload = () => {
    this.setState({ hasError: false, message: '' })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="app app-loading">
        <div className="card empty-state" style={{ maxWidth: 480 }}>
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
            {this.state.message || 'This view could not be rendered.'}
          </p>
          <div className="form-actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={this.handleReload}
            >
              Try again
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                window.location.href = '/'
              }}
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    )
  }
}
