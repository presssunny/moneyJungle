import { useId } from "react";
import type { SelectHTMLAttributes } from "react";

export interface SelectOption {
  value: string | number;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
  placeholder?: string;
  error?: string;
}

export function Select({ label, options, placeholder, error, className = "", id, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={selectId}>
          {label}
        </label>
      )}
      <select aria-invalid={error ? true : undefined} aria-describedby={error ? `${selectId}-error` : undefined} id={selectId} className={`field-input ${error ? "field-invalid" : ""} ${className}`} {...rest}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <div id={`${selectId}-error`} className="field-error">{error}</div>}
    </div>
  );
}
