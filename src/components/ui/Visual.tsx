import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import type { Status } from './Status';

/** A big figure with a label: the visual summary at the top of a screen or card. */
export function StatTile({ label, value, sub, icon, status, highlight = false }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: IconName; status?: Status; highlight?: boolean }) {
  return (
    <div className={`rounded-[var(--radius-panel)] border p-3 ${highlight ? 'border-2 border-[var(--charcoal)] bg-[var(--amber-tint)]' : 'border-[var(--rule)] bg-[var(--surface)]'}`}>
      <p className="flex items-center gap-1.5 text-[0.95rem]">
        {icon && <Icon name={icon} size={18} className={status ? `status-${status}` : ''} />}
        {label}
      </p>
      <p className={`text-[1.6rem] font-semibold leading-tight tabular-nums ${status ? `status-${status}` : ''}`}>{value}</p>
      {sub && <p className="text-[0.95rem]">{sub}</p>}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">{children}</div>;
}

/** A horizontal bar filled to `value` of `max`, with an accessible label. */
export function Meter({ value, max, label, tone = 'charcoal', className = '' }: { value: number; max: number; /** Omit when the same words are already beside it. */ label?: string; tone?: 'charcoal' | 'amber' | 'good' | 'caution' | 'stop'; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const colour = tone === 'charcoal' ? 'var(--charcoal)' : tone === 'amber' ? 'var(--amber)' : `var(--${tone})`;
  return (
    <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={`relative block h-3 w-full overflow-hidden rounded-full border border-[var(--line)] bg-[var(--sunken)] ${className}`}>
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: colour }} />
    </span>
  );
}

/** A ring showing a share, e.g. "you pay 40%". */
export function ShareRing({ share, size = 56, label }: { share: number; size?: number; label: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" role="img" aria-label={label} className="shrink-0">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
      {share > 0 && (
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--charcoal)" strokeWidth="8" strokeDasharray={`${c * Math.min(1, share)} ${c}`} transform="rotate(-90 28 28)" />
      )}
      <text x="28" y="32" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--charcoal)">
        {Math.round(share * 100)}%
      </text>
    </svg>
  );
}

/**
 * Where a price sits against the guide price: a short scale from 30% below to 30% above with the guide in the middle.
 * The words beside it carry the meaning; the scale is a quick visual.
 */
export function GuideScale({ rate, guide, label }: { rate: number; guide: number; /** Omit when the words beside it say the same. */ label?: string }) {
  const v = guide > 0 ? (rate - guide) / guide : 0;
  const pos = 50 + Math.max(-1, Math.min(1, v / 0.3)) * 50;
  const tone = v > 0.05 ? 'var(--stop)' : v < -0.05 ? 'var(--good)' : 'var(--charcoal)';
  return (
    <span role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className="relative block h-4 w-28 shrink-0">
      <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-[var(--line)]" />
      <span className="absolute top-0 left-1/2 h-4 w-0.5 -translate-x-1/2 bg-[var(--grey)]" />
      <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)]" style={{ left: `${pos}%`, background: tone }} />
    </span>
  );
}
