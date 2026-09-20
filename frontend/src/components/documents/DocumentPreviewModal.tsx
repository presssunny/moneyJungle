import { useEffect, useState } from "react";
import { AsyncSection } from "../common/AsyncSection";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";
import { SkeletonRows } from "../common/Skeleton";
import { Table, type Column } from "../common/Table";
import { useAsync } from "../../hooks/useAsync";
import { apiErrorMessage } from "../../services/api";
import {
  downloadDocumentFile,
  fetchDocumentFile,
  getDocumentRows,
  type DocumentRecord,
  type DocumentRow,
} from "../../services/documents.service";
import { toast } from "../../services/toast";
import { formatCurrency, formatDate } from "../../utils/format";

function isPdf(fileName: string): boolean {
  return /\.pdf$/i.test(fileName);
}

const RESOLUTION_TONE: Record<string, string> = {
  include: "text-success",
  duplicate: "text-muted",
  review: "text-warning",
};

const columns: Column<DocumentRow>[] = [
  { key: "date", header: "תאריך", render: (r) => (r.date ? formatDate(r.date) : "—") },
  { key: "name", header: "שם", render: (r) => r.name || "—" },
  { key: "amount", header: "סכום", align: "left", render: (r) => <span className="mono">{formatCurrency(r.amount)}</span> },
  {
    key: "resolution",
    header: "מה קרה לשורה",
    render: (r) => <span className={RESOLUTION_TONE[r.resolution] ?? ""}>{r.resolutionLabel}</span>,
  },
];

/** The file itself, when the browser can render it inline. Revokes its blob URL on change/unmount. */
function FileFrame({ doc }: { doc: DocumentRecord }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setError("");
    fetchDocumentFile(doc.id)
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((err) => {
        if (alive) setError(apiErrorMessage(err));
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id]);

  if (error) return <p role="alert">{error}</p>;
  if (!url) return <SkeletonRows rows={2} label="טוען את הקובץ" />;
  return <iframe className="doc-preview-frame" src={url} title={`תצוגה מקדימה של ${doc.fileName}`} />;
}

/** Body only mounts while a document is selected, so its hooks start fresh each time (`key={doc.id}` on the caller). */
function DocumentPreviewBody({ doc }: { doc: DocumentRecord }) {
  const [page, setPage] = useState(1);
  const rowsRes = useAsync(() => getDocumentRows(doc.id, page), [doc.id, page], "לא הצלחנו לטעון את מה שזוהה מהקובץ");

  async function download() {
    try {
      await downloadDocumentFile(doc.id, doc.fileName);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <>
      {doc.hasFile ? (
        isPdf(doc.fileName) ? (
          <FileFrame doc={doc} />
        ) : (
          <div className="doc-preview-unavailable">
            <span aria-hidden style={{ fontSize: 28 }}>
              📊
            </span>
            <p>
              תצוגה מקדימה בתוך הדפדפן זמינה כרגע רק לקבצי PDF. הקובץ ({doc.kindLabel}) נשמר ואפשר להוריד אותו כדי
              לפתוח אותו.
            </p>
            <Button size="sm" variant="outline" onClick={download}>
              ⬇️ הורדת הקובץ
            </Button>
          </div>
        )
      ) : (
        <div className="doc-preview-unavailable">
          <span aria-hidden style={{ fontSize: 28 }}>
            📁
          </span>
          <p>הקובץ עצמו לא נשמר — המסמך הועלה לפני שהמערכת התחילה לשמור קבצים.</p>
        </div>
      )}

      <div>
        <h3 className="modal-section-title">מה המערכת זיהתה מהקובץ</h3>
        <AsyncSection
          resource={rowsRes}
          errorTitle="לא הצלחנו לטעון את מה שזוהה מהקובץ"
          skeleton={<SkeletonRows rows={3} />}
          isEmpty={(data) => !data.available || data.rows.length === 0}
          emptyState={
            <p className="text-muted">
              {rowsRes.data?.available === false
                ? "אין פירוט שורות שמור למסמך הזה — ייתכן שהוא הועלה לפני שהמערכת התחילה לשמור פירוט ברמת השורה."
                : "לא נמצאו שורות."}
            </p>
          }
        >
          {(data) => (
            <>
              <div className="doc-preview-rows-table">
                <Table columns={columns} rows={data.rows} rowKey={(r) => r.rowNumber} pageSize={0} />
              </div>
              <p className="text-muted">
                {data.total} שורות בסך הכול
                {data.total > data.pageSize && ` · עמוד ${data.page} מתוך ${Math.ceil(data.total / data.pageSize)}`}
              </p>
              {data.total > data.pageSize && (
                <div className="row-actions">
                  <Button size="sm" variant="ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    הקודם
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={page * data.pageSize >= data.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    הבא
                  </Button>
                </div>
              )}
            </>
          )}
        </AsyncSection>
      </div>
    </>
  );
}

export function DocumentPreviewModal({ doc, onClose }: { doc: DocumentRecord | null; onClose: () => void }) {
  return (
    <Modal title={doc?.fileName ?? ""} open={doc !== null} onClose={onClose} size="wide">
      {doc && <DocumentPreviewBody doc={doc} key={doc.id} />}
    </Modal>
  );
}
