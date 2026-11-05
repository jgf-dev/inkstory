"use client";

import type { ChangeEventHandler, ReactNode } from "react";
import { a11yClasses } from "@/lib/ui/a11y-classes";

type AuthTextFieldProps = {
  id: string;
  label: string;
  type: "email" | "password" | "text";
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  required?: boolean;
  minLength?: number;
  children?: ReactNode;
};

/** Shared labeled auth input with WCAG AA focus border (JGF-115). */
export function AuthTextField({
  id,
  label,
  type,
  value,
  onChange,
  required,
  minLength,
  children,
}: AuthTextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        minLength={minLength}
        value={value}
        onChange={onChange}
        className={a11yClasses.authField}
      />
      {children}
    </div>
  );
}
