import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { messageForApiError } from "@/lib/api";
import type { MonitorSchoolRequirementSummary } from "@/pages/monitor/MonitorSchoolRecordsList";
import type { MonitorTopNavigatorId } from "@/pages/monitor/monitorFilters";
import { normalizeSchoolKey } from "@/pages/monitor/monitorRequirementRules";
import type { SchoolRecord, SchoolReminderReceipt } from "@/types";

type ToastTone = "success" | "info" | "warning";

interface SchoolActionSummary {
  schoolKey: string;
  schoolName: string;
}

interface UseMonitorSchoolActionRouterArgs {
  scopedRecordBySchoolKey: Map<string, SchoolRecord>;
  recordBySchoolKey: Map<string, SchoolRecord>;
  schoolRequirementByKey: Map<string, MonitorSchoolRequirementSummary>;
  setActiveTopNavigator: Dispatch<SetStateAction<MonitorTopNavigatorId>>;
  openSchoolDrawer: (schoolKey: string) => void;
  focusAndScrollTo: (targetId: string) => void;
  pushToast: (message: string, tone?: ToastTone) => void;
  sendReminder: (id: string, notes?: string | null) => Promise<SchoolReminderReceipt>;
}

export interface UseMonitorSchoolActionRouterResult {
  remindingSchoolKey: string | null;
  sendReminderForSchool: (schoolKey: string, schoolName: string, notes?: string | null) => Promise<void>;
  handleReviewSchool: (summary: SchoolActionSummary) => void;
  handleOpenSchool: (summary: SchoolActionSummary) => void;
  handleSendReminder: (summary: SchoolActionSummary, notes?: string | null) => Promise<void>;
  handleReviewRecord: (record: SchoolRecord) => void;
  handleOpenSchoolRecord: (record: SchoolRecord) => void;
}

function scheduleFocus(focusAndScrollTo: (targetId: string) => void, targetId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.setTimeout(() => {
    focusAndScrollTo(targetId);
  }, 80);
}

function reminderToastForReceipt(receipt: SchoolReminderReceipt): { message: string; tone: ToastTone } {
  if (receipt.dashboardStatus === "failed") {
    return {
      message: `Unable to create School Head dashboard notification for ${receipt.schoolName}.`,
      tone: "warning",
    };
  }

  if (receipt.emailStatus === "queued") {
    return {
      message: `Dashboard reminder sent to ${receipt.schoolName}. Email queued.`,
      tone: "success",
    };
  }

  if (receipt.emailStatus === "failed" || receipt.deliveryStatus === "partial") {
    return {
      message: `Dashboard reminder sent to ${receipt.schoolName}, but email delivery failed.`,
      tone: "warning",
    };
  }

  return {
    message: `Reminder sent to ${receipt.schoolName}.`,
    tone: "success",
  };
}

export function useMonitorSchoolActionRouter({
  scopedRecordBySchoolKey,
  recordBySchoolKey,
  schoolRequirementByKey,
  setActiveTopNavigator,
  openSchoolDrawer,
  focusAndScrollTo,
  pushToast,
  sendReminder,
}: UseMonitorSchoolActionRouterArgs): UseMonitorSchoolActionRouterResult {
  const [remindingSchoolKey, setRemindingSchoolKey] = useState<string | null>(null);

  const sendReminderForSchool = useCallback(
    async (schoolKey: string, schoolName: string, notes?: string | null) => {
      const record = scopedRecordBySchoolKey.get(schoolKey) ?? recordBySchoolKey.get(schoolKey);
      if (!record) {
        pushToast(`Unable to send reminder for ${schoolName}: school record not found.`, "warning");
        return;
      }

      setRemindingSchoolKey(schoolKey);
      try {
        const receipt = await sendReminder(record.id, notes);
        const toast = reminderToastForReceipt(receipt);
        pushToast(toast.message, toast.tone);
      } catch (err) {
        const message = messageForApiError(err, `Unable to send reminder for ${schoolName}.`);
        pushToast(message, "warning");
      } finally {
        setRemindingSchoolKey((current) => (current === schoolKey ? null : current));
      }
    },
    [pushToast, recordBySchoolKey, scopedRecordBySchoolKey, sendReminder],
  );

  const handleReviewSchool = useCallback(
    (summary: SchoolActionSummary) => {
      setActiveTopNavigator("reviews");
      openSchoolDrawer(summary.schoolKey);
      pushToast(`Opened school details for ${summary.schoolName}.`, "info");
    },
    [openSchoolDrawer, pushToast, setActiveTopNavigator],
  );

  const handleOpenSchool = useCallback(
    (summary: SchoolActionSummary) => {
      setActiveTopNavigator("schools");
      openSchoolDrawer(summary.schoolKey);
      scheduleFocus(focusAndScrollTo, "monitor-school-records");
      pushToast(`Opened school details for ${summary.schoolName}.`, "info");
    },
    [focusAndScrollTo, openSchoolDrawer, pushToast, setActiveTopNavigator],
  );

  const handleSendReminder = useCallback(
    async (summary: SchoolActionSummary, notes?: string | null) => {
      await sendReminderForSchool(summary.schoolKey, summary.schoolName, notes);
    },
    [sendReminderForSchool],
  );

  const handleReviewRecord = useCallback(
    (record: SchoolRecord) => {
      const schoolKey = normalizeSchoolKey(record.schoolId ?? record.schoolCode ?? null, record.schoolName);
      if (schoolKey === "unknown") {
        pushToast(`Unable to open review for ${record.schoolName}: school key is missing.`, "warning");
        return;
      }

      const summary = schoolRequirementByKey.get(schoolKey);
      if (summary) {
        handleReviewSchool(summary);
        return;
      }

      setActiveTopNavigator("reviews");
      openSchoolDrawer(schoolKey);
      pushToast(`Opened school details for ${record.schoolName}.`, "info");
    },
    [handleReviewSchool, openSchoolDrawer, pushToast, schoolRequirementByKey, setActiveTopNavigator],
  );

  const handleOpenSchoolRecord = useCallback(
    (record: SchoolRecord) => {
      const schoolKey = normalizeSchoolKey(record.schoolId ?? record.schoolCode ?? null, record.schoolName);
      if (schoolKey === "unknown") {
        pushToast(`Unable to open school details for ${record.schoolName}: school key is missing.`, "warning");
        return;
      }

      setActiveTopNavigator("schools");
      openSchoolDrawer(schoolKey);
      scheduleFocus(focusAndScrollTo, "monitor-school-records");
      pushToast(`Opened school details for ${record.schoolName}.`, "info");
    },
    [focusAndScrollTo, openSchoolDrawer, pushToast, setActiveTopNavigator],
  );

  return {
    remindingSchoolKey,
    sendReminderForSchool,
    handleReviewSchool,
    handleOpenSchool,
    handleSendReminder,
    handleReviewRecord,
    handleOpenSchoolRecord,
  };
}
