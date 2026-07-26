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

  it.each(FM_QAD_TEMPLATE_OPTIONS)(
    "downloads $code using its configured filename",
    (selectedTemplate) => {
      const submitHandler = vi.fn();
      const locationBeforeDownload = window.location.href;

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

      const select = screen.getByLabelText("FM-QAD template") as HTMLSelectElement;
      const downloadButton = screen.getByRole("button", {
        name: "Download",
      }) as HTMLButtonElement;
      const anchorClick = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => undefined);
      const appendChild = vi.spyOn(document.body, "appendChild");

      fireEvent.change(select, {
        target: { value: selectedTemplate.id },
      });

      expect(select.value).toBe(selectedTemplate.id);
      expect(downloadButton.disabled).toBe(false);

      fireEvent.click(downloadButton);

      const appendedAnchor = appendChild.mock.calls
        .map(([node]) => node)
        .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);

      expect(anchorClick).toHaveBeenCalledOnce();
      expect(appendedAnchor?.getAttribute("href")).toBe(
        `/templates/fm-qad/${encodeURIComponent(selectedTemplate.filename)}`,
      );
      expect(appendedAnchor?.download).toBe(selectedTemplate.filename);
      expect(appendedAnchor?.isConnected).toBe(false);
      expect(window.location.href).toBe(locationBeforeDownload);
      expect(submitHandler).not.toHaveBeenCalled();
    },
  );
});
