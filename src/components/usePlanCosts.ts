import { useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { benchmarkCard, contributionRates, planCost, type PlanCost } from '../calc';
import type { Provider } from '../types';

export interface ProviderCost {
  provider: Provider;
  cost: PlanCost;
}

/** Plan cost at the benchmark and at each given provider, for the participant's rates and budget. */
export function usePlanCosts(providers: Provider[]) {
  const { seed, state, plan, serviceDate } = useApp();
  return useMemo(() => {
    const participant = state.participant;
    const rates = contributionRates(participant, seed.contributions, serviceDate);
    const budget = seed.budgets.find((b) => b.classification === participant?.classification) ?? null;
    const bench = benchmarkCard(seed.benchmark);
    const benchmark = planCost(bench, bench, plan, rates, serviceDate, budget);
    const byProvider: ProviderCost[] = providers.map((p) => ({ provider: p, cost: planCost(p, bench, plan, rates, serviceDate, budget) }));
    return { rates, budget, benchmark, byProvider, participant };
  }, [seed, state.participant, plan, serviceDate, providers]);
}
