"use client";

import { useEffect, useRef, useState } from "react";

export const COPIED_FEEDBACK_MS = 1500;

export interface CopyFeedback {
  copied: string | null;
  error: string | null;
  copy: (key: string, text: string) => Promise<void>;
}

/** Clipboard copy with a short-lived "copied" key and an error message. */
export function useCopyFeedback(): CopyFeedback {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      setCopied(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        setCopied(null);
      }, COPIED_FEEDBACK_MS);
    } catch {
      setCopied(null);
      setError("Copy failed. Select the text and copy it manually.");
    }
  }

  return { copied, error, copy };
}
