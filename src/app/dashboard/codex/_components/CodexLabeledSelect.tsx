"use client";

import type { ChangeEventHandler } from "react";

type CodexLabeledSelectProps = {
  id: string;
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  options: readonly string[];
  className: string;
  labelClassName: string;
};

/** Shared labeled select used by create modal and editor forms. */
export function CodexLabeledSelect({
  id,
  label,
  value,
  onChange,
  options,
  className,
  labelClassName,
}: CodexLabeledSelectProps) {
  return (
    <div>
      <label className={labelClassName} htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={onChange} className={className}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
