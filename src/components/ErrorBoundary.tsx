import { Component, type ReactNode } from 'react';
import { logError } from '../services/logger';

interface Props {
  children: ReactNode;
  /** Name shown in the error UI and logs */
  name: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary — catches render errors in child components.
 *
 * Wraps each surface so one crash doesn't take down the entire app.
 * Shows a recoverable error message with a retry button.
 * Logs the error via the centralized logger.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logError(`ErrorBoundary:${this.props.name}`, error);
    if (info.componentStack) {
      logWarnStack(this.props.name, info.componentStack);
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', padding: 40,
          color: '#e1e4ea', textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
            Something went wrong in {this.props.name}
          </h2>
          <p style={{ fontSize: 13, color: '#6b6f85', marginBottom: 16, maxWidth: 400 }}>
            This section crashed but the rest of the app is fine.
            Try clicking retry, or navigate to a different section.
          </p>
          {this.state.error && (
            <pre style={{
              fontSize: 11, color: '#ff6b6b', background: '#1a1d2e',
              padding: '8px 12px', borderRadius: 6, marginBottom: 16,
              maxWidth: 500, overflow: 'auto', whiteSpace: 'pre-wrap',
            }}>
              {this.state.error.message}
            </pre>
          )}
          <button
            className="btn btn-primary"
            onClick={this.handleRetry}
            style={{ fontSize: 13, padding: '8px 20px' }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function logWarnStack(name: string, stack: string): void {
  console.warn(`[ErrorBoundary:${name}] Component stack:`, stack);
}

export default ErrorBoundary;
