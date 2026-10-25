import { api } from '../api';
import type { Action } from './actions';
import type { AppState } from './reducer';

export interface VersionedState {
  version: number;
  state: AppState;
}

/** How the app reads and changes the family's shared state. */
export interface StateSync {
  load(): Promise<VersionedState>;
  send(action: Action): Promise<VersionedState>;
}

export const httpSync: StateSync = {
  load: () => api<VersionedState>('/api/state'),
  send: (action) => api<VersionedState>('/api/actions', { body: { action } }),
};
