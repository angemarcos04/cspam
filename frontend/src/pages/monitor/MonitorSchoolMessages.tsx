import type { SchoolBulkImportResult } from "@/types";

export interface MonitorSchoolMessagesProps {
  deleteError: string;
  bulkImportError: string;
  bulkImportSummary: SchoolBulkImportResult | null;
  onReviewMissingAccounts?: () => void;
}

export function MonitorSchoolMessages({
  deleteError,
  bulkImportError,
  bulkImportSummary,
  onReviewMissingAccounts,
}: MonitorSchoolMessagesProps) {
  const generatedPasswords =
    bulkImportSummary?.results.filter((result) => result.temporaryPassword && result.schoolHeadEmail) ?? [];
  const warnings = bulkImportSummary?.results.filter((result) => result.warning) ?? [];
  const accountSummary = bulkImportSummary?.accounts ?? null;
  const shouldExplainMissingAccounts =
    Boolean(accountSummary) && (accountSummary?.created ?? 0) === 0 && (accountSummary?.none ?? 0) > 0;

  const copyTemporaryPassword = (password: string) => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(password);
  };

  return (
    <>
      {deleteError && (
        <div className="mx-5 mt-4 rounded-sm border border-primary-200 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700">
          {deleteError}
        </div>
      )}
      {bulkImportError && (
        <div className="mx-5 mt-4 rounded-sm border border-primary-200 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700">
          {bulkImportError}
        </div>
      )}
      {bulkImportSummary && (
        <div className="mx-5 mt-4 rounded-sm border border-primary-200 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700">
          Import complete: {bulkImportSummary.created} created, {bulkImportSummary.updated} updated,{" "}
          {bulkImportSummary.restored} restored, {bulkImportSummary.skipped} skipped, {bulkImportSummary.failed} failed.
          {accountSummary ? (
            <div className="mt-3 rounded-sm border border-primary-200 bg-white p-2 text-primary-900">
              <p className="font-bold">Account outcomes</p>
              <p className="mt-1">
                {accountSummary.created} created, {accountSummary.unchanged} unchanged,{" "}
                {accountSummary.skippedExistingAccount} existing skipped, {accountSummary.failed} failed,{" "}
                {accountSummary.none} without account fields.
              </p>
              {shouldExplainMissingAccounts ? (
                <div className="mt-2 flex flex-col gap-2 rounded-sm border border-amber-200 bg-amber-50 p-2 text-amber-800 sm:flex-row sm:items-center sm:justify-between">
                  <p>
                    No School Head accounts were created. Fill school_head_name and school_head_email in the CSV, or
                    use Create account.
                  </p>
                  {onReviewMissingAccounts ? (
                    <button
                      type="button"
                      onClick={onReviewMissingAccounts}
                      className="inline-flex shrink-0 items-center justify-center rounded-sm border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-800 transition hover:bg-amber-50"
                    >
                      Review schools needing accounts
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {generatedPasswords.length > 0 ? (
            <div className="mt-3 rounded-sm border border-primary-200 bg-white p-2 text-primary-900">
              <p className="font-bold">Temporary passwords generated</p>
              <div className="mt-2 space-y-2">
                {generatedPasswords.map((result) => (
                  <div key={`${result.row}-${result.schoolId}`} className="flex flex-wrap items-center gap-2">
                    <span>
                      {result.schoolName ?? result.schoolId} ({result.schoolHeadEmail}):
                    </span>
                    <span className="rounded-sm border border-primary-200 bg-primary-50 px-2 py-0.5 font-mono">
                      {result.temporaryPassword}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyTemporaryPassword(String(result.temporaryPassword))}
                      className="rounded-sm border border-primary-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-primary-700 transition hover:bg-primary-50"
                    >
                      Copy
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <div className="mt-3 rounded-sm border border-amber-200 bg-amber-50 p-2 text-amber-800">
              <p className="font-bold">Import warnings</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {warnings.map((result) => (
                  <li key={`${result.row}-${result.schoolId}-warning`}>
                    {result.schoolName ?? result.schoolId}: {result.warning}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
