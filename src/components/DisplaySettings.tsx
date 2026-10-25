import { useEffect, useRef, useState } from 'react';
import { applyDisplay, loadDisplay, saveDisplay, type DisplaySettings } from '../display';
import { Icon } from './ui/Icon';

/** Header "Aa" button and panel (UI-SPEC §5.6). Changes apply straight away and are remembered on this device. */
export function DisplaySettingsButton() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<DisplaySettings>(loadDisplay);
  const ref = useRef<HTMLDivElement>(null);
  const update = (patch: Partial<DisplaySettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveDisplay(next);
    applyDisplay(next);
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="header-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <span aria-hidden className="font-semibold">
          Aa
        </span>{' '}
        Display
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Display settings"
          className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-4 rounded-[var(--radius-panel)] border border-[var(--rule)] bg-[var(--surface)] p-4 text-[var(--charcoal)] shadow-[var(--shadow-raised)]"
        >
          <fieldset>
            <legend className="label">Text size</legend>
            <div className="mt-1 grid grid-cols-4 gap-1">
              {([18, 20, 22, 24] as const).map((n, i) => (
                <button key={n} type="button" aria-pressed={s.textSize === n} className="btn flex-col gap-0 px-1" onClick={() => update({ textSize: n })}>
                  <span aria-hidden style={{ fontSize: `${n}px` }} className="font-semibold">
                    Aa
                  </span>
                  <span className="text-[0.8rem]">{['Standard', 'Large', 'Larger', 'Largest'][i]}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <Segmented
            legend="Theme"
            value={s.theme}
            options={[
              ['light', 'Light'],
              ['dark', 'Dark'],
              ['system', 'Match device'],
            ]}
            onChange={(theme) => update({ theme })}
          />
          <Toggle label="High contrast" checked={s.highContrast} onChange={(highContrast) => update({ highContrast })} />
          <Segmented
            legend="Reduce motion"
            value={s.motion}
            options={[
              ['reduce', 'On'],
              ['full', 'Off'],
              ['system', 'Match device'],
            ]}
            onChange={(motion) => update({ motion })}
          />
          <Toggle label="Show all hints" checked={s.hints} onChange={(hints) => update({ hints })} />
          <button type="button" className="btn w-full" onClick={() => setOpen(false)}>
            <Icon name="check" size={20} /> Done
          </button>
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="label">{legend}</legend>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {options.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={value === v} className="btn px-1" onClick={() => onChange(v)}>
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** A switch: settings that take effect immediately (UI-SPEC §6.3). */
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="btn w-full justify-between" onClick={() => onChange(!checked)}>
      <span>{label}</span>
      <span className="font-semibold">{checked ? 'On' : 'Off'}</span>
    </button>
  );
}
