import { useState } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { PageShell } from "../components/common/PageShell";
import { SkeletonChart } from "../components/common/Skeleton";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import { listActivity } from "../services/activity.service";
import type { ActivityEvent } from "../types/models";

const timeFormat = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" });

export default function ActivityPage() {
  const first = useAsync(() => listActivity(), [], "לא הצלחנו לטעון את יומן הפעילות", ["activity", "financial"]);
  const [more, setMore] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<number | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const nextCursor = cursor === undefined ? first.data?.nextCursor ?? null : cursor;

  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true); setError("");
    try {
      const page = await listActivity(nextCursor);
      setMore((rows) => [...rows, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) { setError(apiErrorMessage(e)); }
    finally { setLoadingMore(false); }
  }

  return (
    <PageShell>
      <Card title="מה השתנה ומתי">
        <p className="text-muted">כל שינוי שנשמר בחשבון — הוספה, עריכה, מחיקה, קליטת קובץ או החלטה. היומן מתעד בלבד ואינו משפיע על אף סכום.</p>
        <AsyncSection
          resource={first}
          errorTitle="לא הצלחנו לטעון את יומן הפעילות"
          skeleton={<SkeletonChart height={240} label="טוען את יומן הפעילות" />}
          isEmpty={(page) => page.items.length === 0}
          emptyState={<EmptyState icon="🕘" title="עדיין אין פעילות" hint="שינויים שתעשי מעכשיו יופיעו כאן" />}
        >
          {(page) => (
            <>
              <ol className="activity-list" aria-label="יומן פעילות">
                {[...page.items, ...more].map((event) => (
                  <li key={event.id} className="activity-item">
                    <time dateTime={event.createdAt} className="text-muted mono">{timeFormat.format(new Date(event.createdAt))}</time>
                    <span>{event.summary}</span>
                  </li>
                ))}
              </ol>
              {error && <div className="field-error" role="alert">{error}</div>}
              {nextCursor !== null && (
                <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? "טוען..." : "פעילות קודמת"}
                </Button>
              )}
            </>
          )}
        </AsyncSection>
      </Card>
    </PageShell>
  );
}
