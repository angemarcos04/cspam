import type { SchoolHeadAccountSummary, SchoolRecord } from "@/types";

const ACCOUNT_STATUS_OVERRIDE_TTL_MS = 120_000;

export interface MonitorAccountStatusOverride {
  schoolId: string;
  schoolCode: string;
  accountStatus: string;
  account: SchoolHeadAccountSummary;
  appliedAt: number;
  expiresAt: number;
}

function normalizeAccountOverrideKey(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function matchesAccountOverride(record: SchoolRecord, override: MonitorAccountStatusOverride): boolean {
  const recordId = normalizeAccountOverrideKey(record.id);
  const schoolId = normalizeAccountOverrideKey(record.schoolId);
  const schoolCode = normalizeAccountOverrideKey(record.schoolCode);
  const overrideSchoolId = normalizeAccountOverrideKey(override.schoolId);
  const overrideSchoolCode = normalizeAccountOverrideKey(override.schoolCode);

  return (
    (Boolean(overrideSchoolId) && (recordId === overrideSchoolId || schoolId === overrideSchoolId)) ||
    (Boolean(overrideSchoolCode) && (schoolCode === overrideSchoolCode || schoolId === overrideSchoolCode))
  );
}

function accountMatchesOverrideAccount(
  serverAccount: SchoolHeadAccountSummary | null | undefined,
  overrideAccount: SchoolHeadAccountSummary,
): boolean {
  if (!serverAccount) {
    return false;
  }

  return (
    String(serverAccount.accountStatus ?? "").trim().toLowerCase() === String(overrideAccount.accountStatus ?? "").trim().toLowerCase() &&
    String(serverAccount.lifecycleState ?? "").trim().toLowerCase() === String(overrideAccount.lifecycleState ?? "").trim().toLowerCase() &&
    String(serverAccount.lifecycleStateLabel ?? "").trim() === String(overrideAccount.lifecycleStateLabel ?? "").trim() &&
    String(serverAccount.recommendedAction ?? "").trim().toLowerCase() === String(overrideAccount.recommendedAction ?? "").trim().toLowerCase() &&
    String(serverAccount.temporaryPasswordDisplay ?? "").trim() === String(overrideAccount.temporaryPasswordDisplay ?? "").trim()
  );
}

export function buildMonitorAccountStatusOverride(
  schoolId: string,
  record: SchoolRecord | null | undefined,
  account: SchoolHeadAccountSummary,
  now = Date.now(),
): MonitorAccountStatusOverride {
  return {
    schoolId,
    schoolCode: record?.schoolCode ?? record?.schoolId ?? "",
    accountStatus: String(account.accountStatus ?? "").trim().toLowerCase(),
    account,
    appliedAt: now,
    expiresAt: now + ACCOUNT_STATUS_OVERRIDE_TTL_MS,
  };
}

export function applyMonitorAccountStatusOverrides(
  records: SchoolRecord[],
  overrides: Record<string, MonitorAccountStatusOverride>,
): SchoolRecord[] {
  const overrideList = Object.values(overrides);
  if (overrideList.length === 0) {
    return records;
  }

  return records.map((record) => {
    const override = overrideList.find((candidate) => matchesAccountOverride(record, candidate));
    if (!override) {
      return record;
    }

    return {
      ...record,
      schoolHeadAccount: override.account,
    };
  });
}

export function pruneMonitorAccountStatusOverrides(
  records: SchoolRecord[],
  overrides: Record<string, MonitorAccountStatusOverride>,
  now = Date.now(),
): Record<string, MonitorAccountStatusOverride> {
  let changed = false;
  const next = { ...overrides };

  for (const [key, override] of Object.entries(overrides)) {
    if (override.expiresAt <= now) {
      delete next[key];
      changed = true;
      continue;
    }

    const matchingRecord = records.find((record) => matchesAccountOverride(record, override));
    if (accountMatchesOverrideAccount(matchingRecord?.schoolHeadAccount, override.account)) {
      delete next[key];
      changed = true;
    }
  }

  return changed ? next : overrides;
}
