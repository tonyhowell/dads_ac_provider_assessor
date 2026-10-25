import { useId, type ReactNode } from 'react';
import { Icon } from './Icon';
import { MoreText } from './Expander';

/** Label above, hint below the label, control, then error (UI-SPEC §6.2). Pass the control as a render prop to wire ids. */
export function Field({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {hint &&
        (typeof hint === 'string' ? (
          <MoreText id={hintId} text={hint} className="hint" />
        ) : (
          <span id={hintId} className="hint">
            {hint}
          </span>
        ))}
      {children({ id, describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined, invalid: !!error })}
      {error && (
        <p id={errorId} className="field-error">
          <Icon name="octagon" size={20} /> {error}
        </p>
      )}
    </div>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
}

/**
 * Choice cards (UI-SPEC §6.3): full-width tappable cards with a radio, label and optional description.
 * Selected = 2px charcoal border + amber-tint fill + ✓.
 */
export function ChoiceCards<T extends string>({
  legend,
  hint,
  name,
  value,
  choices,
  onChange,
  columns = 1,
  legendHidden = false,
  disabled = false,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  name: string;
  value: T | null | undefined;
  choices: Choice<T>[];
  onChange: (v: T) => void;
  columns?: 1 | 2 | 3;
  legendHidden?: boolean;
  /** Read-only, e.g. for viewers. */
  disabled?: boolean;
}) {
  const hintId = useId();
  const grid = columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  return (
    <fieldset aria-describedby={hint ? hintId : undefined} disabled={disabled}>
      <legend className={legendHidden ? 'sr-only' : 'label'}>{legend}</legend>
      {hint &&
        (typeof hint === 'string' ? (
          <MoreText id={hintId} text={hint} className="hint" />
        ) : (
          <span id={hintId} className="hint">
            {hint}
          </span>
        ))}
      <div className={`mt-1 grid grid-cols-[minmax(0,1fr)] gap-2 ${grid}`}>
        {choices.map((c) => {
          const selected = value === c.value;
          return (
            <label
              key={c.value}
              className={`flex min-h-[var(--target-min)] cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3 ${
                selected ? 'border-2 border-[var(--charcoal)] bg-[var(--amber-tint)]' : 'border-[var(--line)] bg-[var(--surface)]'
              }`}
            >
              <input type="radio" name={name} className="mt-0.5" checked={selected} onChange={() => onChange(c.value)} />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="block font-medium">{c.label}</span>
                {c.description && <span className="block">{c.description}</span>}
              </span>
              {selected && <Icon name="check" size={22} />}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Several-answer version of choice cards: tappable cards with a checkbox each. `max` limits how many can
 * be chosen; the rest are disabled once it's reached.
 */
export function CheckCards({
  legend,
  hint,
  value,
  choices,
  onChange,
  columns = 2,
  max,
  disabled = false,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  value: string[];
  choices: Choice<string>[];
  onChange: (v: string[]) => void;
  columns?: 1 | 2 | 3;
  max?: number;
  disabled?: boolean;
}) {
  const hintId = useId();
  const grid = columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  const full = max !== undefined && value.length >= max;
  return (
    <fieldset aria-describedby={hint ? hintId : undefined} disabled={disabled}>
      <legend className="label">{legend}</legend>
      {hint &&
        (typeof hint === 'string' ? (
          <MoreText id={hintId} text={hint} className="hint" />
        ) : (
          <span id={hintId} className="hint">
            {hint}
          </span>
        ))}
      <div className={`mt-1 grid grid-cols-[minmax(0,1fr)] gap-2 ${grid}`}>
        {choices.map((c) => {
          const selected = value.includes(c.value);
          return (
            <label
              key={c.value}
              className={`flex min-h-[var(--target-min)] cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3 ${
                selected ? 'border-2 border-[var(--charcoal)] bg-[var(--amber-tint)]' : 'border-[var(--line)] bg-[var(--surface)]'
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={selected}
                disabled={!selected && full}
                onChange={() => onChange(selected ? value.filter((v) => v !== c.value) : [...value, c.value])}
              />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                <span className="block font-medium">{c.label}</span>
                {c.description && <span className="block">{c.description}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {max !== undefined && <p className="small mt-1">{full ? `You've chosen ${max}. Untick one to change.` : `Choose up to ${max}.`}</p>}
    </fieldset>
  );
}

/** "1 hr 15 min" */
export function hoursText(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return '0 min';
  const total = Math.round(h * 60);
  const hrs = Math.floor(total / 60);
  const min = total % 60;
  return [hrs ? `${hrs} hr` : '', min ? `${min} min` : ''].filter(Boolean).join(' ');
}

/** Hours with − / + steppers in quarter hours (15-minute claiming, UI-SPEC §6.2). */
export function HoursStepper({ id, value, onChange, label, describedBy, max = 80 }: { id?: string; value: number; onChange: (v: number) => void; label: string; describedBy?: string; max?: number }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(0, Math.round(v * 4) / 4)));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn w-12 px-0" onClick={() => set(value - 0.25)} aria-label={`Less ${label}`} disabled={value <= 0}>
        <Icon name="minus" size={20} />
      </button>
      <input
        id={id}
        className="input w-24 text-center tabular-nums"
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step={0.25}
        value={Number.isFinite(value) ? value : ''}
        aria-describedby={describedBy}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        onBlur={(e) => set(Number(e.target.value))}
      />
      <button type="button" className="btn w-12 px-0" onClick={() => set(value + 0.25)} aria-label={`More ${label}`}>
        <Icon name="plus" size={20} />
      </button>
      <span aria-live="polite" className="min-w-[6rem]">
        {hoursText(value)}
      </span>
    </div>
  );
}

const SCORE_WORDS = ['Poor', 'Weak', 'OK', 'Good', 'Excellent'];

/** Five labelled buttons, 1 Poor … 5 Excellent (UI-SPEC §6.11). Press the selected one again to clear. */
export function ScoreInput({ value, onChange, label, disabled = false }: { value: number | undefined; onChange: (v: number | null) => void; label: string; disabled?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {SCORE_WORDS.map((w, i) => {
        const n = i + 1;
        const on = value === n;
        return (
          <button
            key={n}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            className={`btn min-h-14 min-w-14 flex-col gap-0 px-2 leading-tight ${on ? 'btn-selected' : ''}`}
            onClick={() => onChange(on ? null : n)}
          >
            <span className="text-lg font-semibold">{n}</span>
            <span className="text-[0.875rem] font-normal">{w}</span>
          </button>
        );
      })}
    </div>
  );
}

export const scoreWord = (n: number) => SCORE_WORDS[n - 1];
