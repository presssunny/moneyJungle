export interface DuplicateRecord {
  key: string;
  kind: "expense" | "credit" | "income";
  name: string;
  date: string;
  amount: number;
  to: string;
  scope: string;
  version: string;
}

export interface DuplicateCandidate {
  id: string;
  reason: "same_entry" | "manual_and_card";
  records: DuplicateRecord[];
  recordCount: number;
  version: string;
  reopened?: boolean;
}

export type DuplicateDecision = "separate" | "remove_manual" | "source_charge";
export interface DuplicateReviewView {
  id: string;
  candidateId: string;
  version: string;
  decision: DuplicateDecision;
  status: "active" | "stale" | "undone";
  createdAt: string;
  undoneAt: string | null;
  records: DuplicateRecord[];
  recordCount: number;
  removedKey: string | null;
  keptKey: string | null;
  canUndo: boolean;
  undoBlockedReason: string | null;
}
export interface DuplicateReviewResult {
  review: DuplicateReviewView;
  financialDomain: "expenses" | "incomes" | null;
}
export interface DuplicateReviewInput {
  requestId: string;
  candidateId: string;
  version: string;
  decision: DuplicateDecision;
  confirmed: true;
  removedKey?: string;
  keptKey?: string;
}

export interface AssistantAction {
  id: string;
  title: string;
  reason: string;
  to: string;
  priority: number;
  kind: "review" | "duplicate" | "payment" | "budget" | "goal";
}

export interface HouseholdSnapshot {
  version: string;
  generatedAt: string;
  month: string;
  hasActivity: boolean;
  totals: { incomeTotal: number; expenseTotal: number; creditTotal: number };
  allowance: { amount: number | null; state: string };
  blockers: string[];
  actions: AssistantAction[];
  actionCount: number;
  upcoming: { key: string; name: string; date: string; amount: number | null; to: string }[];
  duplicates: {
    from: string;
    to: string;
    scanned: number;
    limited: boolean;
    candidateCount: number;
    followUpCount?: number;
    candidates: DuplicateCandidate[];
  };
  aiAvailable: boolean;
}

export interface AssistantPlan {
  version: string;
  mode: "ai" | "rules" | "stale";
  actionIds: string[];
}
