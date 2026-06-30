import { useEffect } from "react";
import { CircleHelp, X } from "lucide-react";

type DashboardHelpVariant = "monitor" | "school_head";

interface DashboardHelpDialogProps {
  open: boolean;
  variant: DashboardHelpVariant;
  onClose: () => void;
}

export function DashboardHelpDialog({ open, variant, onClose }: DashboardHelpDialogProps) {
  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isMonitor = variant === "monitor";
  const title = isMonitor ? "User Manual" : "Account Setup & Sign-in Help";
  const subtitle = isMonitor
    ? "Open the monitor manual for dashboard sections, account setup, email delivery, and recovery."
    : "How to activate your account and regain access.";

  return (
    <>
      <button
        type="button"
        onClick={onClose}
        className="fixed inset-0 z-[96] bg-slate-900/40"
        aria-label="Close help dialog"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Dashboard help"
        className="fixed z-[97] inset-x-4 bottom-4 max-h-[84vh] w-[calc(100vw-2rem)] overflow-y-auto rounded-sm border border-slate-200 bg-white p-4 shadow-2xl animate-fade-slide sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-32 sm:w-[min(46rem,calc(100vw-2rem))] sm:-translate-x-1/2"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-primary-700">
              <CircleHelp className="h-4 w-4" />
              Quick Guide
            </p>
            <h2 className="mt-1 text-base font-extrabold text-slate-900">{title}</h2>
            <p className="mt-1 text-xs text-slate-600">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center rounded-sm border border-slate-300 bg-white p-1 text-slate-600 transition hover:bg-slate-100"
            aria-label="Close"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {isMonitor ? (
            <article className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Monitor User Manual</h3>
              <p className="mt-2 text-xs leading-5 text-slate-700">
                Open <span className="font-semibold text-slate-900">User Manual</span> in the left navigation and
                read <span className="font-semibold text-slate-900">Account Setup & Account Recovery</span> for
                setup links, reset links, email delivery troubleshooting, monitor password recovery, and monitor MFA
                recovery.
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-700">
                The manual also explains Schools, Add School, Reviews, School Detail, and Audit Trail for the current
                monitor workspace.
              </p>
            </article>
          ) : (
            <>
              <article className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Activate your account</h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
                  <li>
                    Your Division Monitor sends you a{" "}
                    <span className="font-semibold text-slate-900">one-time setup link</span> by email.
                  </li>
                  <li>Open the link and set your password. This activates your account.</li>
                  <li>After setup, sign in using your 6-digit school code and your new password.</li>
                </ul>
              </article>

              <article className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Forgot your password?</h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
                  <li>CSPAMS does not have a public forgot-password email button for School Heads.</li>
                  <li>
                    Ask your Division Monitor to use{" "}
                    <span className="font-semibold text-slate-900">Reset Link</span> to send you a new setup link.
                  </li>
                </ul>
              </article>

              <article className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">Not receiving email?</h3>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
                  <li>Check spam/junk/promotions folders.</li>
                  <li>Confirm your email address in CSPAMS is correct.</li>
                  <li>If emails still do not arrive, tell your Division Monitor - email delivery may be misconfigured.</li>
                </ul>
              </article>
            </>
          )}
        </div>
      </section>
    </>
  );
}
