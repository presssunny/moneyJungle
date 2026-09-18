export interface Commitment {
  key: string;
  date: string;
  name: string;
  amount: number | null;
  kind: string;
  fingerprint: string;
  decision: string | null;
  note: string | null;
  to: string;
}

export interface ReviewItem {
  key: string;
  title: string;
  to: string;
  blocking: boolean;
  fingerprint: string;
}
