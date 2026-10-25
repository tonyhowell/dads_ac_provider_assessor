import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../state/AppContext';
import { providersFromCsv } from '../csv';
import { RATE_KEYS } from '../schemas';

const EXAMPLE = `provider,type,outlet,rn,en,pc,domestic,social,respite,gardening,care_mgmt,prices_as_at,source_url,veteran_fit,flags
Example Home Care,Private company,Brisbane Bayside,180,150,110,108,108,108,115,140,1 Oct 2026,https://example.org/prices,Unknown,30-min minimum; ask about weekends`;

export function ProviderImportScreen() {
  const { providers, dispatch } = useApp();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const result = text.trim() ? providersFromCsv(text, providers) : null;
  const good = result?.rows.filter((r) => r.provider) ?? [];
  const bad = result?.rows.filter((r) => !r.provider) ?? [];

  const readFile = async (file: File | undefined) => {
    if (file) setText(await file.text());
  };

  return (
    <section className="space-y-4">
      <Link to="/providers" className="muted">
        ← All providers
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Import providers from CSV</h1>
        <p className="muted mt-1">
          Add providers or update prices in bulk, for example from a spreadsheet of My Aged Care listings. Rows that match an existing provider by name
          update it.
        </p>
      </div>

      <div className="card space-y-3">
        <div>
          <label htmlFor="csv-file" className="muted block">
            Choose a CSV file
          </label>
          <input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} />
        </div>
        <div>
          <label htmlFor="csv-text" className="muted block">
            Or paste CSV
          </label>
          <textarea id="csv-text" className="input min-h-40 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} />
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer">Columns</summary>
          <p className="mt-2">
            <code>provider</code> is required. Optional: <code>type</code>, <code>outlet</code>, the hourly rates ({RATE_KEYS.map((k) => <code key={k}>{k} </code>)}),{' '}
            <code>prices_as_at</code>, <code>source_url</code>, <code>veteran_fit</code> and <code>flags</code> (separate several with semicolons). A blank rate
            means not published.
          </p>
        </details>
      </div>

      {result && (
        <section className="card space-y-3" aria-labelledby="preview-heading">
          <h2 id="preview-heading" className="font-semibold">
            Preview
          </h2>
          {result.unknownColumns.length > 0 && <p className="muted text-sm">Ignored columns: {result.unknownColumns.join(', ')}</p>}
          {good.length > 0 && (
            <ul className="space-y-1 text-sm">
              {good.map((r) => (
                <li key={r.line}>
                  <span className="rounded bg-slate-100 px-1.5 text-xs dark:bg-slate-800">{r.updates ? 'Update' : 'New'}</span> {r.provider!.provider}
                  <span className="muted"> · {RATE_KEYS.filter((k) => r.provider![k] !== null).length} rates · prices as at {r.provider!.prices_as_at}</span>
                </li>
              ))}
            </ul>
          )}
          {bad.length > 0 && (
            <ul className="space-y-1 text-sm text-red-700 dark:text-red-300" aria-label="Rows that can't be imported">
              {bad.map((r) => (
                <li key={r.line}>
                  Line {r.line}: {r.errors.join(' ')}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={good.length === 0}
            onClick={() => {
              dispatch({ type: 'provider/import', providers: good.map((r) => r.provider!) });
              navigate('/providers');
            }}
          >
            Import {good.length} provider{good.length === 1 ? '' : 's'}
            {bad.length > 0 && ` (skip ${bad.length})`}
          </button>
        </section>
      )}
    </section>
  );
}
