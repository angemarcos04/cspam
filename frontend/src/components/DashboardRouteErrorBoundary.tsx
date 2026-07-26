import { Component, Fragment, useState, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, LogOut, RefreshCw, RotateCw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/Auth";
import { getCspamsBuildIdentifier } from "@/lib/buildInfo";

interface DashboardBoundaryProps {
  children: ReactNode;
  resetKey: string;
  fallback: (retry: () => void) => ReactNode;
}

interface DashboardBoundaryState {
  error: Error | null;
  retryKey: number;
}

class DashboardBoundary extends Component<DashboardBoundaryProps, DashboardBoundaryState> {
  state: DashboardBoundaryState = {
    error: null,
    retryKey: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<DashboardBoundaryState> {
    return { error };
  }

  componentDidUpdate(previousProps: DashboardBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState((state) => ({
        error: null,
        retryKey: state.retryKey + 1,
      }));
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[cspams] Dashboard route failed.", {
      name: error.name,
      message: error.message,
      build: getCspamsBuildIdentifier(),
      route: this.props.resetKey,
      ...(import.meta.env.DEV ? { componentStack: info.componentStack } : {}),
    });
  }

  private retry = (): void => {
    this.setState((state) => ({
      error: null,
      retryKey: state.retryKey + 1,
    }));
  };

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.retry);
    }

    return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>;
  }
}

function DashboardErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [isReturningToSignIn, setIsReturningToSignIn] = useState(false);

  const returnToSignIn = async (): Promise<void> => {
    if (isReturningToSignIn) {
      return;
    }

    setIsReturningToSignIn(true);
    try {
      await logout({ force: true });
      navigate("/", { replace: true });
    } finally {
      setIsReturningToSignIn(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-page-bg px-4 py-10">
      <section
        role="alert"
        className="surface-panel w-full max-w-lg border border-slate-200 p-6 text-center"
      >
        <AlertTriangle className="mx-auto h-9 w-9 text-amber-600" aria-hidden="true" />
        <p className="mt-4 text-sm font-bold text-primary-800">The dashboard could not finish loading.</p>
        <p className="mt-2 text-sm text-slate-600">
          Try opening the dashboard again. If the problem continues, reload the application.
        </p>
        <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 border border-primary-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary-800 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try Dashboard Again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            Reload Application
          </button>
          <button
            type="button"
            onClick={() => void returnToSignIn()}
            disabled={isReturningToSignIn}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Return to Sign In
          </button>
        </div>
      </section>
    </main>
  );
}

export function DashboardRouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <DashboardBoundary
      resetKey={`${location.pathname}${location.search}${location.hash}`}
      fallback={(retry) => <DashboardErrorFallback onRetry={retry} />}
    >
      {children}
    </DashboardBoundary>
  );
}
