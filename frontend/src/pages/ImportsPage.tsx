import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useMonth } from "../context/MonthContext";
import { apiErrorMessage } from "../services/api";
import { importExpensesFile, smartImportFile, type SmartImportResult } from "../services/finance.service";
import type { ImportExpensesResult } from "../types/models";
import { formatCurrency, formatMonthKey } from "../utils/format";

const KIND_LABEL: Record<string, string> = {
  bank: "דף חשבון בנק",
  credit: "דוח כרטיס אשראי",
  unknown: "לא זוהה",
};

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
  const smartRef = useRef<HTMLInputElement>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);

  async function onSmartFile(file: File, kind?: "bank" | "credit") {
    setSmartBusy(true);
    setSmartError("");
    setSmartResult(null);
    setLastFile(file);
    try {
      setSmartResult(await smartImportFile(file, kind));
    } catch (err) {
      setSmartError(apiErrorMessage(err));
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
    <>
      <Card title="ייבוא דוח — הכי פשוט">
        <p className="settings-hint">
          גררי לכאן דף חשבון בנק <strong>או</strong> דוח כרטיס אשראי — המערכת מזהה לבד מה זה לפי
          הכותרות בקובץ. אם הדוח כבר הועלה, לא ייווצרו כפילויות: נקלטות רק שורות חדשות.
        </p>
        <div className="import-dropzone" onClick={() => smartRef.current?.click()}>
          <div className="import-dropzone-icon">🪄</div>
          <div>{smartBusy ? "מזהה ומעבד..." : "לחיצה לבחירת קובץ — בנק או אשראי"}</div>
          <div className="text-muted">.xlsx / .xls / .csv / .pdf עד 10MB</div>
        </div>
        <input
          ref={smartRef}
          type="file"
          accept=".xlsx,.xls,.csv,.pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onSmartFile(file);
            e.target.value = "";
          }}
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

        {smartResult && (
          <div className="info-banner">
            <div>
              זוהה: <strong>{KIND_LABEL[smartResult.kind] ?? smartResult.kind}</strong>
              <span className="text-muted"> · {smartResult.detectionReason}</span>
            </div>
            <div>
              {smartResult.alreadyImported ? "⚠️ " : "✅ "}
              {smartResult.message}
            </div>
            <div className="text-muted">
              בקובץ {smartResult.parsedRows} שורות · נוספו {smartResult.importedRows} · דולגו{" "}
              {smartResult.skippedDuplicates} (כבר היו)
            </div>
            {/* Wrong guess is recoverable: re-run the same file as the other kind. */}
            {lastFile && !smartResult.alreadyImported && (
              <div className="import-result-actions">
                {smartResult.importedRows > 0 && (
                  <Button
                    size="sm"
                    onClick={() =>
                      navigate(smartResult.kind === "credit" ? "/accounts?tab=credit" : "/accounts?tab=reconcile")
                    }
                  >
                    {smartResult.kind === "credit" ? "לאישור העסקאות ←" : "למסך ההתאמות ←"}
                  </Button>
                )}
              </div>
            )}
            {lastFile && smartResult.importedRows === 0 && !smartResult.alreadyImported && (
              <div className="import-result-actions">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSmartFile(lastFile, smartResult.kind === "bank" ? "credit" : "bank")}
                >
                  זיהוי שגוי? נסי כ־{smartResult.kind === "bank" ? "דוח אשראי" : "דף חשבון"}
                </Button>
              </div>
            )}
          </div>
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
    </>
  );
}
