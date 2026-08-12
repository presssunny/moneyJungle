import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AssistantPanel } from "../components/assistant/AssistantPanel";
import { AsyncSection } from "../components/common/AsyncSection";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useConfirm } from "../components/common/ConfirmDialog";
import { DropZone } from "../components/common/DropZone";
import { EmptyState } from "../components/common/EmptyState";
import { PageShell } from "../components/common/PageShell";
import { SkeletonKpiRow, SkeletonRows } from "../components/common/Skeleton";
import { Table, type Column } from "../components/common/Table";
import { SummaryCard } from "../components/dashboard/SummaryCard";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import {
  deleteDocument,
  downloadDocumentFile,
  listDocuments,
  rollbackDocument,
  type DocumentRecord,
  type RollbackResult,
} from "../services/documents.service";
import { importLoanSchedule, smartImportFile, type SmartImportResult } from "../services/finance.service";
import { toast } from "../services/toast";
import type { AssistantAnswers, AssistantStep } from "../types/assistant";
import { formatDate } from "../utils/format";

const STATUS: Record<DocumentRecord["status"], { icon: string; label: string; tone: string }> = {
  imported: { icon: "✅", label: "נקלט", tone: "success" },
  superseded: { icon: "⏭️", label: "כבר היה קיים", tone: "muted" },
  rejected: { icon: "↩️", label: "הופנה למקום אחר", tone: "warning" },
  rolled_back: { icon: "🚫", label: "הייבוא בוטל", tone: "muted" },
};

const KIND_ICON: Record<string, string> = {
  bank_statement: "🏦",
  credit_report: "💳",
  loan_schedule: "📉",
  expense_sheet: "📊",
  unknown: "❔",
};

function fileSize(bytes: number): string {
  if (bytes <= 0) return "—";
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/** Consequences of an undo the user cannot see for herself, and must be told about. */
function hasRollbackNotice(result: RollbackResult): boolean {
  return (
    result.reopenedLoans.length > 0 ||
    result.unresolvedClosedLoans.length > 0 ||
    result.overlappingImports.length > 0
  );
}

/**
 * One place to drop any file, and the history of everything ever dropped.
 * Two destructive actions must not be confused: 🗑️ drops the log entry and
 * leaves the data, ↺ undoes the import itself.
 */
export default function DocumentsPage() {
  const docs = useAsync(() => listDocuments(), [], "לא הצלחנו לטעון את המסמכים");
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [busy, setBusy] = useState(false);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [step, setStep] = useState<AssistantStep | null>(null);
  const [result, setResult] = useState<SmartImportResult | null>(null);
  /** What the last undo cost. Kept on screen — a toast is gone too fast to act on. */
  const [undone, setUndone] = useState<RollbackResult | null>(null);

  /**
   * One turn of the import conversation. The same file is re-sent with the
   * answers, so nothing is buffered server-side.
   */
  async function onFile(file: File, answers?: AssistantAnswers) {
    setBusy(true);
    setLastFile(file);
    try {
      const next = await smartImportFile(file, undefined, answers);
      setResult(next);
      setStep(next.assistant);
      docs.reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setStep(null);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  /**
   * A schedule is not a statement, so it goes to its own importer. Offering it
   * here means the user never has to know which screen owns which file.
   */
  async function onScheduleHere(file: File) {
    setBusy(true);
    try {
      const imported = await importLoanSchedule(file);
      setStep(imported.assistant);
      setResult(null);
      docs.reload();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function askRemove(doc: DocumentRecord) {
    confirm.ask(
      {
        title: "מחיקת רישום המסמך",
        message: (
          <>
            הרישום של <strong>{doc.fileName}</strong> יימחק מההיסטוריה
            {doc.hasFile && <>, וגם העותק השמור של הקובץ עצמו</>}.
            <span className="confirm-consequence">
              הנתונים שיובאו ממנו — התנועות, ההכנסות וההוצאות —{" "}
              <strong>יישארו</strong> ללא שינוי. אם המטרה היא להסיר גם אותם, יש
              להשתמש ב״ביטול הייבוא״ (↺) ולא כאן.
            </span>
          </>
        ),
        confirmLabel: "מחיקת הרישום",
        tone: "danger",
      },
      async () => {
        try {
          await deleteDocument(doc.id);
          docs.reload();
        } catch (err) {
          toast.error(apiErrorMessage(err));
        }
      },
    );
  }

  /**
   * The real undo, as opposed to askRemove above. Two texts because a credit
   * report and a bank statement genuinely undo differently.
   */
  function askRollback(doc: DocumentRecord) {
    const isCredit = doc.kind === "credit_report";
    confirm.ask(
      {
        title: "ביטול הייבוא",
        message: isCredit ? (
          <>
            כל עסקאות האשראי שיובאו מ<strong>{doc.fileName}</strong> יימחקו.
            <span className="confirm-consequence">
              זו <strong>לא</strong> מחיקת הרישום — הנתונים עצמם יימחקו. רישום המסמך יישאר,
              מסומן כ״הייבוא בוטל״.
              <br />
              הסכומים בבית ישתנו בשני כיוונים: העסקאות המפורטות ייעלמו, ובמקומן חיובי הכרטיס
              בדף הבנק יחזרו להיספר כהוצאה. אין כאן שמירה על עסקאות שערכת ידנית — הכול נמחק
              יחד עם הייבוא.
            </span>
          </>
        ) : (
          <>
            כל התנועות שיובאו מ<strong>{doc.fileName}</strong> יימחקו, וגם ההכנסות וההוצאות
            שנוצרו מהן.
            <span className="confirm-consequence">
              זו <strong>לא</strong> מחיקת הרישום — הנתונים עצמם יימחקו והסכומים בבית ישתנו.
              רישום המסמך יישאר, מסומן כ״הייבוא בוטל״.
              <br />
              שימי לב: המערכת לא מזהה עריכות ידניות שעשית לתנועות (שינוי קטגוריה, למשל) — הן
              יימחקו יחד עם השאר. יישמרו רק תנועות שהחרגת ידנית או שקישרת ידנית להלוואה.
              הלוואה שהמערכת סגרה בעצמה בגלל תנועה שתימחק תחזור להיות פעילה; הלוואה שסגרת
              בעצמך תישאר סגורה.
            </span>
          </>
        ),
        confirmLabel: "לבטל את הייבוא",
        tone: "danger",
      },
      async () => {
        try {
          const result = await rollbackDocument(doc.id);
          toast.success(result.message);
          setUndone(result);
          docs.reload();
        } catch (err) {
          toast.error(apiErrorMessage(err));
        }
      },
    );
  }

  async function openFile(doc: DocumentRecord) {
    try {
      await downloadDocumentFile(doc.id, doc.fileName);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns: Column<DocumentRecord>[] = [
    {
      key: "file",
      header: "מסמך",
      render: (row) => (
        <span>
          <strong>
            <span aria-hidden>{KIND_ICON[row.kind] ?? "📄"} </span>
            {row.fileName}
          </strong>
          <small className="text-muted block">
            {row.kindLabel} · {fileSize(row.sizeBytes)}
            {row.note && ` · ${row.note}`}
          </small>
        </span>
      ),
    },
    {
      key: "status",
      header: "מצב",
      render: (row) => {
        const state = STATUS[row.status];
        return (
          <span className={`doc-status doc-status-${state.tone}`}>
            <span aria-hidden>{state.icon}</span> {state.label}
          </span>
        );
      },
    },
    {
      key: "coverage",
      header: "תקופה",
      render: (row) =>
        row.coverageFrom && row.coverageTo ? (
          <span className="mono doc-coverage">
            {formatDate(row.coverageFrom)} – {formatDate(row.coverageTo)}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "rows",
      header: "שורות",
      align: "left",
      render: (row) => (
        <span className="mono">
          {row.rowsImported}
          {row.rowsSkipped > 0 && (
            <span className="text-muted"> (+{row.rowsSkipped} כבר היו)</span>
          )}
        </span>
      ),
    },
    { key: "when", header: "הועלה", render: (row) => formatDate(row.uploadedAt) },
    {
      key: "actions",
      header: "",
      align: "left",
      render: (row) => (
        <span className="row-actions">
          {row.hasFile && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openFile(row)}
              title="צפייה בקובץ המקורי"
              aria-label={`צפייה בקובץ המקורי של ${row.fileName}`}
            >
              👁️
            </Button>
          )}
          {row.linkedLoanId && (
            <Button size="sm" variant="ghost" onClick={() => navigate("/accounts?tab=loans")} title="להלוואה">
              📉
            </Button>
          )}
          {row.linkedCreditImportId && (
            <Button size="sm" variant="ghost" onClick={() => navigate("/accounts?tab=credit")} title="לאשראי">
              💳
            </Button>
          )}
          {row.linkedAccountId && (
            <Button size="sm" variant="ghost" onClick={() => navigate("/accounts?tab=bank")} title="לחשבון">
              🏦
            </Button>
          )}
          {row.canRollback && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => askRollback(row)}
              title="ביטול הייבוא — מוחק את התנועות"
              aria-label={`ביטול הייבוא של ${row.fileName}`}
            >
              ↺
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => askRemove(row)}
            title="מחיקת הרישום בלבד"
            aria-label={`מחיקת הרישום של ${row.fileName}`}
          >
            🗑️
          </Button>
        </span>
      ),
    },
  ];

  return (
    <PageShell
      summary={
        <AsyncSection
          resource={docs}
          errorTitle="לא הצלחנו לטעון את סיכום המסמכים"
          skeleton={<SkeletonKpiRow count={4} label="טוען סיכום מסמכים" />}
        >
          {({ summary }) => (
            <div className="kpi-row">
              <SummaryCard label="מסמכים שהועלו" value={String(summary.total)} icon="📁" />
              <SummaryCard
                label="שורות שנקלטו"
                value={String(summary.rowsImported)}
                icon="📥"
                tone="success"
              />
              <SummaryCard
                label="תקופה מכוסה"
                value={
                  summary.coverageFrom && summary.coverageTo
                    ? `${formatDate(summary.coverageFrom)} – ${formatDate(summary.coverageTo)}`
                    : "—"
                }
                icon="🗓️"
              />
              <SummaryCard
                label="הועלו פעמיים"
                value={String(summary.duplicateUploads)}
                icon="♻️"
                tone={summary.duplicateUploads > 0 ? "warning" : "default"}
                sub={
                  summary.duplicateUploads > 0
                    ? "אותו קובץ בדיוק — לא נוצרו כפילויות"
                    : "אין קבצים שהועלו פעמיים"
                }
              />
            </div>
          )}
        </AsyncSection>
      }
    >
      <Card title="העלאת מסמך">
        <p className="settings-hint">
          כל מסמך פיננסי נכנס כאן: דף חשבון, דוח אשראי או לוח סילוקין. המערכת מזהה לבד מה זה,
          מנתבת למקום הנכון, ואם משהו לא ברור לה — היא שואלת במקום להיכשל.
        </p>
        <DropZone
          onFile={(file) => onFile(file)}
          busy={busy}
          accept=".xlsx,.xls,.csv,.pdf"
          icon="📂"
          title={busy ? "קורא את המסמך..." : "גררי לכאן מסמך, או לחצי לבחירה"}
          hint=".xlsx / .xls / .csv / .pdf עד 10MB"
        />

        {step && (
          <AssistantPanel
            step={step}
            busy={busy}
            onAnswer={(answers) => lastFile && onFile(lastFile, answers)}
            footer={
              step.status !== "needs_answers" ? (
                <div className="import-result-actions">
                  {/* A schedule landed here by mistake — offer to do it properly
                      instead of sending the user to another screen. */}
                  {result?.kind === "loan_schedule" && lastFile && (
                    <Button size="sm" onClick={() => onScheduleHere(lastFile)}>
                      לטעון אותו כלוח סילוקין
                    </Button>
                  )}
                  {result && result.importedRows > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate(
                          result.kind === "credit" ? "/accounts?tab=credit" : "/accounts?tab=reconcile"
                        )
                      }
                    >
                      {result.kind === "credit" ? "לאישור העסקאות ←" : "למסך ההתאמות ←"}
                    </Button>
                  )}
                </div>
              ) : undefined
            }
          />
        )}
      </Card>

      <Card title="היסטוריית המסמכים">
        {undone && hasRollbackNotice(undone) && (
          <div className="doc-rollback-notice" role="status">
            <strong>מה שקרה בעקבות ביטול הייבוא:</strong>
            <ul>
              {undone.reopenedLoans.map((loan, index) => (
                <li key={`${loan.loanName}-${index}`}>
                  ההלוואה <strong>{loan.loanName}</strong> חזרה להיות פעילה עם יתרה של{" "}
                  {loan.balance.toLocaleString("he-IL")} ₪ — היא נסגרה בגלל שורה שנמחקה עכשיו.
                </li>
              ))}
              {/* No record of which row closed it, so no honest balance to restore. */}
              {undone.unresolvedClosedLoans.map((loan, index) => (
                <li key={`unresolved-${loan.loanNumber}-${index}`}>
                  יש הלוואה סגורה — <strong>{loan.loanName}</strong> (מספר {loan.loanNumber}) —
                  שאולי קשורה לשורות שנמחקו עכשיו. היא נשארה סגורה; כדאי לבדוק ולעדכן את היתרה
                  ידנית אם צריך.
                </li>
              ))}
              {/* A row two files carried was stored once, and left with its batch. */}
              {undone.overlappingImports.map((file) => (
                <li key={file.fileName}>
                  התאריכים {formatDate(file.coverageFrom)}–{formatDate(file.coverageTo)} מכוסים גם
                  בקובץ <strong>{file.fileName}</strong> — כדאי לייבא אותו מחדש כדי לא לאבד תנועות.
                </li>
              ))}
            </ul>
            <Button size="sm" variant="ghost" onClick={() => setUndone(null)}>
              הבנתי
            </Button>
          </div>
        )}
        <AsyncSection
          resource={docs}
          errorTitle="לא הצלחנו לטעון את המסמכים"
          skeleton={<SkeletonRows rows={4} label="טוען מסמכים" />}
          isEmpty={({ items }) => items.length === 0}
          emptyState={
            <EmptyState
              icon="📁"
              title="עוד לא הועלו מסמכים"
              hint="כל קובץ שתעלי כאן יירשם — כך תמיד אפשר לדעת מה כבר נקלט ומאיזו תקופה"
            />
          }
        >
          {({ items }) => (
            <Table columns={columns} rows={items} rowKey={(row) => row.id} />
          )}
        </AsyncSection>
      </Card>

      {confirm.dialog}
    </PageShell>
  );
}
