/**
 * Key-value persistence for app state. v1 uses localStorage; a SQLite or Supabase
 * adapter can replace it by implementing the same interface.
 */
export interface Storage {
  load<T>(key: string): T | undefined;
  save<T>(key: string, value: T): void;
  remove(key: string): void;
}

const PREFIX = 'sah-assessor:';

export class LocalStorageAdapter implements Storage {
  constructor(private store: globalThis.Storage = window.localStorage) {}

  load<T>(key: string): T | undefined {
    try {
      const raw = this.store.getItem(PREFIX + key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  save<T>(key: string, value: T): void {
    try {
      this.store.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Storage full or blocked (private window): keep working in memory.
    }
  }

  remove(key: string): void {
    try {
      this.store.removeItem(PREFIX + key);
    } catch {
      /* storage blocked */
    }
  }
}

export class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  load<T>(key: string): T | undefined {
    const raw = this.data.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }
  save<T>(key: string, value: T): void {
    this.data.set(key, JSON.stringify(value));
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}
