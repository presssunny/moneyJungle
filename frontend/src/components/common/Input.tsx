import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = "", id, ...rest }: InputProps) {
  const inputId = id ?? (label ? `input-${label}` : undefined);
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input id={inputId} className={`field-input ${error ? "field-invalid" : ""} ${className}`} {...rest} />
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
