import type { AppState } from './state/reducer';

// Family decisions (improvement plan, package 3): the vote on who to interview, and scores combined across
// members, with the applicant's scores counting twice.

export interface VoteResult {
  /** Provider ids, most votes first; ties broken by the applicant's picks, then by shortlist order. */
  ranked: { providerId: string; votes: number; applicantPicked: boolean }[];
  /** The top three, to interview. */
  chosen: string[];
}

export function voteResult(state: AppState, shortlist: string[]): VoteResult {
  const applicant = state.gather.applicantUserId;
  const applicantPicks = new Set(applicant ? (state.select.votes[applicant]?.picks ?? []) : []);
  const counts = new Map(shortlist.map((id) => [id, 0]));
  for (const v of Object.values(state.select.votes)) for (const id of v.picks) if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
  const ranked = shortlist
    .map((providerId, order) => ({ providerId, votes: counts.get(providerId)!, applicantPicked: applicantPicks.has(providerId), order }))
    .sort((a, b) => b.votes - a.votes || Number(b.applicantPicked) - Number(a.applicantPicked) || a.order - b.order)
    .map(({ order: _o, ...r }) => r);
  return { ranked, chosen: ranked.filter((r) => r.votes > 0).slice(0, 3).map((r) => r.providerId) };
}

/** Members who vote and score: coordinators, contributors and the applicant. */
export const isVoter = (m: { user_id: string; role: string }, applicantUserId: string | null) => m.role !== 'viewer' || m.user_id === applicantUserId;

export interface Combined {
  /** Combined 1–5 score by `${providerId}::${criterion}`, one decimal. */
  scores: Record<string, number>;
  /** Keys where members differ by 2 or more points. */
  differences: Record<string, { low: number; high: number }>;
  /** How many members' scores went in. */
  members: number;
}

/** Each member's scores averaged, with the applicant's counting twice. */
export function combinedScores(state: AppState): Combined {
  const sums = new Map<string, { total: number; weight: number; low: number; high: number }>();
  const entries = Object.entries(state.select.memberScores);
  for (const [userId, member] of entries) {
    const w = userId === state.gather.applicantUserId ? 2 : 1;
    for (const [key, score] of Object.entries(member.scores)) {
      const s = sums.get(key) ?? { total: 0, weight: 0, low: 5, high: 1 };
      s.total += score * w;
      s.weight += w;
      s.low = Math.min(s.low, score);
      s.high = Math.max(s.high, score);
      sums.set(key, s);
    }
  }
  const scores: Record<string, number> = {};
  const differences: Record<string, { low: number; high: number }> = {};
  for (const [key, s] of sums) {
    scores[key] = Math.round((s.total / s.weight) * 10) / 10;
    if (s.high - s.low >= 2) differences[key] = { low: s.low, high: s.high };
  }
  return { scores, differences, members: entries.filter(([, m]) => Object.keys(m.scores).length > 0).length };
}
