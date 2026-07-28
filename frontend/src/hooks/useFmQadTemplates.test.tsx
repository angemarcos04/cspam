import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFmQadTemplates } from "@/hooks/useFmQadTemplates";
import { fetchEffectiveFmQadTemplates } from "@/lib/fmQadTemplatesApi";
import type { FmQadTemplateForm } from "@/types/fmQadTemplates";

vi.mock("@/lib/fmQadTemplatesApi", () => ({
  fetchEffectiveFmQadTemplates: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function form(id: string): FmQadTemplateForm {
  return { id, scopeId: `fm_qad_${id}`, code: `FM-QAD-${id}`, name: id, activeVersion: null };
}

describe("useFmQadTemplates", () => {
  beforeEach(() => vi.mocked(fetchEffectiveFmQadTemplates).mockReset());

  it("prevents an older Academic Year response from replacing newer data", async () => {
    const oldRequest = deferred<FmQadTemplateForm[]>();
    const newRequest = deferred<FmQadTemplateForm[]>();
    vi.mocked(fetchEffectiveFmQadTemplates)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);

    const { result, rerender } = renderHook(
      ({ year }) => useFmQadTemplates({ token: "token", academicYearId: year, enabled: true }),
      { initialProps: { year: "old-year" } },
    );
    rerender({ year: "new-year" });
    await act(async () => newRequest.resolve([form("new")]));
    await waitFor(() => expect(result.current.templates[0]?.id).toBe("new"));
    await act(async () => oldRequest.resolve([form("old")]));
    expect(result.current.templates[0]?.id).toBe("new");
  });

  it("refreshes when the existing CSPAMS realtime event announces a template change", async () => {
    vi.mocked(fetchEffectiveFmQadTemplates)
      .mockResolvedValue([form("two")])
      .mockResolvedValueOnce([form("one")]);
    const { result } = renderHook(() => useFmQadTemplates({
      token: "token",
      academicYearId: "year-1",
      enabled: true,
    }));
    await waitFor(() => expect(result.current.templates[0]?.id).toBe("one"));
    act(() => window.dispatchEvent(new CustomEvent("cspams:update", {
      detail: { entity: "fm_qad_template" },
    })));
    await waitFor(() => expect(result.current.templates[0]?.id).toBe("two"));
  });
});
