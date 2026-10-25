import type { Participant, PlanItem, RateKey } from './types';

// SPEC §3.4: suggest funding services through DVA to preserve the Support at Home budget.
// These are prompts to check with DVA, never statements of eligibility.

export interface DvaPrompt {
  id: string;
  text: string;
}

const VHC_SERVICES: Partial<Record<RateKey, string>> = {
  domestic: 'domestic assistance',
  gardening: 'home and garden maintenance',
  pc: 'personal care',
  respite: 'respite',
};
const NURSING: RateKey[] = ['rn', 'en'];

export function dvaPrompts(participant: Pick<Participant, 'dva_card'> | null, plan: PlanItem[]): DvaPrompt[] {
  if (!participant || participant.dva_card === 'none') return [];
  const keys = new Set(plan.filter((i) => i.hours_per_week > 0).map((i) => i.key));
  const prompts: DvaPrompt[] = [];
  const card = participant.dva_card === 'gold' ? 'Gold Card' : 'White Card';

  const vhc = Object.entries(VHC_SERVICES)
    .filter(([k]) => keys.has(k as RateKey))
    .map(([, label]) => label);
  if (vhc.length) {
    prompts.push({
      id: 'vhc',
      text:
        participant.dva_card === 'gold'
          ? `Consider funding ${list(vhc)} through Veterans' Home Care to preserve the Support at Home budget. Confirm eligibility and hours with DVA.`
          : `White Card holders may get Veterans' Home Care (${list(vhc)}) for specific accepted conditions. Confirm with DVA whether it applies.`,
    });
  }
  if (NURSING.some((k) => keys.has(k))) {
    prompts.push({
      id: 'nursing',
      text: `DVA community nursing sits outside the Support at Home budget. Ask DVA and the GP whether the nursing in this plan could be funded on your ${card}.`,
    });
  }
  prompts.push({
    id: 'treatment',
    text: `${card} treatment (including Open Arms mental-health support) is funded separately and doesn't draw on the Support at Home budget.`,
  });
  return prompts;
}

const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
