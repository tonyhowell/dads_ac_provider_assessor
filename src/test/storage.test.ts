import { describe, expect, it } from 'vitest';
import { LocalStorageAdapter } from '../storage/storage';
import { indexedDbAudioStore } from '../storage/audioStore';

describe('LocalStorageAdapter', () => {
  it('round-trips values under a namespaced key', () => {
    const s = new LocalStorageAdapter();
    s.save('state', { a: 1 });
    expect(s.load('state')).toEqual({ a: 1 });
    expect(localStorage.getItem('sah-assessor:state')).toBe('{"a":1}');
    s.remove('state');
    expect(s.load('state')).toBeUndefined();
  });

  it('treats corrupt JSON as missing', () => {
    localStorage.setItem('sah-assessor:state', '{not json');
    expect(new LocalStorageAdapter().load('state')).toBeUndefined();
  });
});

describe('indexedDbAudioStore', () => {
  it('stores, reads and deletes recordings', async () => {
    const blob = new Blob(['audio-bytes'], { type: 'audio/webm' });
    await indexedDbAudioStore.put('rec-1', blob);
    const back = await indexedDbAudioStore.get('rec-1');
    expect(back).toBeDefined();
    expect(back!.size).toBe(blob.size);
    await indexedDbAudioStore.delete('rec-1');
    expect(await indexedDbAudioStore.get('rec-1')).toBeUndefined();
  });
});
