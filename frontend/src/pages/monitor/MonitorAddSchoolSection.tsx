import { MonitorSchoolRecordForm, type MonitorSchoolRecordFormProps } from "@/pages/monitor/MonitorSchoolRecordForm";

interface MonitorAddSchoolSectionProps {
  sectionFocusClass: (targetId: string) => string;
  schoolRecordFormProps: MonitorSchoolRecordFormProps;
  onViewSchools: () => void;
}

export function MonitorAddSchoolSection({
  sectionFocusClass,
  schoolRecordFormProps,
  onViewSchools,
}: MonitorAddSchoolSectionProps) {
  return (
    <section
      id="monitor-add-school"
      className={`surface-panel dashboard-shell overflow-hidden ${sectionFocusClass("monitor-add-school")}`}
    >
      <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Add School</h2>
          </div>
          <button
            type="button"
            onClick={onViewSchools}
            className="inline-flex items-center justify-center rounded-sm border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            View Schools
          </button>
        </div>
      </div>

      <MonitorSchoolRecordForm
        {...schoolRecordFormProps}
        show
        editingRecordId={null}
      />
    </section>
  );
}
