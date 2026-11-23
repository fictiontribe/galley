import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, ErrorState } from "@/ui";

interface Props {
  children: ReactNode;
  /** Changing this resets the boundary (pass the route path). */
  resetKey?: string;
}

interface State {
  error: unknown;
}

/** Catches a screen that crashed while rendering, so the rest of the app keeps working. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidUpdate(previous: Props): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Screen crashed", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app-screen app-screen--center">
        <ErrorState
          title="This screen couldn’t be shown"
          error={this.state.error}
          message="Your changes are safe — nothing was lost. Reload the screen, or go back and try again."
          onRetry={() => this.setState({ error: null })}
          retryLabel="Reload screen"
          actions={
            <Button size="sm" variant="quiet" onClick={() => window.history.back()}>
              Go back
            </Button>
          }
        />
      </div>
    );
  }
}
