import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { AuthProvider, useAuth } from "@/context/Auth";
import { DataProvider } from "@/context/Data";
import { IndicatorDataProvider } from "@/context/IndicatorData";
import { NotificationProvider } from "@/context/Notifications";
import { StudentDataProvider } from "@/context/StudentData";
import { TeacherDataProvider } from "@/context/TeacherData";
import type { UserRole } from "@/types";
import { Login } from "@/pages/Login";
import { startRealtimeBridge, stopRealtimeBridge } from "@/lib/realtime";

const ForgotPassword = lazy(() => import("@/pages/ForgotPassword").then((module) => ({ default: module.ForgotPassword })));
const MfaResetComplete = lazy(() => import("@/pages/MfaResetComplete").then((module) => ({ default: module.MfaResetComplete })));
const MfaResetRequest = lazy(() => import("@/pages/MfaResetRequest").then((module) => ({ default: module.MfaResetRequest })));
const MonitorDashboard = lazy(() => import("@/pages/MonitorDashboard").then((module) => ({ default: module.MonitorDashboard })));
const ResetPassword = lazy(() => import("@/pages/ResetPassword").then((module) => ({ default: module.ResetPassword })));
const SchoolAdminDashboard = lazy(() => import("@/pages/SchoolAdminDashboard").then((module) => ({ default: module.SchoolAdminDashboard })));
const SetupAccount = lazy(() => import("@/pages/SetupAccount").then((module) => ({ default: module.SetupAccount })));

function FullscreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page-bg px-4">
      <div className="surface-panel flex w-full max-w-sm items-center gap-3 border p-5">
        <img src="/depedlogo.png" alt="DepEd logo" className="h-11 w-auto bg-white px-1.5 py-1" />
        <div className="flex-1">
          <p className="text-sm font-bold text-primary-800">CSPAMS</p>
          <p className="text-xs text-slate-600">Loading synchronized records...</p>
        </div>
        <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
      </div>
    </div>
  );
}

function ProtectedRoute({
  children,
  allowedRole,
}: {
  children: ReactNode;
  allowedRole: Exclude<UserRole, null>;
}) {
  const { role, isLoading } = useAuth();

  if (isLoading) {
    return <FullscreenLoader />;
  }

  if (!role) {
    return <Navigate to="/" replace />;
  }

  if (role !== allowedRole) {
    return <Navigate to={role === "school_head" ? "/school-admin" : "/monitor"} replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { role, isLoading } = useAuth();

  if (isLoading) {
    return <FullscreenLoader />;
  }

  return (
    <Routes>
      <Route
        path="/"
        element={role ? <Navigate to={role === "school_head" ? "/school-admin" : "/monitor"} replace /> : <Login />}
      />
      <Route path="/forgot-password" element={<LazyRoute><ForgotPassword /></LazyRoute>} />
      <Route path="/reset-password" element={<LazyRoute><ResetPassword /></LazyRoute>} />
      <Route path="/mfa-reset" element={<LazyRoute><MfaResetRequest /></LazyRoute>} />
      <Route path="/mfa-reset/complete" element={<LazyRoute><MfaResetComplete /></LazyRoute>} />
      <Route path="/setup-account" element={<LazyRoute><SetupAccount /></LazyRoute>} />
      <Route
        path="/school-admin"
        element={
          <ProtectedRoute allowedRole="school_head">
            <AuthenticatedAppProviders>
              <DashboardDataProviders>
                <LazyRoute>
                  <SchoolAdminDashboard />
                </LazyRoute>
              </DashboardDataProviders>
            </AuthenticatedAppProviders>
          </ProtectedRoute>
        }
      />
      <Route path="/admin" element={<Navigate to="/school-admin" replace />} />
      <Route
        path="/monitor"
        element={
          <ProtectedRoute allowedRole="monitor">
            <AuthenticatedAppProviders>
              <DashboardDataProviders>
                <LazyRoute>
                  <MonitorDashboard />
                </LazyRoute>
              </DashboardDataProviders>
            </AuthenticatedAppProviders>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<FullscreenLoader />}>{children}</Suspense>;
}

function RealtimeBridge() {
  const { role, user, apiToken } = useAuth();
  const hasSession = Boolean(user && role && apiToken);
  const schoolId = user?.schoolId ?? null;

  useEffect(() => {
    if (!hasSession || !role) {
      stopRealtimeBridge();
      return;
    }

    startRealtimeBridge(apiToken, {
      role,
      schoolId,
    });

    return () => {
      stopRealtimeBridge();
    };
  }, [apiToken, hasSession, role, schoolId]);

  return null;
}

function AuthenticatedAppProviders({ children }: { children: ReactNode }) {
  return (
    <>
      <RealtimeBridge />
      <NotificationProvider>{children}</NotificationProvider>
    </>
  );
}

function DashboardDataProviders({ children }: { children: ReactNode }) {
  return (
    <DataProvider>
      <IndicatorDataProvider>
        <TeacherDataProvider>
          <StudentDataProvider>{children}</StudentDataProvider>
        </TeacherDataProvider>
      </IndicatorDataProvider>
    </DataProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppRoutes />
      </HashRouter>
    </AuthProvider>
  );
}
