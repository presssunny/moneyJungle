import { Icon } from "./Icon";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
  children: ReactNode;
}

export function Button({ variant = "primary", size = "md", className = "", children, ...rest }: ButtonProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} {...rest}>
      {typeof children === "string" && ["✏️", "🗑️"].includes(children.trim()) ? <Icon name={children.trim()} size={18}/> : children}
    </button>
  );
}
