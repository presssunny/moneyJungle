import type { DuplicateCandidate, DuplicateRecord } from "../../types/householdAssistant.types";
import { fingerprint } from "../journey/journey.utils";

export interface ScanRecord extends DuplicateRecord {
  manual: boolean;
  cardEligible: boolean;
}

function normalizedName(name: string): string {
  return name.normalize("NFKC").replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("he-IL");
}

// These are review candidates, never deletion instructions or certified duplicates.
export function duplicateCandidates(rows: ScanRecord[]): DuplicateCandidate[] {
  const buckets = new Map<string, ScanRecord[]>();
  for (const row of rows) {
    const name = normalizedName(row.name);
    if (!name || row.amount <= 0 || !Number.isFinite(row.amount)) continue;
    const key = JSON.stringify([row.kind === "income" ? "income" : "spending", name, row.date, Math.round(row.amount * 100)]);
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  const found: DuplicateCandidate[] = [];
  for (const group of buckets.values()) {
    const scopes = new Map<string, ScanRecord[]>();
    for (const row of group) {
      const scope = `${row.kind}:${row.scope}`;
      scopes.set(scope, [...(scopes.get(scope) ?? []), row]);
    }
    for (const sameScope of scopes.values()) {
      if (sameScope.length > 1) found.push(candidate("same_entry", sameScope));
    }
    const manual = group.filter(r => r.kind === "expense" && r.manual && r.cardEligible);
    const credit = group.filter(r => r.kind === "credit");
    if (manual.length && credit.length) found.push(candidate("manual_and_card", [...manual, ...credit]));
  }
  return found.sort((a, b) => b.records[0].date.localeCompare(a.records[0].date) || a.id.localeCompare(b.id));
}

function candidate(reason: DuplicateCandidate["reason"], rows: ScanRecord[]): DuplicateCandidate {
  const sorted = [...rows].sort((a, b) => a.key.localeCompare(b.key));
  return {
    id: `duplicate:${fingerprint([reason, sorted.map(r => r.key)]).slice(0, 24)}`,
    reason,
    recordCount: rows.length,
    records: sorted.slice(0, 20).map(({ manual: _manual, cardEligible: _eligible, ...record }) => record),
  };
}
