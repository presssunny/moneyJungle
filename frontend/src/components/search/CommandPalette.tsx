import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PALETTE_DESTINATIONS } from "../../app/navigation";
import { apiErrorMessage } from "../../services/api";
import { searchRecords, type SearchGroup } from "../../services/search.service";
import { formatCurrency, formatDate } from "../../utils/format";
import { Icon } from "../common/Icon";
import { Modal } from "../common/Modal";

interface Option {
  id: string;
  group: string;
  label: string;
  detail?: string;
  to: string;
}

const MIN_QUERY = 2;

function optionsFor(query: string, groups: SearchGroup[]): Option[] {
  const q = query.trim();
  const destinations = PALETTE_DESTINATIONS
    .filter((d) => !q || d.label.includes(q))
    .slice(0, q ? 6 : 8)
    .map((d) => ({ id: `nav:${d.path}`, group: "מסכים", label: `${d.icon} ${d.label}`, to: d.path }));
  const ask = q.length >= MIN_QUERY ? [{ id: "ask", group: "שאלה", label: `לשאול את העוזר: „${q}“`, to: `/assistant?ask=${encodeURIComponent(q)}` }] : [];
  const records = groups.flatMap((group) => group.items.map((item) => ({
    id: `record:${item.key}`, group: group.label, label: item.label, to: item.to,
    detail: [item.date ? formatDate(item.date) : null, item.amount !== null ? formatCurrency(item.amount) : null, item.detail].filter(Boolean).join(" · "),
  })));
  return [...destinations, ...ask, ...records];
}

/** ⌘K / Ctrl+K from anywhere: screens, the household's own records by name, and a question for the assistant. */
export function CommandPalette() {
  const navigate = useNavigate();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus("מחפש…");
      searchRecords(q, controller.signal)
        .then((found) => { setGroups(found); setStatus(found.length ? "" : "לא נמצאו תנועות, מסמכים או הלוואות בשם הזה"); })
        .catch((e: unknown) => { if (!controller.signal.aborted) setStatus(apiErrorMessage(e)); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  const options = useMemo(() => optionsFor(query, query.trim().length >= MIN_QUERY ? groups : []), [query, groups]);
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  function close() {
    setOpen(false); setQuery(""); setGroups([]); setActive(0); setStatus("");
  }
  function go(option: Option | undefined) {
    if (!option) return;
    close();
    navigate(option.to);
  }
  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); go(options[activeIndex]); }
  }

  return (
    <>
      <button type="button" className="header-icon-btn" onClick={() => setOpen(true)} title="חיפוש (Ctrl+K)" aria-label="חיפוש" aria-keyshortcuts="Control+K Meta+K">
        <Icon name="search" />
      </button>
      <Modal title="חיפוש ומעבר מהיר" open={open} onClose={close}>
        <div className="palette">
          <input
            className="field-input"
            data-autofocus
            role="combobox"
            aria-label="מה לחפש"
            aria-expanded={options.length > 0}
            aria-controls={listId}
            aria-activedescendant={options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            aria-autocomplete="list"
            placeholder="מסך, בית עסק, קובץ או שאלה"
            value={query}
            maxLength={60}
            onChange={(e) => { setQuery(e.target.value); setActive(0); if (e.target.value.trim().length < MIN_QUERY) { setGroups([]); setStatus(""); } }}
            onKeyDown={onInputKey}
          />
          <ul className="palette-list" role="listbox" id={listId} aria-label="תוצאות">
            {options.map((option, index) => {
              const heading = option.group !== options[index - 1]?.group ? option.group : null;
              return (
                <li key={option.id} role="presentation">
                  {heading && <div className="palette-group" aria-hidden>{heading}</div>}
                  <div
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`palette-option ${index === activeIndex ? "palette-option-active" : ""}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => go(option)}
                  >
                    <span>{option.label}</span>
                    {option.detail && <span className="text-muted palette-detail"><bdi>{option.detail}</bdi></span>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-muted palette-status" role="status">{status}</p>
        </div>
      </Modal>
    </>
  );
}
