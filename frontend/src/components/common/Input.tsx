import { useId } from "react";
import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = "", id, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input aria-invalid={error ? true : undefined} aria-describedby={error ? `${inputId}-error` : undefined} id={inputId} className={`field-input ${error ? "field-invalid" : ""} ${className}`} {...rest} />
      {error && <div id={`${inputId}-error`} className="field-error">{error}</div>}
    </div>
  );
}
