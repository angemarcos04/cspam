import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, "..");
const repoRoot = resolve(frontendRoot, "..");
const outputPath = resolve(frontendRoot, "dist", "cspams-build-info.json");

function readGitValue(args, fallback) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

const info = {
  app: "CSPAMS",
  commit: readGitValue(["rev-parse", "HEAD"], "unknown"),
  shortCommit: readGitValue(["rev-parse", "--short", "HEAD"], "unknown"),
  branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"], "unknown"),
  builtAt: new Date().toISOString(),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(info, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
