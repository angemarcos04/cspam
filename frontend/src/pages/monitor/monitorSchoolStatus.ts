import type { SchoolRecord, SchoolStatus } from "@/types";

export function resolveMonitorSchoolDisplayStatus(record: SchoolRecord | null | undefined): SchoolStatus {
  return record?.status ?? "pending";
}

export function monitorSchoolStatusLabel(status: SchoolStatus | null | undefined): string {
  if (status === "active") return "Active";
  if (status === "inactive") return "Suspended";
  if (status === "pending") return "Pending";
  return "Pending";
}
