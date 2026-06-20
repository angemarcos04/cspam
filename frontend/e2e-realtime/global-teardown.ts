import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default async function globalTeardown(): Promise<void> {
  const testDir = fileURLToPath(new URL(".", import.meta.url));
  const databasePath = resolve(testDir, "..", "..", "database", "cspams_e2e_realtime.sqlite");

  // The backend harness also clears this file before every run. Ignore Windows locks during shutdown.
  await rm(databasePath, { force: true }).catch(() => undefined);
}
