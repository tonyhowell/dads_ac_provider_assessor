// SPEC §3.5: prices must be all-inclusive, with no separate travel, admin, package-management or exit fees.
// Flag any provider text that mentions them so the family asks at interview.

const FEE_PATTERN = /\b(travel (?:charges?|fees?|costs?)|travel extra|extra travel|admin(?:istration)? fees?|\d+%\s*admin|package[- ]management fees?|exit fees?|establishment fees?)\b/i;

export function mentionsDisallowedFees(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => !!t && FEE_PATTERN.test(t));
}

export const FEE_FLAG_TEXT =
  'Mentions travel or admin fees. Support at Home prices must be all-inclusive, so ask about this at interview.';
