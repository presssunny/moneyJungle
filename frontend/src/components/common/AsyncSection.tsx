import type { ReactNode } from "react";
import type { AsyncResource } from "../../hooks/useAsync";
import { WidgetError } from "./WidgetError";

interface AsyncSectionProps<T> {
  resource: AsyncResource<T>;
  /** Hebrew headline for the failure state, e.g. "לא הצלחנו לטעון את המגמה". */
  errorTitle: string;
  /** Loading placeholder — a skeleton shaped like the real content. */
  skeleton: ReactNode;
  /** True when the data loaded but has nothing to show. */
  isEmpty?: (data: T) => boolean;
  /** What to render for a genuinely empty data set (≠ "filtered to nothing"). */
  emptyState?: ReactNode;
  children: (data: T) => ReactNode;
}

/**
 * Renders exactly one of the four widget states: loading → error → empty → data.
 *
 * The states are resolved per widget, never per page (IA §1.3): if the charts
 * endpoint fails while the summary endpoint succeeds, the KPI row still renders
 * and only the chart shows an error.
 *
 * When a reload fails but we still hold previously loaded data, the data stays
 * on screen and the error appears as a thin strip above it — losing a working
 * view because a refresh failed would be a regression, not a fix.
 */
export function AsyncSection<T>({
  resource,
  errorTitle,
  skeleton,
  isEmpty,
  emptyState,
  children,
}: AsyncSectionProps<T>) {
  const { data, error, loading, reload } = resource;

  if (error && data === null) {
    return <WidgetError title={errorTitle} detail={error} onRetry={reload} />;
  }
  if (data === null) {
    return loading ? <>{skeleton}</> : <WidgetError title={errorTitle} onRetry={reload} />;
  }

  const body =
    isEmpty?.(data) && emptyState !== undefined ? <>{emptyState}</> : <>{children(data)}</>;

  if (error) {
    return (
      <>
        <WidgetError title={errorTitle} detail={error} onRetry={reload} inline />
        {body}
      </>
    );
  }
  return body;
}
