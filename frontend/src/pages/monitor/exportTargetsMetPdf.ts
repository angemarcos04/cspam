import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type {
  MonitorDrawerKpiReportRow,
  MonitorDrawerSchoolAchievementReportRow,
  SchoolDetailSnapshot,
} from "@/pages/monitor/monitorDrawerTypes";

interface AutoTableState {
  finalY?: number;
}

type AutoTableAwareDocument = jsPDF & {
  lastAutoTable?: AutoTableState;
};

export interface ExportTargetsMetPdfInput {
  schoolDetail: SchoolDetailSnapshot;
  academicYearLabel: string | null;
  schoolAchievementRows: MonitorDrawerSchoolAchievementReportRow[];
  kpiRows: MonitorDrawerKpiReportRow[];
  generatedAt?: Date;
}

const PAGE_MARGIN_X = 14;
const PAGE_TOP_Y = 16;
const PAGE_BOTTOM_MARGIN = 14;

export function formatMetadataValue(value: string | number | null | undefined): string {
  const formatted = String(value ?? "").trim();
  return formatted || "N/A";
}

export function formatGeneratedAt(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

function normalizeReportLabel(value: string): string {
  return value
    .replace(/['']/g, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

export function findSchoolHeadName(rows: MonitorDrawerSchoolAchievementReportRow[]): string | null {
  const schoolHeadRow = rows.find((row) => normalizeReportLabel(row.label) === "NAME OF SCHOOL HEAD");
  const value = String(schoolHeadRow?.value ?? "").trim();
  return value && value !== "-" ? value : null;
}

export function sanitizeFilenamePart(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildTargetsMetFilename(input: Pick<ExportTargetsMetPdfInput, "schoolDetail" | "academicYearLabel">): string {
  const schoolPart = sanitizeFilenamePart(input.schoolDetail.schoolCode) || sanitizeFilenamePart(input.schoolDetail.schoolName);
  if (!schoolPart) {
    return "targets-met-report.pdf";
  }

  const academicYearPart = sanitizeFilenamePart(input.academicYearLabel);
  return ["targets-met", schoolPart, academicYearPart].filter(Boolean).join("-") + ".pdf";
}

function getLastAutoTableFinalY(doc: jsPDF, fallbackY: number): number {
  return (doc as AutoTableAwareDocument).lastAutoTable?.finalY ?? fallbackY;
}

function ensurePageSpace(doc: jsPDF, cursorY: number, requiredHeight: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (cursorY + requiredHeight <= pageHeight - PAGE_BOTTOM_MARGIN) {
    return cursorY;
  }

  doc.addPage();
  return PAGE_TOP_Y;
}

function addReportTitle(doc: jsPDF): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text("CSPAMS TARGETS-MET REPORT", PAGE_MARGIN_X, PAGE_TOP_Y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text("Official monitor export of the currently displayed TARGETS-MET report.", PAGE_MARGIN_X, PAGE_TOP_Y + 6);

  return PAGE_TOP_Y + 12;
}

function addMetadataTable(
  doc: jsPDF,
  input: ExportTargetsMetPdfInput,
  generatedAt: Date,
  cursorY: number,
): number {
  const schoolHeadName = findSchoolHeadName(input.schoolAchievementRows);
  const metadataRows = [
    ["School Name", formatMetadataValue(input.schoolDetail.schoolName)],
    ...(schoolHeadName ? [["School Head", schoolHeadName]] : []),
    ["School Code", formatMetadataValue(input.schoolDetail.schoolCode)],
    ["School Level / Coverage", formatMetadataValue(input.schoolDetail.level)],
    ["School Type", formatMetadataValue(input.schoolDetail.type)],
    ["Region", formatMetadataValue(input.schoolDetail.region)],
    ["Address", formatMetadataValue(input.schoolDetail.address)],
    ["Academic Year", formatMetadataValue(input.academicYearLabel)],
    ["Generated At", formatGeneratedAt(generatedAt)],
  ];

  autoTable(doc, {
    startY: cursorY,
    body: metadataRows,
    theme: "grid",
    margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X },
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: 2,
      lineColor: [203, 213, 225],
      lineWidth: 0.1,
      overflow: "linebreak",
      textColor: [15, 23, 42],
      valign: "top",
    },
    columnStyles: {
      0: { cellWidth: 43, fontStyle: "bold", fillColor: [248, 250, 252], textColor: [51, 65, 85] },
      1: { cellWidth: "auto" },
    },
  });

  return getLastAutoTableFinalY(doc, cursorY) + 8;
}

function addSectionTitle(doc: jsPDF, title: string, cursorY: number): number {
  const startY = ensurePageSpace(doc, cursorY, 18);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(title, PAGE_MARGIN_X, startY);
  return startY + 5;
}

function addSchoolAchievementTable(
  doc: jsPDF,
  academicYearLabel: string,
  rows: MonitorDrawerSchoolAchievementReportRow[],
  cursorY: number,
): number {
  if (rows.length === 0) {
    return cursorY;
  }

  const startY = addSectionTitle(doc, `School's Achievement (SY ${academicYearLabel})`, cursorY);
  autoTable(doc, {
    startY,
    head: [["Metric", "Value"]],
    body: rows.map((row) => [row.label, row.value]),
    theme: "grid",
    margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X },
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: 2,
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
      overflow: "linebreak",
      textColor: [15, 23, 42],
      valign: "top",
    },
    headStyles: {
      fillColor: [241, 245, 249],
      fontStyle: "bold",
      halign: "left",
      textColor: [51, 65, 85],
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: "auto", halign: "right" },
    },
  });

  return getLastAutoTableFinalY(doc, startY) + 8;
}

function addKpiTable(
  doc: jsPDF,
  academicYearLabel: string,
  rows: MonitorDrawerKpiReportRow[],
  cursorY: number,
): number {
  if (rows.length === 0) {
    return cursorY;
  }

  const startY = addSectionTitle(doc, `Key Performance Indicators (SY ${academicYearLabel})`, cursorY);
  autoTable(doc, {
    startY,
    head: [["Indicator", "Target", "Actual", "Status"]],
    body: rows.map((row) => [row.label, row.target, row.actual, row.status]),
    theme: "grid",
    margin: { left: PAGE_MARGIN_X, right: PAGE_MARGIN_X },
    styles: {
      font: "helvetica",
      fontSize: 8.3,
      cellPadding: 2,
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
      overflow: "linebreak",
      textColor: [15, 23, 42],
      valign: "top",
    },
    headStyles: {
      fillColor: [241, 245, 249],
      fontStyle: "bold",
      halign: "center",
      textColor: [51, 65, 85],
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 90, halign: "left" },
      1: { cellWidth: 29, halign: "center" },
      2: { cellWidth: 29, halign: "center" },
      3: { cellWidth: "auto", halign: "center" },
    },
  });

  return getLastAutoTableFinalY(doc, startY) + 8;
}

function addFooterPageNumbers(doc: jsPDF): void {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("Generated by CSPAMS", PAGE_MARGIN_X, pageHeight - 8);
    doc.text(`Page ${pageNumber} of ${pageCount}`, pageWidth - PAGE_MARGIN_X, pageHeight - 8, { align: "right" });
  }
}

export function exportTargetsMetPdf(input: ExportTargetsMetPdfInput): void {
  if (input.schoolAchievementRows.length === 0 && input.kpiRows.length === 0) {
    return;
  }

  const generatedAt = input.generatedAt ?? new Date();
  const academicYearLabel = formatMetadataValue(input.academicYearLabel);
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  let cursorY = addReportTitle(doc);
  cursorY = addMetadataTable(doc, input, generatedAt, cursorY);
  cursorY = addSchoolAchievementTable(doc, academicYearLabel, input.schoolAchievementRows, cursorY);
  addKpiTable(doc, academicYearLabel, input.kpiRows, cursorY);
  addFooterPageNumbers(doc);

  doc.save(buildTargetsMetFilename(input));
}
