import { useState, type ReactNode } from "react";
import { Pager } from "./Pager";

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  priority?: "primary" | "amount" | "secondary";
  align?: "right" | "left" | "center";
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  emptyState?: ReactNode;
  /** Rows per page. 0 or negative disables pagination. Default 15. */
  pageSize?: number;
  variant?: "default" | "ledger";
}

export function Table<T>({ columns, rows, rowKey, emptyState, pageSize = 15, variant = "default" }: TableProps<T>) {
  const paginate = pageSize > 0 && rows.length > pageSize;
  const totalPages = paginate ? Math.ceil(rows.length / pageSize) : 1;
  const [page, setPage] = useState(0);

  if (rows.length === 0 && emptyState) return <>{emptyState}</>;

  // A shrunken row set (e.g. after filtering) clamps the page here, in render.
  const safePage = Math.min(page, totalPages - 1);
  const visibleRows = paginate ? rows.slice(safePage * pageSize, safePage * pageSize + pageSize) : rows;

  return (
    <>
      <div className="table-wrap">
        <table className={`table table-${variant}`} role="table">
          <thead role="rowgroup">
            <tr role="row">
              {columns.map((col) => (
                <th role="columnheader" scope="col" key={col.key} style={{ textAlign: col.align ?? "right" }}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {visibleRows.map((row) => (
              <tr role="row" key={rowKey(row)}>
                {columns.map((col) => (
                  // `data-label` carries the column header down to narrow
                  // screens, where CSS turns each row into a card and shows the
                  // header beside its value (IA §8.2 — no horizontal scrolling
                  // on mobile). One attribute here fixes every table in the app.
                  <td role="cell" key={col.key} data-column={col.key} data-priority={col.priority} data-label={col.header} style={{ textAlign: col.align ?? "right" }}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {paginate && <Pager page={safePage + 1} pageSize={pageSize} total={rows.length} onChange={(next) => setPage(next - 1)} />}
    </>
  );
}
