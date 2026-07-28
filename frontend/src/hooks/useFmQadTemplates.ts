import { useCallback, useEffect, useRef, useState } from "react";
import { fetchEffectiveFmQadTemplates } from "@/lib/fmQadTemplatesApi";
import type { FmQadTemplateForm } from "@/types/fmQadTemplates";

export function useFmQadTemplates(options: {
  token: string;
  academicYearId: string;
  enabled: boolean;
}) {
  const [templates, setTemplates] = useState<FmQadTemplateForm[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!options.enabled || !options.token || !options.academicYearId) {
      setTemplates([]);
      setIsLoading(false);
      return;
    }
    const sequence = ++requestSequence.current;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    setIsLoading(true);
    setError("");
    try {
      const result = await fetchEffectiveFmQadTemplates(options.token, options.academicYearId, controller.signal);
      if (sequence === requestSequence.current) setTemplates(result);
    } catch (cause) {
      if (sequence === requestSequence.current && !(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "Template service is temporarily unavailable. Please try again.");
      }
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  }, [options.academicYearId, options.enabled, options.token]);

  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current++;
      activeController.current?.abort();
    };
  }, [refresh]);

  useEffect(() => {
    if (!options.enabled || typeof window === "undefined") return;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ entity?: string }>).detail;
      if (detail?.entity === "fm_qad_template") void refresh();
    };
    window.addEventListener("cspams:update", listener);
    return () => window.removeEventListener("cspams:update", listener);
  }, [options.enabled, refresh]);

  return { templates, isLoading, error, refresh };
}
