import { LucideIcon } from 'lucide-react';

export function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: string;
}) {
  return (
    <div className="stat-card">
      <span className={`stat-icon ${tone}`}>
        <Icon size={19} />
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}
