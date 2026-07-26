import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FM_QAD_TEMPLATE_OPTIONS } from "@/constants/fmQadTemplates";

const EXPECTED_TEMPLATE_CODES = [
  "FM-QAD-001",
  "FM-QAD-002",
  "FM-QAD-003",
  "FM-QAD-004",
  "FM-QAD-008",
  "FM-QAD-009",
  "FM-QAD-010",
  "FM-QAD-011",
  "FM-QAD-034",
  "FM-QAD-041",
];
const ALLOWED_TEMPLATE_EXTENSIONS = new Set([".docx", ".xlsx", ".pdf"]);
const IGNORED_DIRECTORY_FILES = new Set([".gitkeep", ".DS_Store", "Thumbs.db"]);
const templateDirectory = path.resolve(process.cwd(), "public", "templates", "fm-qad");

describe("FM-QAD template configuration", () => {
  it("contains the ten expected templates with unique identifiers and filenames", () => {
    expect(FM_QAD_TEMPLATE_OPTIONS).toHaveLength(10);
    expect(FM_QAD_TEMPLATE_OPTIONS.map(({ code }) => code).sort()).toEqual(
      [...EXPECTED_TEMPLATE_CODES].sort(),
    );

    const ids = FM_QAD_TEMPLATE_OPTIONS.map(({ id }) => id);
    const codes = FM_QAD_TEMPLATE_OPTIONS.map(({ code }) => code);
    const filenames = FM_QAD_TEMPLATE_OPTIONS.map(({ filename }) => filename);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(filenames).size).toBe(filenames.length);
  });

  it("uses safe filenames that cannot escape the static template directory", () => {
    for (const { filename } of FM_QAD_TEMPLATE_OPTIONS) {
      expect(filename.trim().length).toBeGreaterThan(0);
      expect(filename).not.toContain("..");
      expect(filename).not.toContain("/");
      expect(filename).not.toContain("\\");
      expect(path.isAbsolute(filename)).toBe(false);
      expect(ALLOWED_TEMPLATE_EXTENSIONS.has(path.extname(filename).toLowerCase())).toBe(true);
    }
  });

  it("keeps configured templates and non-empty physical files synchronized", () => {
    expect(existsSync(templateDirectory)).toBe(true);

    const physicalTemplateFiles = readdirSync(templateDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !IGNORED_DIRECTORY_FILES.has(entry.name))
      .map((entry) => entry.name)
      .sort();
    const configuredFilenames = FM_QAD_TEMPLATE_OPTIONS
      .map(({ filename }) => filename)
      .sort();

    for (const filename of physicalTemplateFiles) {
      expect(ALLOWED_TEMPLATE_EXTENSIONS.has(path.extname(filename).toLowerCase())).toBe(true);
    }
    expect(physicalTemplateFiles).toEqual(configuredFilenames);

    for (const filename of configuredFilenames) {
      const filePath = path.join(templateDirectory, filename);

      expect(existsSync(filePath)).toBe(true);
      expect(statSync(filePath).isFile()).toBe(true);
      expect(statSync(filePath).size).toBeGreaterThan(0);
    }
  });
});
