/** A single headline number with its label — used on the insights page. */

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
}

export default function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="card animate-fade-in-up px-5 py-4 transition-transform duration-200 hover:-translate-y-0.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-dim">{label}</p>
      <p className="mt-1 text-3xl font-bold gradient-text">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-dim">{hint}</p>}
    </div>
  );
}
