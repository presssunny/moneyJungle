export const LOAN_TYPE_OPTIONS = [
  { value: "bank", label: "הלוואה בנקאית" },
  { value: "mortgage", label: "משכנתא" },
  { value: "car", label: "הלוואת רכב" },
  { value: "credit", label: "הלוואה מחברת כרטיס אשראי" },
  { value: "private", label: "הלוואה פרטית" },
  { value: "other", label: "אחר" },
];

export const loanTypeLabel = (type: string) => LOAN_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
