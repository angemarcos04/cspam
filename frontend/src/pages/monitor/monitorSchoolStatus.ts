import type { SchoolRecord, SchoolStatus } from "@/types";

export function resolveMonitorSchoolDisplayStatus(record: SchoolRecord | null | undefined): SchoolStatus {
  const accountStatus = String(record?.schoolHeadAccount?.accountStatus ?? "").trim().toLowerCase();
  if (accountStatus === "suspended") {
    return "inactive";
  }

  return record?.status ?? "pending";
}

export function monitorSchoolStatusLabel(status: SchoolStatus | null | undefined): string {
  if (status === "active") return "Active";
  if (status === "inactive") return "Suspended";
  if (status === "pending") return "Pending";
  return "Pending";
}
