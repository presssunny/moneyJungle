import { useState } from "react";
import { Input } from "../common/Input";
import { Modal } from "../common/Modal";
import { Select } from "../common/Select";
import { Wizard, type WizardStep } from "../common/Wizard";
import { apiErrorMessage } from "../../services/api";
import { createIncome } from "../../services/finance.service";
import { createFamilyMember } from "../../services/planning.service";
import { formatCurrency } from "../../utils/format";

const INCOME_TYPES = [
  { value: "salary", label: "משכורת" },
  { value: "business", label: "עסק" },
  { value: "allowance", label: "קצבה" },
  { value: "extra", label: "הכנסה נוספת" },
];

/**
 * Adding a family member as a conversation. The income is created in the same
 * flow rather than on two other screens, which is why members used to sit in the
 * list with nothing attached. Only the name is required.
 */
export function FamilyMemberWizard({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [hasIncome, setHasIncome] = useState<"yes" | "no" | "">("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeType, setIncomeType] = useState("salary");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(incomeAmount);
  const wantsIncome = hasIncome === "yes" && amount > 0;

  const steps: WizardStep[] = [
    {
      key: "name",
      title: "מה השם?",
      hint: "כך הוא יופיע בכל המערכת",
      isValid: name.trim().length > 0,
      body: (
        <Input
          label="שם"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder="למשל: דנה"
        />
      ),
    },
    {
      key: "relation",
      title: "מה הקשר?",
      hint: "לא חובה — עוזר לזהות מי זה כשיש כמה בני משפחה",
      optional: true,
      body: (
        <Select
          label="קשר"
          options={[
            { value: "spouse", label: "בן/בת זוג" },
            { value: "child", label: "ילד/ה" },
            { value: "parent", label: "הורה" },
            { value: "other", label: "אחר" },
          ]}
          placeholder="לא לציין"
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
        />
      ),
    },
    {
      key: "income",
      title: `יש ל${name.trim() || "בן המשפחה"} הכנסה?`,
      hint: "אפשר להוסיף אותה עכשיו, במקום להיכנס למסך ההכנסות בנפרד",
      optional: true,
      body: (
        <>
          <div className="wizard-choices">
            {[
              { value: "yes" as const, label: "כן" },
              { value: "no" as const, label: "לא" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                className={`assistant-option ${hasIncome === option.value ? "assistant-option-active" : ""}`}
                aria-pressed={hasIncome === option.value}
                onClick={() => setHasIncome(option.value)}
              >
                <span className="assistant-option-label">{option.label}</span>
              </button>
            ))}
          </div>
          {hasIncome === "yes" && (
            <div className="form-row">
              <Input
                label="סכום חודשי (₪)"
                type="number"
                step="0.01"
                min="0"
                value={incomeAmount}
                onChange={(e) => setIncomeAmount(e.target.value)}
                autoFocus
              />
              <Select
                label="סוג"
                options={INCOME_TYPES}
                value={incomeType}
                onChange={(e) => setIncomeType(e.target.value)}
              />
            </div>
          )}
        </>
      ),
    },
  ];

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await createFamilyMember(name.trim());
      // The income belongs to the household's books either way; creating it here
      // is what saves the trip to another screen.
      if (wantsIncome) {
        await createIncome({
          amount,
          type: incomeType,
          description: `${name.trim()} — ${INCOME_TYPES.find((t) => t.value === incomeType)?.label ?? ""}`,
          incomeDate: new Date().toISOString().slice(0, 10),
          isRecurring: true,
        });
      }
      onCreated(name.trim());
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="הוספת בן משפחה" open onClose={onCancel}>
      <Wizard
        steps={steps}
        busy={busy}
        error={error}
        onCancel={onCancel}
        onFinish={finish}
        finishLabel="הוספה"
        summary={
          <>
            <div className="wizard-summary-title">מה שנוסיף</div>
            <div className="wizard-summary-row">
              <span>שם</span>
              <strong>{name.trim() || "—"}</strong>
            </div>
            {relation && (
              <div className="wizard-summary-row">
                <span>קשר</span>
                <strong>
                  {{ spouse: "בן/בת זוג", child: "ילד/ה", parent: "הורה", other: "אחר" }[relation]}
                </strong>
              </div>
            )}
            <div className="wizard-summary-row">
              <span>הכנסה</span>
              <strong className={wantsIncome ? "text-success" : ""}>
                {wantsIncome ? `${formatCurrency(amount)} לחודש` : hasIncome === "no" ? "אין" : "—"}
              </strong>
            </div>
          </>
        }
      />
    </Modal>
  );
}
