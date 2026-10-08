"use client";

import { useEffect } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testId: string;
}

/**
 * Shared modal shell for Codex sub-editors: overlay, Escape-to-close, and a
 * consistent header. Form content is provided by the caller.
 */
export function Modal({ title, onClose, children, testId }: ModalProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      data-testid={testId}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink-200 bg-ink-50 p-6 text-ink-900 shadow-xl">
        <div className="mb-4 flex items-center justify-between border-b border-ink-200 pb-3">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-sm text-ink-400 hover:text-ink-700"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const modalInputClasses =
  "mt-1 w-full rounded-md border border-ink-200 bg-ink-100 p-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-ink-400 focus:outline-hidden";

export const modalLabelClasses =
  "block text-xs font-semibold uppercase tracking-wider text-ink-600";
