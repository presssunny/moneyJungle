import { useEffect, useState, type ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "right" | "left" | "center";
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  emptyState?: ReactNode;
  /** Rows per page. 0 or negative disables pagination. Default 15. */
  pageSize?: number;
}

export function Table<T>({ columns, rows, rowKey, emptyState, pageSize = 15 }: TableProps<T>) {
  const paginate = pageSize > 0 && rows.length > pageSize;
  const totalPages = paginate ? Math.ceil(rows.length / pageSize) : 1;
  const [page, setPage] = useState(0);

  // Keep the page in range when the row set changes (e.g. after filtering)
  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  if (rows.length === 0 && emptyState) return <>{emptyState}</>;

  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = paginate ? rows.slice(safePage * pageSize, safePage * pageSize + pageSize) : rows;
  const firstRow = safePage * pageSize + 1;
  const lastRow = Math.min(rows.length, firstRow + pageSize - 1);

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ textAlign: col.align ?? "right" }}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((col) => (
                  // `data-label` carries the column header down to narrow
                  // screens, where CSS turns each row into a card and shows the
                  // header beside its value (IA §8.2 — no horizontal scrolling
                  // on mobile). One attribute here fixes every table in the app.
                  <td key={col.key} data-label={col.header} style={{ textAlign: col.align ?? "right" }}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {paginate && (
        <div className="pagination">
          <button
            className="pagination-btn"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            aria-label="עמוד קודם"
          >
            › הקודם
          </button>
          <span className="pagination-info">
            {firstRow}–{lastRow} מתוך {rows.length} · עמוד {safePage + 1} מתוך {totalPages}
          </span>
          <button
            className="pagination-btn"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            aria-label="עמוד הבא"
          >
            הבא ‹
          </button>
        </div>
      )}
    </>
  );
}
