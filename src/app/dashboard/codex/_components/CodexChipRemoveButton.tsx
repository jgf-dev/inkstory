"use client";

import { a11yClasses } from "@/lib/ui/a11y-classes";

type CodexChipRemoveButtonProps = {
  label: string;
  onClick: () => void;
};

/** 36px touch-target remove control for alias/tag chips (JGF-115). */
export function CodexChipRemoveButton({ label, onClick }: CodexChipRemoveButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={a11yClasses.iconRemoveButton}
    >
      ×
    </button>
  );
}
