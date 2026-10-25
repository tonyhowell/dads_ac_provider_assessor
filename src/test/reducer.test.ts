import { describe, expect, it } from 'vitest';
import { entriesAt, initialState, migrate, reducer, type AppState } from '../state/reducer';
import type { Interview, Provider } from '../types';

const provider = (id: string, name: string): Provider => ({
  id, provider: name, type: null, outlet: null,
  rn: null, en: null, pc: null, domestic: null, social: null, respite: null, gardening: null, care_mgmt: null,
  prices_as_at: '2026-10-25', veteran_fit: null, flags: [], source_url: null,
});
const providers = [provider('a', 'Alpha Care'), provider('b', 'Beta Care'), provider('c', 'Gamma Care')];
const empty = (): AppState => ({ version: 2, notes: [], selection: [], interviews: [] });
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
      version: 2,
      notes: [],
      interviews: [],
      selection: [{ provider_id: 'a', stage: 'interview', why: 'local', watch: 'turnover', added_at: AT, stage_changed_at: AT }],
    });
  });

  it('keeps v2 state and ignores anything unknown', () => {
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
