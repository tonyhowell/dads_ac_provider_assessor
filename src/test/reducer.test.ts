import { describe, expect, it } from 'vitest';
import { effectiveProviders, emptyState, entriesAt, initialState, legacyProviderEdits, migrate, reducer, withSpecialRates, type AppState } from '../state/reducer';
import type { Interview, Provider } from '../types';

const provider = (id: string, name: string): Provider => ({
  id, provider: name, type: null, outlet: null,
  rn: null, en: null, pc: null, domestic: null, social: null, respite: null, gardening: null, care_mgmt: null,
  prices_as_at: '2026-10-25', prices_as_at_date: '2026-10-25', veteran_fit: null, flags: [], source_url: null,
});
const providers = [provider('a', 'Alpha Care'), provider('b', 'Beta Care'), provider('c', 'Gamma Care')];
const empty = (): AppState => emptyState();
const AT = '2026-10-25T00:00:00.000Z';

describe('initialState', () => {
  it('seeds the interview stage from shortlist.json by provider name, in rank order', () => {
    const s = initialState(
      [
        { rank: 2, provider: 'Alpha Care', why: 'local', watch: 'turnover' },
        { rank: 1, provider: 'gamma care', why: 'veterans', watch: '' },
        { rank: 3, provider: 'Unknown Co', why: '', watch: '' },
      ],
      providers,
      AT,
    );
    expect(s.selection.map((e) => [e.provider_id, e.stage])).toEqual([['c', 'interview'], ['a', 'interview']]);
    expect(s.selection[1].why).toBe('local');
  });
});

describe('migrate', () => {
  it('turns a saved v1 shortlist into the interview stage', () => {
    const v1 = {
      version: 1,
      notes: [],
      interviews: [],
      shortlist: [{ provider_id: 'a', why: 'local', watch: 'turnover', added_at: AT }],
    };
    expect(migrate(v1)).toEqual({
      ...emptyState(),
      selection: [{ provider_id: 'a', stage: 'interview', why: 'local', watch: 'turnover', added_at: AT, stage_changed_at: AT }],
    });
  });

  it('remaps placeholder provider ids and adds the later fields when upgrading v2 state', () => {
    const v2 = {
      version: 2,
      notes: [{ id: 'n1', provider_id: 'anglicare-sq', text: 'x', created_at: AT, source: 'manual' }],
      selection: [{ provider_id: 'bluecare', stage: 'scan', why: '', watch: '', added_at: AT, stage_changed_at: AT }],
      interviews: [{ ...{ id: 'i', started_at: AT, duration_seconds: 0, consent_confirmed: true, interviewer: '', audio_id: null, audio_mime: null, transcript: '', notes: null, notes_generated_at: null }, provider_id: 'right-at-home-bayside-south' }],
    };
    const v3 = migrate(v2)!;
    expect(v3.version).toBe(6);
    expect(v3.screenNotes).toEqual([]);
    expect(v3.answers).toEqual({});
    expect(v3.notes[0].provider_id).toBe('anglicare-southern-queensland');
    expect(v3.selection[0].provider_id).toBe('bluecare-unitingcare-qld');
    expect(v3.interviews[0].provider_id).toBe('right-at-home-brisbane-bayside-south');
  });

  it('turns v4 satisfactory flags into ratings when upgrading to v5', () => {
    const v4 = { ...emptyState(), version: 4, screenNotes: undefined, responses: { 'a::A1': { text: 'Yes, in writing', satisfactory: true }, 'a::A2': { text: '', satisfactory: false } } };
    const v5 = migrate(v4)!;
    expect(v5.version).toBe(6);
    expect(v5.screenNotes).toEqual([]);
    expect(v5.responses['a::A1']).toEqual({ text: 'Yes, in writing', rating: 'yes', in_writing: true });
    expect(v5.responses['a::A2']).toEqual({ text: '', rating: 'no', in_writing: false });
  });

  it('moves v5 provider edits out of the family state (for the server to put in the catalogue)', () => {
    const v5 = { ...emptyState(), version: 5, specialRates: undefined, providerEdits: [{ ...providers[0], rn: 150 }] };
    expect(legacyProviderEdits(v5)).toHaveLength(1);
    const v6 = migrate(v5)!;
    expect(v6).toMatchObject({ version: 6, specialRates: {} });
    expect('providerEdits' in v6).toBe(false);
  });

  it('keeps current state and ignores anything unknown', () => {
    const v2 = empty();
    expect(migrate(v2)).toBe(v2);
    expect(migrate(undefined)).toBeUndefined();
    expect(migrate({ version: 99 })).toBeUndefined();
  });
});

describe('notes', () => {
  it('adds, edits and deletes notes', () => {
    let s = reducer(empty(), {
      type: 'note/add',
      note: { id: 'n1', provider_id: 'a', text: 'Called them', created_at: AT, source: 'manual' },
    });
    s = reducer(s, { type: 'note/edit', id: 'n1', text: 'Called them twice', at: '2026-10-26T00:00:00.000Z' });
    expect(s.notes[0]).toMatchObject({ text: 'Called them twice', updated_at: '2026-10-26T00:00:00.000Z' });
    s = reducer(s, { type: 'note/delete', id: 'n1' });
    expect(s.notes).toEqual([]);
  });
});

describe('selection stages', () => {
  const ids = (s: AppState, stage: 'scan' | 'refine' | 'interview') => entriesAt(s, stage).map((e) => e.provider_id);
  const scanned = () => ['a', 'b', 'c'].reduce((s, id) => reducer(s, { type: 'selection/add', providerId: id, at: AT }), empty());
  const LATER = '2026-10-26T00:00:00.000Z';

  it('adds providers to the initial scan, once each', () => {
    const s = reducer(scanned(), { type: 'selection/add', providerId: 'a', at: AT });
    expect(ids(s, 'scan')).toEqual(['a', 'b', 'c']);
    expect(s.selection.every((e) => e.stage === 'scan')).toBe(true);
  });

  it('advances through refinement to the interview shortlist', () => {
    let s = reducer(scanned(), { type: 'selection/stage', providerId: 'b', stage: 'refine', at: LATER });
    s = reducer(s, { type: 'selection/stage', providerId: 'c', stage: 'refine', at: LATER });
    s = reducer(s, { type: 'selection/stage', providerId: 'c', stage: 'interview', at: LATER });
    expect(ids(s, 'scan')).toEqual(['a']);
    expect(ids(s, 'refine')).toEqual(['b']);
    expect(ids(s, 'interview')).toEqual(['c']);
    expect(s.selection.find((e) => e.provider_id === 'c')!.stage_changed_at).toBe(LATER);
  });

  it('puts a provider entering a stage at the bottom of it, including when moved back', () => {
    let s = scanned();
    for (const id of ['a', 'b']) s = reducer(s, { type: 'selection/stage', providerId: id, stage: 'refine', at: AT });
    s = reducer(s, { type: 'selection/stage', providerId: 'a', stage: 'scan', at: AT });
    expect(ids(s, 'scan')).toEqual(['c', 'a']);
    expect(ids(s, 'refine')).toEqual(['b']);
  });

  it('reorders within a stage only, clamping the target index', () => {
    let s = scanned();
    for (const id of ['a', 'b', 'c']) s = reducer(s, { type: 'selection/stage', providerId: id, stage: 'interview', at: AT });
    s = reducer(s, { type: 'selection/add', providerId: 'd', at: AT });
    s = reducer(s, { type: 'selection/move', providerId: 'c', toIndex: 0 });
    expect(ids(s, 'interview')).toEqual(['c', 'a', 'b']);
    s = reducer(s, { type: 'selection/move', providerId: 'c', toIndex: 99 });
    expect(ids(s, 'interview')).toEqual(['a', 'b', 'c']);
    expect(ids(s, 'scan')).toEqual(['d']);
  });

  it('updates notes and drops providers', () => {
    let s = reducer(scanned(), { type: 'selection/update', providerId: 'b', why: 'cheapest' });
    expect(s.selection[1]).toMatchObject({ why: 'cheapest', watch: '' });
    s = reducer(s, { type: 'selection/remove', providerId: 'b' });
    expect(ids(s, 'scan')).toEqual(['a', 'c']);
  });
});

describe('interviews', () => {
  const interview: Interview = {
    id: 'i1', provider_id: 'a', started_at: AT, duration_seconds: 600, consent_confirmed: true, interviewer: '',
    audio_id: 'i1', audio_mime: 'audio/webm', transcript: 'hello', notes: null, notes_generated_at: null,
  };
  const notes = { summary: 'Good', strengths: [], concerns: [], commitments: [], pricing_mentions: [], follow_up_questions: [] };

  it('saves, updates and attaches notes', () => {
    let s = reducer(empty(), { type: 'interview/save', interview });
    s = reducer(s, { type: 'interview/save', interview: { ...interview, transcript: 'edited' } });
    expect(s.interviews).toHaveLength(1);
    expect(s.interviews[0].transcript).toBe('edited');
    s = reducer(s, { type: 'interview/notes', id: 'i1', notes, at: AT });
    expect(s.interviews[0]).toMatchObject({ notes, notes_generated_at: AT });
  });

  it('keeps provider notes when an interview is deleted, but unlinks them', () => {
    let s = reducer(empty(), { type: 'interview/save', interview });
    s = reducer(s, {
      type: 'note/add',
      note: { id: 'n1', provider_id: 'a', text: 'from interview', created_at: AT, source: 'interview', interview_id: 'i1' },
    });
    s = reducer(s, { type: 'interview/delete', id: 'i1' });
    expect(s.interviews).toEqual([]);
    expect(s.notes[0].interview_id).toBeUndefined();
  });
});

describe('assessment state (v4)', () => {
  const base = empty;

  it('stores the participant, plan and service date', () => {
    const participant = { id: 'p', name: '', suburb: 'Example', postcode: '4000', pension_status: 'full_pensioner' as const, ind_rate: null, ev_rate: null, dva_card: 'none' as const, nwop: false, classification: '5', lifetime_contributions_paid: 0 };
    let s = reducer(base(), { type: 'participant/set', participant });
    s = reducer(s, { type: 'plan/set', plan: [{ service: 'Domestic', key: 'domestic', hours_per_week: 2, category: 'everyday' }] });
    s = reducer(s, { type: 'settings/serviceDate', date: '2026-09-30' });
    expect(s.participant).toEqual(participant);
    expect(s.plan).toHaveLength(1);
    expect(s.serviceDate).toBe('2026-09-30');
    expect(reducer(s, { type: 'plan/set', plan: null }).plan).toBeNull();
  });

  it('overlays catalogue edits on the starter pack and appends new providers', () => {
    const merged = effectiveProviders(providers, [{ ...providers[0], rn: 160 }, { ...providers[0], id: 'new-co', provider: 'New Co' }]);
    expect(merged.map((p) => p.id)).toEqual(['a', 'b', 'c', 'new-co']);
    expect(merged[0].rn).toBe(160);
  });

  it("records special rates for this application and costs them over the catalogue's prices", () => {
    let s = reducer(base(), { type: 'specialRate/set', providerId: 'a', rate: { rates: { domestic: 90 }, note: 'Veteran rate by email', recorded_at: 'x' } });
    const [a] = withSpecialRates(providers, s.specialRates);
    expect(a).toMatchObject({ domestic: 90, special_rates: ['domestic'] });
    expect(withSpecialRates(providers, s.specialRates)[1].special_rates).toBeUndefined();
    s = reducer(s, { type: 'specialRate/clear', providerId: 'a' });
    expect(s.specialRates).toEqual({});
  });

  it('records bounding answers, custom questions and responses', () => {
    let s = reducer(base(), { type: 'bounding/answer', questionId: 'B1.1', answer: { answer: 'Yes, classification 5', not_relevant: false } });
    s = reducer(s, { type: 'question/add', question: { id: 'cq1', section: 'C', text: 'Can we meet the workers first?' } });
    s = reducer(s, { type: 'response/set', providerId: 'a', questionId: 'cq1', text: 'Yes' });
    s = reducer(s, { type: 'response/set', providerId: 'a', questionId: 'cq1', rating: 'yes', in_writing: true });
    expect(s.responses['a::cq1']).toEqual({ text: 'Yes', rating: 'yes', in_writing: true });
    s = reducer(s, { type: 'response/set', providerId: 'a', questionId: 'cq1', rating: null });
    expect(s.responses['a::cq1'].rating).toBeNull();
    expect(s.answers['B1.1'].answer).toBe('Yes, classification 5');
    s = reducer(s, { type: 'question/delete', id: 'cq1' });
    expect(s.customQuestions).toEqual([]);
    expect(s.responses).toEqual({});
  });

  it('records scores, weights and decision notes', () => {
    let s = reducer(base(), { type: 'score/set', providerId: 'a', criterion: 'veteran', score: 4 });
    s = reducer(s, { type: 'weight/set', criterion: 'price', weight: 3 });
    s = reducer(s, { type: 'decision/set', text: 'Going with A' });
    expect(s.scores).toEqual({ 'a::veteran': 4 });
    expect(s.weights).toEqual({ price: 3 });
    expect(s.decisionNotes).toBe('Going with A');
    expect(reducer(s, { type: 'score/set', providerId: 'a', criterion: 'veteran', score: null }).scores).toEqual({});
  });
});
