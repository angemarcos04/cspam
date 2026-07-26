import type { ComponentType } from "react";
import type { UserRole } from "@/types";

export interface DashboardRouteModule {
  default: ComponentType;
}

export const loadMonitorDashboardRoute = (): Promise<DashboardRouteModule> =>
  import("@/pages/MonitorDashboard").then((module) => ({
    default: module.MonitorDashboard,
  }));

export const loadSchoolAdminDashboardRoute = (): Promise<DashboardRouteModule> =>
  import("@/pages/SchoolAdminDashboard").then((module) => ({
    default: module.SchoolAdminDashboard,
  }));

const preloadPromises = new Map<Exclude<UserRole, null>, Promise<void>>();

export function preloadDashboardRoute(role: Exclude<UserRole, null>): Promise<void> {
  const existingPromise = preloadPromises.get(role);
  if (existingPromise) {
    return existingPromise;
  }

  const loader = role === "monitor"
    ? loadMonitorDashboardRoute
    : loadSchoolAdminDashboardRoute;
  const preloadPromise = loader()
    .then(() => undefined)
    .catch((error: unknown) => {
      preloadPromises.delete(role);
      throw error;
    });

  preloadPromises.set(role, preloadPromise);
  return preloadPromise;
}
