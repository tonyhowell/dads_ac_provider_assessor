import { useApp } from '../../state/AppContext';

/** Label and hint for a form field from data/help.json, so wording is reviewed in one place (UI-SPEC §5.8). */
export function useFieldHelp() {
  const { seed } = useApp();
  return (fieldId: string) => {
    const f = seed.help.fields.find((x) => x.field_id === fieldId);
    return { label: f?.label ?? fieldId, hint: f?.hint, explain: f?.explain };
  };
}
