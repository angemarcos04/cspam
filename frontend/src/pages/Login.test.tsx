import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, SERVICE_UNAVAILABLE_MESSAGE } from "@/lib/api";
import { Login } from "@/pages/Login";

const authState = {
  login: vi.fn(),
  verifyMfa: vi.fn(),
  resetRequiredPassword: vi.fn(),
  isAuthenticating: false,
  authError: "",
  authErrorCode: null,
  accountStatus: null,
  clearAuthError: vi.fn(),
};

vi.mock("@/context/Auth", () => ({
  useAuth: () => authState,
}));

describe("Login", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    authState.login.mockReset();
    authState.verifyMfa.mockReset();
    authState.resetRequiredPassword.mockReset();
    authState.clearAuthError.mockReset();
    authState.isAuthenticating = false;
    authState.authError = "";
    authState.authErrorCode = null;
    authState.accountStatus = null;
  });

  it("shows school head by default and updates labels when switching roles", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Login ID").getAttribute("placeholder")).toBeNull();
    expect(screen.getByLabelText("Password").getAttribute("placeholder")).toBeNull();
    expect(screen.queryByPlaceholderText("Enter school code or monitor email")).toBeNull();
    expect(screen.getByText("Enter Password")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);

    expect(screen.getByLabelText("Login ID").getAttribute("placeholder")).toBeNull();
    expect(screen.getByLabelText("Password").getAttribute("placeholder")).toBeNull();
    expect(screen.queryByPlaceholderText("Enter school code or monitor email")).toBeNull();
    expect(screen.getByText("Enter Password")).toBeTruthy();
  });

  it("clears stale School Head credentials and hides password when switching to Division Monitor", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "001234" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "SchoolHead@123" } });
    fireEvent.click(screen.getAllByRole("button", { name: /show password/i })[0]!);
    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("text");

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);

    expect((screen.getByLabelText("Login ID") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe("password");
  });

  it("clears stale Division Monitor credentials when switching to School Head", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "monitor@cspams.local" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Monitor@123" } });

    fireEvent.click(screen.getAllByRole("button", { name: /school head/i })[0]!);

    expect((screen.getByLabelText("Login ID") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("keeps School Head recovery contact-monitor only with no reset link", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: /forgot password/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /reset/i })).toBeNull();
  });

  it("toggles password visibility and shows forgot-password only for monitor sign-in", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    const passwordInput = screen.getByLabelText("Password");
    expect(passwordInput.getAttribute("type")).toBe("password");

    fireEvent.click(screen.getAllByRole("button", { name: /show password/i })[0]!);
    expect(passwordInput.getAttribute("type")).toBe("text");

    expect(screen.queryByRole("link", { name: /forgot password/i })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);
    expect(screen.getByRole("link", { name: /forgot password/i }).getAttribute("href")).toBe("/forgot-password?role=monitor");

    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "monitor+reset@cspams.local" } });
    expect(screen.getByRole("link", { name: /forgot password/i }).getAttribute("href")).toBe(
      "/forgot-password?role=monitor&email=monitor%2Breset%40cspams.local",
    );

    fireEvent.click(screen.getAllByRole("button", { name: /school head/i })[0]!);
    expect(screen.queryByRole("link", { name: /forgot password/i })).toBeNull();
  });

  it("renders validation errors with warning styling", async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    const errorMessage = await screen.findByText("Enter your 6-digit school code.");
    expect(errorMessage.className).toContain("border-amber-200");
    expect(errorMessage.className).toContain("bg-amber-50");
    expect(errorMessage.className).toContain("text-amber-800");
  });

  it("hides monitor forgot-password while MFA is pending", async () => {
    authState.login.mockResolvedValueOnce({
      status: "mfa_required",
      challengeId: "11111111-1111-4111-8111-111111111111",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      login: "cspamsmonitor@gmail.com",
      delivery: "sent",
      deliveryMessage: "A verification code was sent to your email.",
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "cspamsmonitor@gmail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Demo@123456" } });
    expect(screen.getByRole("link", { name: /forgot password/i })).toBeTruthy();

    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    expect(await screen.findByLabelText("Verification Code")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /forgot password/i })).toBeNull();
  });

  it("submits a leading-zero school code as a six-digit string", async () => {
    authState.login.mockResolvedValueOnce({ status: "authenticated" });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /school head/i })[0]!);
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "001234" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    await waitFor(() => {
      expect(authState.login).toHaveBeenCalledWith({
        role: "school_head",
        login: "001234",
        password: "Demo@123456",
      });
    });
  });

  it("shows a deployment-oriented message when the API cannot be reached during login", async () => {
    authState.login.mockRejectedValueOnce(new ApiError("NetworkError when attempting to fetch resource.", 0, null));

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "cspamsmonitor@gmail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    expect(
      await screen.findByText(/Unable to reach the CSPAMS API at .* Check the deployed API URL and network access\./i),
    ).toBeTruthy();
  });

  it("maps bare service-unavailable login failures to safe copy", async () => {
    authState.login.mockRejectedValueOnce(new ApiError("Request failed with status 503.", 503, null));

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "cspamsmonitor@gmail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    expect(await screen.findByText(SERVICE_UNAVAILABLE_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("Request failed with status 503.")).toBeNull();
  });

  it("shows a monitor MFA delivery message when credentials are accepted but email delivery fails", async () => {
    authState.login.mockRejectedValueOnce(new ApiError(
      "Unable to send verification code. Please try again or contact your administrator.",
      503,
      {
        message: "Unable to send verification code. Please try again or contact your administrator.",
        errorCode: "mfa_delivery_failed",
      },
    ));

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "cspamsmonitor@gmail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    expect(
      await screen.findByText("Unable to send verification code. Please try again or contact your administrator."),
    ).toBeTruthy();
    expect(screen.queryByText(SERVICE_UNAVAILABLE_MESSAGE)).toBeNull();
  });

  it("keeps six-digit email MFA codes numeric and submits them unchanged", async () => {
    authState.login.mockResolvedValueOnce({
      status: "mfa_required",
      challengeId: "11111111-1111-4111-8111-111111111111",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      login: "cspamsmonitor@gmail.com",
      delivery: "sent",
      deliveryMessage: "A verification code was sent to your email.",
    });
    authState.verifyMfa.mockResolvedValueOnce(undefined);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "cspamsmonitor@gmail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    const codeInput = await screen.findByLabelText("Verification Code");
    fireEvent.change(codeInput, { target: { value: "123456" } });

    expect((codeInput as HTMLInputElement).value).toBe("123456");

    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    await waitFor(() => {
      expect(authState.verifyMfa).toHaveBeenCalledWith({
        role: "monitor",
        login: "cspamsmonitor@gmail.com",
        challengeId: "11111111-1111-4111-8111-111111111111",
        code: "123456",
      });
    });
  });

  it("resends monitor MFA codes with the existing login API and replaces the challenge", async () => {
    authState.login
      .mockResolvedValueOnce({
        status: "mfa_required",
        challengeId: "11111111-1111-4111-8111-111111111111",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        login: "cspamsmonitor@gmail.com",
        delivery: "sent",
        deliveryMessage: "A verification code was sent to your email.",
      })
      .mockResolvedValueOnce({
        status: "mfa_required",
        challengeId: "33333333-3333-4333-8333-333333333333",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        login: "cspamsmonitor@gmail.com",
        delivery: "sent",
        deliveryMessage: "A new verification code was sent to your email.",
      });
    authState.verifyMfa.mockResolvedValueOnce(undefined);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "cspamsmonitor@gmail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    const codeInput = await screen.findByLabelText("Verification Code");
    fireEvent.change(codeInput, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Resend code" }));

    await waitFor(() => {
      expect(authState.login).toHaveBeenCalledTimes(2);
    });
    expect(authState.login).toHaveBeenLastCalledWith({
      role: "monitor",
      login: "cspamsmonitor@gmail.com",
      password: "Demo@123456",
    });
    expect((codeInput as HTMLInputElement).value).toBe("");
    expect(await screen.findByText("New verification code sent.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Resend code in 60s" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(/Can't complete MFA/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /request recovery/i })).toBeNull();

    fireEvent.change(codeInput, { target: { value: "654321" } });
    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    await waitFor(() => {
      expect(authState.verifyMfa).toHaveBeenCalledWith({
        role: "monitor",
        login: "cspamsmonitor@gmail.com",
        challengeId: "33333333-3333-4333-8333-333333333333",
        code: "654321",
      });
    });
  });

  it("formats alphanumeric MFA backup codes as XXXX-XXXX", async () => {
    authState.login.mockResolvedValueOnce({
      status: "mfa_required",
      challengeId: "22222222-2222-4222-8222-222222222222",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      login: "cspamsmonitor@gmail.com",
      delivery: "sent",
      deliveryMessage: "A verification code was sent to your email.",
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "cspamsmonitor@gmail.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    const codeInput = await screen.findByLabelText("Verification Code");
    fireEvent.change(codeInput, { target: { value: "abcd1234" } });

    expect((codeInput as HTMLInputElement).value).toBe("ABCD-1234");
  });
});
