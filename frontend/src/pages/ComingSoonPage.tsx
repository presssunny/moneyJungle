import { EmptyState } from "../components/common/EmptyState";

export default function ComingSoonPage({ title }: { title: string }) {
  return (
    <EmptyState
      icon="🚧"
      title={`${title} — בקרוב`}
      hint="העמוד הזה שייך לשלב הבא של הפרויקט ויופעל בהמשך"
    />
  );
}
