import { Component } from 'react';

// Without this, any render-time throw unmounts the whole tree and leaves a blank white
// page — no message, no way back, and mid-workout that reads as "the app ate my sets".
// The sets are still in the local draft; this keeps a route to them.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="card w-full max-w-md space-y-3">
          <h1 className="text-lg font-semibold tracking-tight">Something broke</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            The page failed to render. Anything you logged is saved on this device and will
            sync once you’re back online.
          </p>
          <p className="text-xs font-mono text-red-600 dark:text-red-400 break-words">
            {this.state.error?.message || String(this.state.error)}
          </p>
          <div className="flex gap-2 pt-1">
            <button onClick={() => window.location.reload()} className="btn-primary flex-1 justify-center">
              Reload
            </button>
            <button
              onClick={() => { window.location.href = '/dashboard'; }}
              className="btn-secondary flex-1 justify-center"
            >
              Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
