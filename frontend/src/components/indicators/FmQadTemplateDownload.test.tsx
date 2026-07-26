import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FmQadTemplateDownload } from "@/components/indicators/FmQadTemplateDownload";
import { FM_QAD_TEMPLATE_OPTIONS } from "@/constants/fmQadTemplates";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FmQadTemplateDownload", () => {
  it("starts with the placeholder selected and Download disabled", () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click");

    render(<FmQadTemplateDownload />);

    const downloadButton = screen.getByRole("button", { name: "Download" });

    expect((screen.getByLabelText("FM-QAD template") as HTMLSelectElement).value).toBe("");
    expect(screen.getByRole("option", { name: "Select a template" })).not.toBeNull();
    expect((downloadButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(downloadButton);

    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("enables Download after selecting a valid template", () => {
    render(<FmQadTemplateDownload />);

    fireEvent.change(screen.getByLabelText("FM-QAD template"), {
      target: { value: "fm_qad_003" },
    });

    expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("downloads the selected static file without submitting a surrounding form", () => {
    const submitHandler = vi.fn();
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const appendChild = vi.spyOn(document.body, "appendChild");
    const selectedTemplate = FM_QAD_TEMPLATE_OPTIONS.find(
      (template) => template.id === "fm_qad_003",
    )!;

    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitHandler();
        }}
      >
        <FmQadTemplateDownload />
      </form>,
    );

    fireEvent.change(screen.getByLabelText("FM-QAD template"), {
      target: { value: selectedTemplate.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    const appendedAnchor = appendChild.mock.calls
      .map(([node]) => node)
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);

    expect(anchorClick).toHaveBeenCalledOnce();
    expect(appendedAnchor?.getAttribute("href")).toBe(
      `/templates/fm-qad/${encodeURIComponent(selectedTemplate.filename)}`,
    );
    expect(appendedAnchor?.download).toBe(selectedTemplate.filename);
    expect(appendedAnchor?.isConnected).toBe(false);
    expect(submitHandler).not.toHaveBeenCalled();
  });
});
