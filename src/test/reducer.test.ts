import { describe, expect, it } from 'vitest';
import { initialState, reducer, type AppState } from '../state/reducer';
import type { Interview, Provider } from '../types';

const provider = (id: string, name: string): Provider => ({
  id, provider: name, type: null, outlet: null,
  rn: null, en: null, pc: null, domestic: null, social: null, respite: null, gardening: null, care_mgmt: null,
  prices_as_at: '2026-10-25', veteran_fit: null, flags: [], source_url: null,
});
const providers = [provider('a', 'Alpha Care'), provider('b', 'Beta Care'), provider('c', 'Gamma Care')];
const empty = (): AppState => ({ version: 1, notes: [], shortlist: [], interviews: [] });
const AT = '2026-10-25T00:00:00.000Z';

describe('initialState', () => {
  it('seeds the shortlist from shortlist.json by provider name, in rank order', () => {
    const s = initialState(
      [
        { rank: 2, provider: 'Alpha Care', why: 'local', watch: 'turnover' },
        { rank: 1, provider: 'gamma care', why: 'veterans', watch: '' },
        { rank: 3, provider: 'Unknown Co', why: '', watch: '' },
      ],
      providers,
      AT,
    );
    expect(s.shortlist.map((e) => e.provider_id)).toEqual(['c', 'a']);
    expect(s.shortlist[1].why).toBe('local');
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

describe('shortlist', () => {
  const withThree = () =>
    ['a', 'b', 'c'].reduce((s, id) => reducer(s, { type: 'shortlist/add', providerId: id, at: AT }), empty());

  it('adds each provider once', () => {
    const s = reducer(withThree(), { type: 'shortlist/add', providerId: 'a', at: AT });
    expect(s.shortlist.map((e) => e.provider_id)).toEqual(['a', 'b', 'c']);
  });

  it('reorders and clamps the target index', () => {
    let s = reducer(withThree(), { type: 'shortlist/move', providerId: 'c', toIndex: 0 });
    expect(s.shortlist.map((e) => e.provider_id)).toEqual(['c', 'a', 'b']);
    s = reducer(s, { type: 'shortlist/move', providerId: 'c', toIndex: 99 });
    expect(s.shortlist.map((e) => e.provider_id)).toEqual(['a', 'b', 'c']);
  });

  it('updates notes and removes entries', () => {
    let s = reducer(withThree(), { type: 'shortlist/update', providerId: 'b', why: 'cheapest' });
    expect(s.shortlist[1]).toMatchObject({ why: 'cheapest', watch: '' });
    s = reducer(s, { type: 'shortlist/remove', providerId: 'b' });
    expect(s.shortlist.map((e) => e.provider_id)).toEqual(['a', 'c']);
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
