import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { getCspamsBuildIdentifier } from "@/lib/buildInfo";

interface AppErrorBoundaryProps {
  children: ReactNode;
  onReload?: () => void;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[cspams] Application render failed.", {
      name: error.name,
      message: error.message,
      build: getCspamsBuildIdentifier(),
      ...(import.meta.env.DEV ? { componentStack: info.componentStack } : {}),
    });
  }

  private reloadApplication = (): void => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }

    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="flex min-h-screen items-center justify-center bg-page-bg px-4 py-10">
        <section
          role="alert"
          className="surface-panel w-full max-w-md border border-slate-200 p-6 text-center"
        >
          <AlertTriangle className="mx-auto h-9 w-9 text-amber-600" aria-hidden="true" />
          <p className="mt-4 text-sm font-bold text-primary-800">CSPAMS could not finish loading.</p>
          <p className="mt-2 text-sm text-slate-600">
            Reload the application to restore a safe, current view.
          </p>
          <button
            type="button"
            onClick={this.reloadApplication}
            className="mt-5 inline-flex items-center justify-center gap-2 bg-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          >
            <RotateCw className="h-4 w-4" aria-hidden="true" />
            Reload Application
          </button>
        </section>
      </main>
    );
  }
}
