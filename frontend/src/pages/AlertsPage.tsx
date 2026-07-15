import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { EmptyState } from "../components/common/EmptyState";
import { Loading } from "../components/common/Loading";
import { deleteAlert, listAlerts, markAlertRead, markAllAlertsRead } from "../services/planning.service";
import type { Alert } from "../types/models";
import { formatDate } from "../utils/format";

const SEVERITY_ICONS: Record<Alert["severity"], string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  const load = useCallback(() => {
    listAlerts().then(setAlerts).catch(() => setAlerts([]));
  }, []);

  useEffect(load, [load]);

  async function readAll() {
    await markAllAlertsRead();
    load();
  }

  async function read(alert: Alert) {
    await markAlertRead(alert.id);
    load();
  }

  async function remove(alert: Alert) {
    await deleteAlert(alert.id);
    load();
  }

  if (!alerts) return <Loading />;

  const unread = alerts.filter((a) => !a.isRead).length;

  return (
    <>
      <div className="page-toolbar">
        {unread > 0 && <Button variant="outline" onClick={readAll}>סימון הכל כנקרא ✓</Button>}
        <div className="toolbar-total">
          {unread > 0 ? <strong>{unread} התראות שלא נקראו</strong> : <span className="text-muted">אין התראות חדשות</span>}
        </div>
      </div>

      {alerts.length === 0 ? (
        <Card>
          <EmptyState icon="🚨" title="אין התראות" hint="התראות על חריגות תקציב, חיובים גבוהים והלוואות יקרות יופיעו כאן" />
        </Card>
      ) : (
        <div className="alerts-list">
          {alerts.map((alert) => (
            <Card key={alert.id} className={`alert-card severity-${alert.severity} ${alert.isRead ? "alert-read" : ""}`}>
              <div className="alert-row">
                <span className="alert-icon">{SEVERITY_ICONS[alert.severity]}</span>
                <div className="alert-body">
                  <div className="alert-title">{alert.title}</div>
                  <div className="alert-message text-muted">{alert.message}</div>
                  <div className="alert-date text-muted">{formatDate(alert.createdAt)}</div>
                </div>
                <span className="row-actions">
                  {!alert.isRead && <Button size="sm" variant="ghost" onClick={() => read(alert)} title="סימון כנקרא">✓</Button>}
                  <Button size="sm" variant="ghost" onClick={() => remove(alert)} title="מחיקה">🗑️</Button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
