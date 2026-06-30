import { MONITOR_MANUAL_STATUS_GUIDE } from "@/pages/monitor/monitorDashboardConfig";

interface MonitorManualScreenProps {
  onClose: () => void;
}

interface ManualSection {
  id: string;
  title: string;
  purpose: string;
  actions: string[];
  doneWhen?: string;
}

interface AccountManualSection {
  title: string;
  actions: string[];
}

const MONITOR_MANUAL_SECTIONS: ManualSection[] = [
  {
    id: "dashboard-overview",
    title: "Dashboard Overview",
    purpose: "Use the left navigation to move between monitor sections. Each section has one main purpose.",
    actions: [
      "Schools is for viewing the school list.",
      "Add School is for creating a new school record.",
      "Reviews is for checking schools that need monitoring action.",
      "Audit Trail is for reviewing system activity.",
      "User Manual explains how to use the monitor workspace.",
      "Use Refresh to load the latest dashboard data before reviewing schools.",
    ],
    doneWhen: "You know which section to open for the task you need to complete.",
  },
  {
    id: "schools",
    title: "Schools",
    purpose: "Use Schools to view all schools in your assigned monitoring scope.",
    actions: [
      "Check the school name, school code, location, and visible status.",
      "Use filters to narrow the list when needed.",
      "Click Open to view a school's details.",
      "This page is only for browsing and opening school records.",
      "Adding schools is handled in the Add School section.",
    ],
    doneWhen: "You found the school you need or opened its details for checking.",
  },
  {
    id: "add-school",
    title: "Add School",
    purpose: "Use Add School to create a new school record.",
    actions: [
      "Enter the required school information: School Code, School Name, Level, Type, and Address.",
      "Choose the correct Level: Elementary or High School.",
      "Choose the correct Type: Public or Private.",
      "You may create a School Head account during school creation. Enter the School Head name and email if that option is enabled.",
      "After saving, stay on Add School to confirm the result. Use View Schools only if you need to return to the school list.",
    ],
    doneWhen: "The school record is created and the School Head account setup is ready if selected.",
  },
  {
    id: "reviews",
    title: "Reviews",
    purpose: "Use Reviews to check schools that need monitoring action.",
    actions: [
      "The Review Inbox shows School, Location, Level, Type, Status, Last Activity, and Actions.",
      "Click Review to open the School Detail drawer.",
      "Click Reminder when the school needs follow-up about missing or pending requirements.",
      "Review urgent or returned schools first, then continue with routine checks.",
    ],
    doneWhen: "Each school in the Review Inbox has been reviewed, reminded, verified, or returned as needed.",
  },
  {
    id: "school-detail",
    title: "School Detail",
    purpose: "The School Detail drawer shows the selected school's monitoring information.",
    actions: [
      "Use the Academic Year selector to choose the school year you want to inspect.",
      "The Submissions tab shows Requirement, Status, Submitted, and Action.",
      "Use View to inspect a submitted file or form section.",
      "Use Verify when the requirement is correct.",
      "Use Return when the school must correct or resubmit the requirement.",
      "Use Unverify when a verified requirement must be reopened for review.",
      "Write a clear return note so the School Head knows what to fix.",
      "Use Indicator History to review submitted school indicators.",
      "Use Audit Trail to check recent activity for the selected school.",
    ],
    doneWhen: "Each requirement row has the correct review action or no action is needed.",
  },
  {
    id: "audit-trail",
    title: "Audit Trail",
    purpose: "Use Audit Trail to check system activity.",
    actions: [
      "Confirm what changed, who performed an action, and when the action happened.",
      "Use this section when you need to verify review activity, account activity, or recent school updates.",
    ],
    doneWhen: "You confirmed the relevant activity record.",
  },
];

const ACCOUNT_RECOVERY_SECTIONS: AccountManualSection[] = [
  {
    title: "School Head Account Setup",
    actions: [
      "Use account setup when a School Head needs access to CSPAMS.",
      "When a School Head account is created, CSPAMS can send a one-time setup link to the School Head email address.",
      "The setup link allows the School Head to set a password and activate the account.",
      "CSPAMS should not send plain-text passwords.",
      "If the setup email is not received, confirm that the email address is correct, then issue a new setup link if account tools are available.",
    ],
  },
  {
    title: "School Head Password Reset",
    actions: [
      "Use a reset link when a School Head cannot sign in or needs a new setup link.",
      "A reset or setup link should be sent to the registered School Head email address.",
      "The link is one-time use and may expire.",
      "If the link expires, issue a new one.",
    ],
  },
  {
    title: "Confirmation Codes for Sensitive Actions",
    actions: [
      "Some account actions require a confirmation code before they can be completed.",
      "Examples may include locking, suspending, archiving, removing, or resetting account access.",
      "When prompted, send the confirmation code, check the monitor email inbox, enter the code, then confirm the action.",
    ],
  },
  {
    title: "Email Delivery Troubleshooting",
    actions: [
      "Check that the recipient email address is real and correctly typed.",
      "Ask the recipient to check spam or junk folders.",
      "Check whether the system is configured to send real email or only log emails.",
      "If email delivery failed, verify the mail provider credentials and deployment email settings.",
      "For Gmail SMTP, the mail password must be a Google App Password, not the normal Gmail password.",
    ],
  },
  {
    title: "Division Monitor Password Recovery",
    actions: [
      "Go to the Sign In page.",
      "Choose Division Monitor.",
      "Click Forgot password?",
      "Open the reset email.",
      "Set a new password.",
      "Sign in again.",
    ],
  },
  {
    title: "Division Monitor MFA Recovery",
    actions: [
      "Try the 6-digit email code first.",
      "Use a stored backup code if available.",
      "If neither option works, request MFA recovery from the sign-in MFA screen.",
      "After recovery, store the new backup codes securely.",
      "Production recovery should require another active Division Monitor to approve the request.",
    ],
  },
];

const QUICK_REMINDERS = [
  "Refresh before reviewing if the data may be outdated.",
  "Review urgent or returned schools first.",
  "Use clear return notes.",
  "Use reminders only when the school needs follow-up.",
  "Check the academic year before verifying or returning requirements.",
  "Use Audit Trail when you need to confirm recent activity.",
];

function ManualCard({ section }: { section: ManualSection }) {
  return (
    <article className="rounded-sm border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-bold text-slate-900">{section.title}</h3>
      <p className="mt-2 text-sm font-medium text-slate-700">{section.purpose}</p>
      <ul className="mt-3 space-y-1.5">
        {section.actions.map((action) => (
          <li key={`${section.id}-${action}`} className="ml-5 list-disc text-sm text-slate-700">
            {action}
          </li>
        ))}
      </ul>
      {section.doneWhen ? (
        <p className="mt-3 rounded-sm border border-primary-100 bg-primary-50 px-3 py-2 text-sm font-semibold text-primary-700">
          Done when: {section.doneWhen}
        </p>
      ) : null}
    </article>
  );
}

export function MonitorManualScreen({ onClose }: MonitorManualScreenProps) {
  return (
    <section
      id="monitor-user-manual"
      className="dashboard-shell mb-5 overflow-hidden rounded-sm border border-slate-200 bg-white"
    >
      <div className="p-4 md:p-6 xl:p-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          <header className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-700">
              Division Monitor Dashboard
            </p>
            <h2 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">User Manual</h2>
            <p className="mx-auto mt-2 max-w-3xl text-sm text-slate-600 md:text-base">
              Use this guide to choose the right dashboard section, review school submissions, and handle account
              setup or recovery without changing live data.
            </p>
          </header>

          <div className="grid gap-4 lg:grid-cols-2">
            {MONITOR_MANUAL_SECTIONS.map((section) => (
              <ManualCard key={section.id} section={section} />
            ))}
          </div>

          <article className="rounded-sm border border-slate-200 bg-slate-50 p-4 md:p-5">
            <h3 className="text-base font-bold text-slate-900">Account Setup & Account Recovery</h3>
            <p className="mt-2 max-w-3xl text-sm text-slate-700">
              Use this section for setup links, reset links, email delivery checks, monitor password recovery, and
              monitor MFA recovery.
            </p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {ACCOUNT_RECOVERY_SECTIONS.map((section) => (
                <section key={section.title} className="rounded-sm border border-slate-200 bg-white p-3">
                  <h4 className="text-sm font-bold text-slate-900">{section.title}</h4>
                  <ul className="mt-2 space-y-1.5">
                    {section.actions.map((action) => (
                      <li key={`${section.title}-${action}`} className="ml-5 list-disc text-sm text-slate-700">
                        {action}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </article>

          <div className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-sm border border-slate-200 bg-white p-4 md:p-5">
              <h3 className="text-sm font-bold text-slate-900">Status Guide</h3>
              <ul className="mt-3 space-y-2">
                {MONITOR_MANUAL_STATUS_GUIDE.map((item) => (
                  <li key={item} className="ml-5 list-disc text-sm text-slate-700">
                    {item}
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-sm border border-primary-200 bg-primary-50 p-4 md:p-5">
              <h3 className="text-sm font-bold text-primary-700">Quick Reminders</h3>
              <ul className="mt-3 space-y-2">
                {QUICK_REMINDERS.map((item) => (
                  <li key={item} className="ml-5 list-disc text-sm text-primary-700">
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex w-full items-center justify-center gap-2 rounded-sm border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Return to Dashboard Data
          </button>
        </div>
      </div>
    </section>
  );
}
