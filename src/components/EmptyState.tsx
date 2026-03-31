import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  headline: string;
  subtext?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, headline, subtext, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 text-center gap-3">
      <div style={{ color: "var(--color-bt-text-dim)", opacity: 0.5 }}>
        {icon}
      </div>
      <div className="flex flex-col gap-1">
        <p style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--color-bt-text-dim)" }}>
          {headline}
        </p>
        {subtext && (
          <p style={{ fontSize: "0.8125rem", color: "var(--color-bt-text-dim)", opacity: 0.7 }}>
            {subtext}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
