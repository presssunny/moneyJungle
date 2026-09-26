import { PageShell } from "../components/common/PageShell";
import { useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../hooks/useConfirm";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { MetricExplanation } from "../components/common/MetricExplanation";
import { Modal } from "../components/common/Modal";
import { Select } from "../components/common/Select";
import { SkeletonCard, SkeletonRows } from "../components/common/Skeleton";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import { createAsset, deleteAsset, listAssets, updateAsset, type AssetInput } from "../services/planning.service";
import { sharedGet } from "../services/queryCache";
import type { Asset, AssetType } from "../types/models";
import type { FinancialMetric } from "../types/metric.types";
import { formatCurrency, formatDate } from "../utils/format";

const ASSET_TYPES: Array<{ value: AssetType; label: string }> = [
  { value: "investment", label: "תיק השקעות" },
  { value: "pension", label: "פנסיה / קרן השתלמות" },
  { value: "real_estate", label: "נדל״ן" },
  { value: "other", label: "אחר" },
];
const ASSET_TYPE_LABELS: Record<AssetType, string> = Object.fromEntries(ASSET_TYPES.map((t) => [t.value, t.label])) as Record<AssetType, string>;

const emptyForm: AssetInput = { name: "", assetType: "investment", currentValue: 0, asOfDate: new Date().toISOString().slice(0, 10) };

/**
 * טאב "נכסים ושווי נטו" (Net Worth milestone). נכס הוא ערך שנרשם ידנית מחוץ
 * לחשבון מנוהל — לא יתרת בנק ולא יעד חיסכון, שהכסף בהם עשוי כבר להיספר
 * במקום אחר (ראה MetricExplanation בטאב הבנק/הלוואות).
 */
export default function AssetsPage() {
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [form, setForm] = useState<AssetInput>(emptyForm);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const assetsRes = useAsync(() => listAssets(), [reloadKey], "לא הצלחנו לטעון את הנכסים");
  const netWorthRes = useAsync(() => sharedGet<FinancialMetric>("/journey/metrics/netWorth", { month: new Date().toISOString().slice(0, 7) }), [reloadKey], "לא הצלחנו לחשב שווי נטו");
  const load = () => setReloadKey((k) => k + 1);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setFormOpen(true);
  }

  function openEdit(asset: Asset) {
    setEditing(asset);
    setForm({ name: asset.name, assetType: asset.assetType, currentValue: Number(asset.currentValue), asOfDate: asset.asOfDate.slice(0, 10) });
    setError("");
    setFormOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (editing) await updateAsset(editing.id, form);
      else await createAsset(form);
      setFormOpen(false);
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  function remove(asset: Asset) {
    confirm.ask(
      {
        title: "מחיקת נכס",
        message: (
          <>
            הנכס <strong>{asset.name}</strong> יימחק ולא ייספר עוד בשווי הנטו.
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        await deleteAsset(asset.id);
        load();
      }
    );
  }

  return (
    <PageShell toolbar={<PageToolbar onAdd={openCreate} />}>
      <div className="kpi-row">
        <AsyncSection resource={netWorthRes} errorTitle="לא הצלחנו לחשב שווי נטו" skeleton={<SkeletonCard />}>
          {(netWorth) =>
            netWorth.state === "unavailable" ? (
              <SummaryCard label="שווי נטו" value="—" certainty="unknown" sub={netWorth.missingData[0] ?? "חסר מידע לחישוב"} />
            ) : (
              <SummaryCard
                label="שווי נטו"
                size="hero"
                value={formatCurrency(netWorth.value!)}
                tone={netWorth.value! >= 0 ? "success" : "danger"}
                certainty="scenario"
                sub="נכסים בניכוי הלוואות פעילות וחוב אשראי שטרם שולם — ערך מוצהר, לא מאומת"
              />
            )
          }
        </AsyncSection>
      </div>
      {netWorthRes.data && (
        <MetricExplanation title="איך חושב השווי הנטו?">
          <p>{netWorthRes.data.formula}</p>
          <ul>
            {netWorthRes.data.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
            {netWorthRes.data.missingData.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </MetricExplanation>
      )}


      <AsyncSection
        resource={assetsRes}
        errorTitle="לא הצלחנו לטעון את הנכסים"
        skeleton={<SkeletonRows rows={3} />}
        isEmpty={(data) => data.length === 0}
        emptyState={
          <Card>
            <EmptyState
              icon="💎"
              title="אין עדיין נכסים רשומים"
              hint="הוסיפי נכס — תיק השקעות, פנסיה או נדל״ן — כדי לראות שווי נטו"
              action={
                <Button size="sm" onClick={openCreate}>
                  + נכס
                </Button>
              }
            />
          </Card>
        }
      >
        {(assetList) => (
          <div className="budget-grid">
            {assetList.map((asset) => (
              <Card key={asset.id} className="budget-card">
                <div className="budget-card-head">
                  <span className="budget-card-name">💎 {asset.name}</span>
                  <span className="row-actions">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(asset)} aria-label="עריכה">✏️</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(asset)} aria-label="מחיקה">🗑️</Button>
                  </span>
                </div>
                <div className="budget-card-meta">
                  <span className="mono text-success">{formatCurrency(Number(asset.currentValue))}</span>
                </div>
                <div className="budget-card-remaining">
                  <span className="text-muted">{ASSET_TYPE_LABELS[asset.assetType]} · נכון ל-{formatDate(asset.asOfDate)}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </AsyncSection>

      <Modal title={editing ? "עריכת נכס" : "נכס חדש"} open={formOpen} onClose={() => setFormOpen(false)}>
        <form onSubmit={submit}>
          {error && <ErrorMessage message={error} />}
          <div className="form-row">
            <Input label="שם הנכס" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Select label="סוג" options={ASSET_TYPES} value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value as AssetType })} />
          </div>
          <div className="form-row">
            <Input
              label="שווי נוכחי (₪)"
              type="number"
              step="0.01"
              min="0"
              required
              value={form.currentValue || ""}
              onChange={(e) => setForm({ ...form, currentValue: Number(e.target.value) })}
            />
            <Input label="נכון לתאריך" type="date" required value={form.asOfDate} onChange={(e) => setForm({ ...form, asOfDate: e.target.value })} />
          </div>
          <div className="modal-actions">
            <Button type="submit">{editing ? "עדכון" : "הוספה"}</Button>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>ביטול</Button>
          </div>
        </form>
      </Modal>

      {confirm.dialog}
    </PageShell>
  );
}

function PageToolbar({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="row-actions" style={{ marginBottom: "1rem" }}>
      <Button onClick={onAdd}>+ נכס</Button>
    </div>
  );
}
