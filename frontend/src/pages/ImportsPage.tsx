import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AssistantPanel } from "../components/assistant/AssistantPanel";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { DropZone } from "../components/common/DropZone";
import { PageShell } from "../components/common/PageShell";
import { useMonth } from "../context/MonthContext";
import { apiErrorMessage } from "../services/api";
import { importExpensesFile, smartImportFile, type SmartImportResult } from "../services/finance.service";
import type { AssistantAnswers } from "../types/assistant";
import type { ImportExpensesResult } from "../types/models";
import { formatCurrency, formatMonthKey } from "../utils/format";

export default function ImportsPage() {
  const { monthKey } = useMonth();
  const navigate = useNavigate();
  const [result, setResult] = useState<ImportExpensesResult | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Smart import — the app works out whether the file is a bank or card
  // statement, so the user never has to pick a tab before uploading.
  const [smartResult, setSmartResult] = useState<SmartImportResult | null>(null);
  const [smartError, setSmartError] = useState("");
  const [smartBusy, setSmartBusy] = useState(false);
  const [lastFile, setLastFile] = useState<File | null>(null);

  /**
   * One turn of the import conversation.
   *
   * `answers` replies to whatever the previous turn asked. The file is sent
   * again with them — the server holds no pending upload, so the flow survives a
   * restart and cannot leak memory.
   */
  async function onSmartFile(file: File, kind?: "bank" | "credit", answers?: AssistantAnswers) {
    setSmartBusy(true);
    setSmartError("");
    setLastFile(file);
    try {
      const next = await smartImportFile(file, kind, answers);
      setSmartResult(next);
    } catch (err) {
      // A genuine failure — not a question. Those come back as a normal
      // response with `assistant.questions`.
      setSmartError(apiErrorMessage(err));
      setSmartResult(null);
    } finally {
      setSmartBusy(false);
    }
  }

  async function onFile(file: File) {
    setUploading(true);
    setError("");
    setResult(null);
    try {
      setResult(await importExpensesFile(file, monthKey));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <PageShell>
      <Card title="ייבוא דוח — הכי פשוט">
        <p className="settings-hint">
          גררי לכאן דף חשבון בנק <strong>או</strong> דוח כרטיס אשראי — המערכת מזהה לבד מה זה לפי
          הכותרות בקובץ. אם הדוח כבר הועלה, לא ייווצרו כפילויות: נקלטות רק שורות חדשות.
        </p>
        <DropZone
          onFile={(file) => onSmartFile(file)}
          busy={smartBusy}
          accept=".xlsx,.xls,.csv,.pdf"
          icon="🪄"
          title={smartBusy ? "קורא את הקובץ..." : "גררי לכאן דף חשבון או דוח אשראי, או לחצי לבחירה"}
          hint=".xlsx / .xls / .csv / .pdf עד 10MB"
        />

        {smartError && (
          <div className="error-message">
            {smartError}
            {lastFile && (
              <div className="import-result-actions">
                <Button size="sm" variant="outline" onClick={() => onSmartFile(lastFile, "bank")}>
                  זה דף חשבון בנק
                </Button>
                <Button size="sm" variant="outline" onClick={() => onSmartFile(lastFile, "credit")}>
                  זה דוח אשראי
                </Button>
              </div>
            )}
          </div>
        )}

        {/* The conversation. An unrecognised file is a question here, not a red
            error — and a successful import narrates what it actually did. */}
        {smartResult && (
          <AssistantPanel
            step={smartResult.assistant}
            busy={smartBusy}
            onAnswer={(answers) => lastFile && onSmartFile(lastFile, undefined, answers)}
            footer={
              smartResult.assistant.status !== "needs_answers" && lastFile ? (
                <div className="import-result-actions">
                  {smartResult.importedRows > 0 && (
                    <Button
                      size="sm"
                      onClick={() =>
                        navigate(
                          smartResult.kind === "credit" ? "/accounts?tab=credit" : "/accounts?tab=reconcile"
                        )
                      }
                    >
                      {smartResult.kind === "credit" ? "לאישור העסקאות ←" : "למסך ההתאמות ←"}
                    </Button>
                  )}
                  {smartResult.kind === "loan_schedule" && (
                    <Button size="sm" onClick={() => navigate("/accounts?tab=loans")}>
                      למסך ההלוואות ←
                    </Button>
                  )}
                  {/* A wrong guess stays recoverable in one click. */}
                  {smartResult.kind !== "unknown" && smartResult.kind !== "loan_schedule" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onSmartFile(lastFile, smartResult.kind === "bank" ? "credit" : "bank")}
                    >
                      זיהוי שגוי? נסי כ־{smartResult.kind === "bank" ? "דוח אשראי" : "דף חשבון"}
                    </Button>
                  )}
                </div>
              ) : undefined
            }
          />
        )}
      </Card>

      <Card title={`ייבוא הוצאות מאקסל · ${formatMonthKey(monthKey)}`}>
        <p className="settings-hint">
          מעלים קובץ אקסל עם עמודות <strong>שם</strong> ו<strong>סכום</strong> (ואפשר גם אמצעי תשלום, תאריך וקטגוריה) —
          בדיוק כמו גיליון התכנון החודשי המשפחתי. שורות כותרת וסעיפים ריקים מדולגים אוטומטית,
          והעלאה חוזרת של אותו קובץ לא תיצור כפילויות.
        </p>
        <div className="import-dropzone" onClick={() => fileRef.current?.click()}>
          <div className="import-dropzone-icon">📂</div>
          <div>{uploading ? "מעלה ומעבד..." : "לחיצה לבחירת קובץ אקסל"}</div>
          <div className="text-muted">.xlsx / .xls / .csv עד 10MB</div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = "";
          }}
        />
        {error && <div className="error-message">{error}</div>}
        {result && (
          <div className="info-banner">
            נקלטו {result.parsed} שורות · נוצרו <strong>{result.created}</strong> הוצאות בסך{" "}
            <strong className="mono">{formatCurrency(result.totalAmount)}</strong>
            {result.skipped > 0 && <> · {result.skipped} דולגו (כבר קיימות)</>}
            {result.months && result.months.length > 1 && (
              <> · פוזרו ל־{result.months.length} חודשים לפי התאריך בכל שורה</>
            )}
            <div className="import-result-actions">
              <Button size="sm" onClick={() => navigate("/expenses")}>מעבר להוצאות ←</Button>
            </div>
          </div>
        )}
      </Card>

      <Card title="ייבוא דוח אשראי">
        <p className="settings-hint">
          קובץ פירוט עסקאות מחברת האשראי (ישראכרט, מקס, כאל...) מייבאים בעמוד האשראי —
          העסקאות מסווגות אוטומטית לפי חוקי הסיווג וממתינות לאישור.
        </p>
        <Button variant="outline" onClick={() => navigate("/credit")}>לעמוד האשראי 💳</Button>
      </Card>
    </PageShell>
  );
}
