/** Previous/next over `total` rows, `pageSize` at a time; `page` is 1-based. Renders nothing for a single page. */
export function Pager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="pagination">
      <button className="pagination-btn" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="עמוד קודם">
        › הקודם
      </button>
      <span className="pagination-info">
        {first}–{last} מתוך {total} · עמוד {page} מתוך {totalPages}
      </span>
      <button className="pagination-btn" onClick={() => onChange(page + 1)} disabled={page >= totalPages} aria-label="עמוד הבא">
        הבא ‹
      </button>
    </div>
  );
}
