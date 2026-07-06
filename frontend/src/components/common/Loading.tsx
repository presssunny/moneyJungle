export function Loading({ label = "טוען..." }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading-spinner" />
      {label}
    </div>
  );
}
