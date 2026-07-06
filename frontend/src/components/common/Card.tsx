import type { ReactNode } from "react";

interface CardProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Card({ title, action, children, className = "" }: CardProps) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-header">
          {title && <h3 className="card-title">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
