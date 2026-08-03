import { useState, type FormEvent } from "react";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../components/common/ConfirmDialog";
import { EmptyState } from "../components/common/EmptyState";
import { ErrorMessage } from "../components/common/ErrorMessage";
import { Input } from "../components/common/Input";
import { Modal } from "../components/common/Modal";
import { PageShell } from "../components/common/PageShell";
import { Select } from "../components/common/Select";
import { SkeletonKpiRow, SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import {
  createCategory,
  createRule,
  deleteCategory,
  deleteRule,
  listCategories,
  listRules,
} from "../services/planning.service";
import type { Category, CategoryRule } from "../types/models";

export default function CategoriesRulesPage() {
  // Categories and rules load independently: a rules failure must not hide the
  // categories the user can still work with (IA §1.3).
  const categoriesRes = useAsync(() => listCategories(), [], "לא הצלחנו לטעון את הקטגוריות");
  const rulesRes = useAsync(() => listRules(), [], "לא הצלחנו לטעון את חוקי הסיווג");
  const confirm = useConfirm();
  const [catOpen, setCatOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [catForm, setCatForm] = useState({ name: "", type: "expense", icon: "🏷️", color: "#5B8DEF" });
  const [ruleForm, setRuleForm] = useState({ keyword: "", categoryId: "" as number | "" });
  const [error, setError] = useState("");

  function load() {
    categoriesRes.reload();
    rulesRes.reload();
  }

  async function submitCategory(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await createCategory(catForm);
      setCatOpen(false);
      setCatForm({ name: "", type: "expense", icon: "🏷️", color: "#5B8DEF" });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  async function submitRule(e: FormEvent) {
    e.preventDefault();
    if (!ruleForm.categoryId) return;
    setError("");
    try {
      await createRule({ keyword: ruleForm.keyword, categoryId: Number(ruleForm.categoryId) });
      setRuleOpen(false);
      setRuleForm({ keyword: "", categoryId: "" });
      load();
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  function askRemoveCategory(category: Category) {
    confirm.ask(
      {
        title: "מחיקת קטגוריה",
        message: (
          <>
            הקטגוריה <strong>{category.icon} {category.name}</strong> תימחק.
            <span className="confirm-consequence">
              תנועות שסווגו אליה יישארו — הן פשוט יחזרו להיות ללא קטגוריה.
            </span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        await deleteCategory(category.id);
        load();
      }
    );
  }

  function askRemoveRule(rule: CategoryRule) {
    confirm.ask(
      {
        title: "מחיקת חוק סיווג",
        message: (
          <>
            החוק על <strong>{rule.keyword}</strong> יימחק.
            <span className="confirm-consequence">
              עסקאות שכבר סווגו לפיו שומרות על הקטגוריה שלהן; רק סיווג עתידי ייפסק.
            </span>
          </>
        ),
        confirmLabel: "מחיקה",
        tone: "danger",
      },
      async () => {
        await deleteRule(rule.id);
        load();
      }
    );
  }

  const categoryById = new Map((categoriesRes.data ?? []).map((c) => [c.id, c]));

  const ruleColumns: Column<CategoryRule>[] = [
    { key: "keyword", header: "מילת מפתח", render: (row) => <strong>{row.keyword}</strong> },
    {
      key: "category",
      header: "קטגוריה",
      render: (row) => {
        const category = row.category ?? categoryById.get(row.categoryId);
        return category ? `${category.icon ?? ""} ${category.name}` : "—";
      },
    },
    { key: "scope", header: "מקור", render: (row) => (row.userId === null ? <span className="text-muted">ברירת מחדל</span> : "שלי") },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) =>
        row.userId !== null ? (
          <Button size="sm" variant="ghost" onClick={() => askRemoveRule(row)} aria-label={`מחיקת החוק ${row.keyword}`}>
            🗑️
          </Button>
        ) : null,
    },
  ];

  const cats = categoriesRes.data ?? [];
  const rules = rulesRes.data ?? [];

  return (
    <PageShell
      toolbar={
        <>
          <Button onClick={() => setCatOpen(true)}>+ קטגוריה</Button>
          <Button variant="outline" onClick={() => setRuleOpen(true)}>
            + חוק סיווג
          </Button>
          <span className="text-muted">
            חוקי סיווג מסווגים אוטומטית עסקאות אשראי והוצאות מיובאות לפי מילת מפתח
          </span>
        </>
      }
      summary={
        <AsyncSection
          resource={categoriesRes}
          errorTitle="לא הצלחנו לטעון את הסיכום"
          skeleton={<SkeletonKpiRow count={4} label="טוען סיכום" />}
        >
          {(rows) => (
            <div className="kpi-row">
              <SummaryCard
                label="קטגוריות הוצאה"
                value={String(rows.filter((c) => c.type === "expense").length)}
                icon="🏷️"
              />
              <SummaryCard
                label="קטגוריות הכנסה"
                value={String(rows.filter((c) => c.type === "income").length)}
                icon="💰"
                tone="success"
              />
              <SummaryCard label="חוקי סיווג" value={String(rules.length)} icon="🪄" />
              <SummaryCard
                label="חוקים שהוספתי"
                value={String(rules.filter((r) => r.userId !== null).length)}
                icon="✏️"
                sub={`${cats.filter((c) => c.userId !== null).length} קטגוריות משלי`}
              />
            </div>
          )}
        </AsyncSection>
      }
    >
      <Card title="קטגוריות">
        <AsyncSection
          resource={categoriesRes}
          errorTitle="לא הצלחנו לטעון את הקטגוריות"
          skeleton={<SkeletonRows rows={3} label="טוען קטגוריות" />}
          isEmpty={(rows) => rows.length === 0}
          emptyState={<EmptyState icon="🏷️" title="אין קטגוריות" hint="הוסיפי קטגוריה כדי לסווג הוצאות והכנסות" />}
        >
          {(rows) => (
            <div className="category-grid">
              {rows.map((category) => (
                <div key={category.id} className="category-chip" style={{ borderColor: category.color ?? undefined }}>
                  <span className="category-chip-icon">{category.icon}</span>
                  <span className="category-chip-name">{category.name}</span>
                  {category.type === "income" && <span className="text-success">הכנסה</span>}
                  {category.userId !== null && (
                    <button
                      className="category-chip-delete"
                      onClick={() => askRemoveCategory(category)}
                      aria-label={`מחיקת הקטגוריה ${category.name}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </AsyncSection>
      </Card>

      <Card title="חוקי סיווג אוטומטי">
        <AsyncSection
          resource={rulesRes}
          errorTitle="לא הצלחנו לטעון את חוקי הסיווג"
          skeleton={<SkeletonRows rows={4} label="טוען חוקים" />}
        >
          {(rows) => (
            <Table
              columns={ruleColumns}
              rows={rows}
              rowKey={(row) => row.id}
              emptyState={<EmptyState icon="🪄" title="אין חוקים" hint="הוסיפי חוק — למשל: כל עסקה עם 'שופרסל' תסווג לאוכל בסופר" />}
            />
          )}
        </AsyncSection>
      </Card>

      <Modal title="קטגוריה חדשה" open={catOpen} onClose={() => setCatOpen(false)}>
        <form onSubmit={submitCategory}>
          {error && <ErrorMessage message={error} />}
          <Input label="שם" required value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} />
          <div className="form-row">
            <Select
              label="סוג"
              options={[{ value: "expense", label: "הוצאה" }, { value: "income", label: "הכנסה" }]}
              value={catForm.type}
              onChange={(e) => setCatForm({ ...catForm, type: e.target.value })}
            />
            <Input label="אייקון (אימוג'י)" value={catForm.icon} onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })} />
            <div className="field">
              <label className="field-label">צבע</label>
              <input
                type="color"
                className="field-input color-input"
                value={catForm.color}
                onChange={(e) => setCatForm({ ...catForm, color: e.target.value })}
              />
            </div>
          </div>
          <div className="modal-actions">
            <Button type="submit">הוספה</Button>
            <Button type="button" variant="ghost" onClick={() => setCatOpen(false)}>ביטול</Button>
          </div>
        </form>
      </Modal>

      <Modal title="חוק סיווג חדש" open={ruleOpen} onClose={() => setRuleOpen(false)}>
        <form onSubmit={submitRule}>
          {error && <ErrorMessage message={error} />}
          <Input
            label="מילת מפתח (בשם בית העסק)"
            required
            value={ruleForm.keyword}
            onChange={(e) => setRuleForm({ ...ruleForm, keyword: e.target.value })}
          />
          <Select
            label="קטגוריה"
            options={(categoriesRes.data ?? [])
              .filter((c) => c.type === "expense")
              .map((c) => ({ value: c.id, label: `${c.icon ?? ""} ${c.name}` }))}
            placeholder="בחרי קטגוריה"
            required
            value={ruleForm.categoryId}
            onChange={(e) => setRuleForm({ ...ruleForm, categoryId: e.target.value ? Number(e.target.value) : "" })}
          />
          <div className="modal-actions">
            <Button type="submit">הוספה</Button>
            <Button type="button" variant="ghost" onClick={() => setRuleOpen(false)}>ביטול</Button>
          </div>
        </form>
      </Modal>

      {confirm.dialog}
    </PageShell>
  );
}
