import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
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

    expect(screen.getByLabelText("Login ID")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter school code or monitor email")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);

    expect(screen.getByLabelText("Login ID")).toBeTruthy();
    expect(screen.getByPlaceholderText("Enter school code or monitor email")).toBeTruthy();
  });

  it("toggles passcode visibility and preserves forgot-password routing by role", () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    const passcodeInput = screen.getByLabelText("Passcode");
    expect(passcodeInput.getAttribute("type")).toBe("password");

    fireEvent.click(screen.getAllByRole("button", { name: /show passcode/i })[0]!);
    expect(passcodeInput.getAttribute("type")).toBe("text");

    const initialForgotLinks = screen.getAllByRole("link", { name: /forgot password/i });
    expect(initialForgotLinks.some((link) => link.getAttribute("href") === "/forgot-password?role=school_head")).toBe(true);

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);
    const switchedForgotLinks = screen.getAllByRole("link", { name: /forgot password/i });
    expect(switchedForgotLinks.some((link) => link.getAttribute("href") === "/forgot-password?role=monitor")).toBe(true);
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
    fireEvent.change(screen.getByLabelText("Passcode"), { target: { value: "Demo@123456" } });
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
    fireEvent.change(screen.getByLabelText("Passcode"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    expect(
      await screen.findByText(/Unable to reach the CSPAMS API at .* Check the deployed API URL and network access\./i),
    ).toBeTruthy();
  });

  it("shows a monitor MFA delivery message when credentials are accepted but email delivery fails", async () => {
    authState.login.mockRejectedValueOnce(new ApiError(
      "Unable to send verification code. Please try again or contact your administrator.",
      503,
      { errorCode: "mfa_delivery_failed" },
    ));

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /division monitor/i })[0]!);
    fireEvent.change(screen.getByLabelText("Login ID"), { target: { value: "cspamsmonitor@gmail.com" } });
    fireEvent.change(screen.getByLabelText("Passcode"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    expect(
      await screen.findByText("Your monitor credentials were accepted, but the verification code email could not be delivered. Check mail configuration or try again."),
    ).toBeTruthy();
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
    fireEvent.change(screen.getByLabelText("Passcode"), { target: { value: "Demo@123456" } });
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
    fireEvent.change(screen.getByLabelText("Passcode"), { target: { value: "Demo@123456" } });
    fireEvent.submit(screen.getAllByRole("button", { name: /sign in/i })[0]!.closest("form")!);

    const codeInput = await screen.findByLabelText("Verification Code");
    fireEvent.change(codeInput, { target: { value: "abcd1234" } });

    expect((codeInput as HTMLInputElement).value).toBe("ABCD-1234");
  });
});
