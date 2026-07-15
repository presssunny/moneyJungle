import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/common/Button";
import { Card } from "../components/common/Card";
import { useMonth } from "../context/MonthContext";
import { apiErrorMessage } from "../services/api";
import { importExpensesFile } from "../services/finance.service";
import type { ImportExpensesResult } from "../types/models";
import { formatCurrency, formatMonthKey } from "../utils/format";

export default function ImportsPage() {
  const { monthKey } = useMonth();
  const navigate = useNavigate();
  const [result, setResult] = useState<ImportExpensesResult | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
