import { useState, type FormEvent } from "react";
import { Button } from "../common/Button";
import { Input } from "../common/Input";
import { Modal } from "../common/Modal";
import { Select } from "../common/Select";
import { createReminder, type ReminderInput } from "../../services/reminders.service";
import type { Reminder } from "../../types/dashboard.types";

const TYPE_OPTIONS = [
  { value: "birthday", label: "🎂 יום הולדת" },
  { value: "expected_expense", label: "🛍️ הוצאה צפויה" },
  { value: "event", label: "📅 אירוע" },
  { value: "other", label: "🔔 אחר" },
];

interface ReminderFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ReminderForm({ open, onClose, onSaved }: ReminderFormProps) {
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [type, setType] = useState<Reminder["type"]>("other");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !eventDate) {
      setError("יש להזין כותרת ותאריך");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: ReminderInput = {
        title: title.trim(),
        eventDate,
        type,
        estimatedAmount: amount ? Number(amount) : null,
      };
      await createReminder(input);
      setTitle("");
      setEventDate("");
      setAmount("");
      setType("other");
      onSaved();
      onClose();
    } catch {
      setError("שמירת התזכורת נכשלה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="תזכורת חדשה" open={open} onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Input label="כותרת" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="יום הולדת לנועה" autoFocus />
        <div className="form-row">
          <Input label="תאריך" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          <Select label="סוג" options={TYPE_OPTIONS} value={type} onChange={(e) => setType(e.target.value as Reminder["type"])} />
        </div>
        <Input label="סכום משוער (אופציונלי)" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150" />
        {error && <div className="field-error">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            ביטול
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "שומר..." : "שמירה"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
