import type { ComponentType } from "react";
import {
  Building2,
  ClipboardList,
  Filter,
  ListChecks,
  Plus,
  ScrollText,
} from "lucide-react";
import type {
  MonitorTopNavigatorId,
  RequirementFilter,
  SchoolQuickPreset,
} from "@/pages/monitor/monitorFilters";

export interface MonitorTopNavigatorItem {
  id: MonitorTopNavigatorId;
  label: string;
}

export interface ManualStep {
  id: string;
  title: string;
  objective: string;
  actions: string[];
  doneWhen: string;
}

export type NavigatorIcon = ComponentType<{ className?: string }>;

export interface QuickJumpItem {
  id: string;
  label: string;
  targetId: string;
  icon: NavigatorIcon;
}

export const MONITOR_TOP_NAVIGATOR_ITEMS: MonitorTopNavigatorItem[] = [
  { id: "schools", label: "Schools" },
  { id: "add_school", label: "Add School" },
  { id: "reviews", label: "Reviews" },
  { id: "audit", label: "Audit Trail" },
];

export const MONITOR_TOP_NAVIGATOR_IDS: MonitorTopNavigatorId[] = MONITOR_TOP_NAVIGATOR_ITEMS.map(
  (item) => item.id,
);

export const MONITOR_NAVIGATOR_ICONS: Record<MonitorTopNavigatorId, NavigatorIcon> = {
  schools: Building2,
  add_school: Plus,
  reviews: ClipboardList,
  audit: ScrollText,
};

export const MONITOR_NAVIGATOR_MANUAL: ManualStep[] = [
  {
    id: "schools",
    title: "Schools",
    objective: "",
    actions: [
      "Use search and school filters to find the school you need quickly.",
      "Use Accounts for School Head account management.",
      "Use More for CSV import/export, archived schools, and MFA recovery requests.",
      "Open school details without leaving the dashboard.",
    ],
    doneWhen: "The selected school or management task is open in the Schools section.",
  },
  {
    id: "add_school",
    title: "Add School",
    objective: "",
    actions: [
      "Create a school record and optional School Head account from the dedicated Add School section.",
      "Stay in Add School after create, or use View Schools when you need to browse existing records.",
    ],
    doneWhen: "The school record form is submitted or reset without leaving the section.",
  },
  {
    id: "reviews",
    title: "Reviews",
    objective: "",
    actions: [
      "Review inbox items, validate submissions, or return with clear notes.",
      "Use lane and workflow filters to process urgent schools first.",
    ],
    doneWhen: "Each queued school has a clear review action.",
  },
];

export const MONITOR_MANUAL_STATUS_GUIDE = [
  "Not Submitted - The school has not submitted this requirement yet.",
  "For Review - The school submitted the requirement and it is waiting for monitor review.",
  "Returned for Correction - The monitor returned the requirement because something needs to be fixed.",
  "Submitted - The school sent the package or requirement.",
  "Validated - The requirement was checked and accepted.",
  "Missing - Required data or a required file is still missing.",
];

export const REQUIREMENT_FILTER_OPTIONS: Array<{ id: RequirementFilter; label: string }> = [
  { id: "all", label: "All statuses" },
  { id: "missing", label: "Not Submitted" },
  { id: "waiting", label: "For Review" },
  { id: "returned", label: "Returned for Correction" },
  { id: "submitted", label: "Submitted" },
  { id: "validated", label: "Validated" },
];

// Keep these ids stable because URL params and localStorage already persist them.
// The user-facing labels intentionally use newer submission-centric wording.
export const SCHOOL_QUICK_PRESET_OPTIONS: Array<{
  id: SchoolQuickPreset;
  label: string;
  hint: string;
}> = [
  { id: "all", label: "All", hint: "Show every school in the current scope." },
  { id: "pending", label: "Submitted for Review", hint: "Schools with submitted requirements waiting for monitor review." },
  { id: "missing", label: "Submission Incomplete", hint: "Schools still missing one or more required submissions." },
  { id: "returned", label: "Returned for Correction", hint: "Schools with submissions returned for correction." },
  { id: "no_submission", label: "Not Submitted", hint: "Schools with no submitted requirement package yet." },
];

export const MONITOR_QUICK_JUMPS: Record<MonitorTopNavigatorId, QuickJumpItem[]> = {
  reviews: [
    { id: "filters_queue", label: "Filters", targetId: "monitor-submission-filters", icon: Filter },
    { id: "queue_list", label: "Review Inbox", targetId: "monitor-requirements-table", icon: ListChecks },
  ],
  schools: [],
  add_school: [],
  audit: [],
};

export const REQUIREMENT_PAGE_SIZE = 10;
export const RECORD_PAGE_SIZE = 10;
