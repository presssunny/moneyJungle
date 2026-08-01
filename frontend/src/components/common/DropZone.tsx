import { useRef, useState, type DragEvent } from "react";

interface DropZoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
  busy?: boolean;
  accept?: string;
  title?: string;
  hint?: string;
  icon?: string;
}

/**
 * Drag-and-drop (or click) file drop zone. Reusable across import flows —
 * bank statements, credit exports, expense sheets. Keyboard accessible: the
 * zone is a button, Enter/Space open the file picker.
 */
export function DropZone({
  onFile,
  disabled = false,
  busy = false,
  accept = ".xlsx,.xls,.csv",
  title = "גררי לכאן קובץ או לחצי לבחירה",
  hint,
  icon = "📥",
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const locked = disabled || busy;

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) onFile(file);
  }

  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    setDragActive(false);
    if (locked) return;
    handleFiles(e.dataTransfer.files);
  }

  function onDragOver(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (!locked) setDragActive(true);
  }

  return (
    <button
      type="button"
      className={`dropzone ${dragActive ? "dropzone-active" : ""} ${locked ? "dropzone-disabled" : ""}`}
      onClick={() => !locked && inputRef.current?.click()}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragActive(false)}
      disabled={locked}
      aria-busy={busy}
    >
      <span className="dropzone-icon" aria-hidden>
        {busy ? "⏳" : icon}
      </span>
      <span className="dropzone-title">{busy ? "מעלה ומעבד..." : title}</span>
      {hint && !busy && <span className="dropzone-hint">{hint}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </button>
  );
}
