import { api } from './api';
import type { Action } from './state/actions';
import type { VersionedState, StateSync } from './state/sync';
import type { Claims, Provider } from './types';

// Everything the browser asks of the server, in one place, so tests can stand in a memory version.

export type MemberRole = 'coordinator' | 'contributor' | 'viewer';
export type ApplicationStatus = 'active' | 'decided' | 'archived';

export interface ApplicationInfo {
  id: string;
  name: string;
  suburb: string;
  postcode: string;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
}

export interface ApplicationSummary extends ApplicationInfo {
  role: MemberRole;
  last_activity: string;
  members: number;
}

export interface Member {
  user_id: string;
  username: string;
  display_name: string;
  role: MemberRole;
  enrolled: boolean;
  enrolment_expires_at: string | null;
  disabled: boolean;
  added_at: string;
}

export interface Suggestion {
  id: string;
  provider_id: string;
  is_new: boolean;
  current: Provider | null;
  proposed: Provider;
  note: string;
  application_id: string | null;
  application_name: string | null;
  suggested_by: string | null;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decision_note: string;
  decided_at: string | null;
  created_at: string;
}

export interface Catalogue {
  /** Corrections and additions over the starter pack. */
  providers: Provider[];
  updated_at: string | null;
}

export interface ClaimsRow {
  provider_id: string;
  status: 'running' | 'ready' | 'failed';
  claims: Claims | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface PriceCheckRow {
  provider_id: string;
  status: 'running' | 'done' | 'failed';
  stage: string | null;
  outcome: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Backend {
  listApplications(): Promise<ApplicationSummary[]>;
  getApplication(id: string): Promise<{ application: ApplicationInfo; role: MemberRole }>;
  sync(applicationId: string): StateSync;
  catalogue(): Promise<Catalogue>;
  /** Site admins: change the common catalogue. */
  saveProvider(provider: Provider): Promise<Catalogue>;
  importProviders(providers: Provider[]): Promise<Catalogue>;
  revertProvider(id: string): Promise<Catalogue>;
  /** Contributors: suggest a correction or a new provider for an admin to review. */
  suggest(applicationId: string, provider: Provider, note: string): Promise<Suggestion>;
  applicationSuggestions(applicationId: string): Promise<Suggestion[]>;
  /** Claude drafts "what I'm looking for" from the application's saved answers; returns the saved state. */
  draftLookingFor(applicationId: string): Promise<VersionedState>;
  /** Cached public claims for every provider that has been researched. */
  listClaims(): Promise<{ claims: ClaimsRow[]; max_age_days: number }>;
  /** Starts researching a provider's public claims (runs in the background on the server). */
  startClaims(applicationId: string, providerId: string, refresh: boolean): Promise<ClaimsRow>;
  /** Price reads started by shortlisting (or by asking again). */
  listPriceChecks(): Promise<PriceCheckRow[]>;
  startPriceCheck(applicationId: string, providerId: string): Promise<PriceCheckRow>;
}

export const httpBackend: Backend = {
  listApplications: async () => (await api<{ applications: ApplicationSummary[] }>('/api/applications')).applications,
  getApplication: (id) => api(`/api/applications/${encodeURIComponent(id)}`),
  sync: (id) => ({
    load: () => api<VersionedState>(`/api/applications/${encodeURIComponent(id)}/state`),
    send: (action: Action) => api<VersionedState>(`/api/applications/${encodeURIComponent(id)}/actions`, { body: { action } }),
  }),
  catalogue: () => api<Catalogue>('/api/providers'),
  saveProvider: (provider) => api<Catalogue>(`/api/admin/providers/${encodeURIComponent(provider.id)}`, { method: 'PUT', body: { provider } }),
  importProviders: (providers) => api<Catalogue>('/api/admin/providers/import', { body: { providers } }),
  revertProvider: (id) => api<Catalogue>(`/api/admin/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  suggest: async (applicationId, provider, note) =>
    (await api<{ suggestion: Suggestion }>(`/api/applications/${encodeURIComponent(applicationId)}/suggestions`, { body: { provider, note } })).suggestion,
  applicationSuggestions: async (applicationId) => (await api<{ suggestions: Suggestion[] }>(`/api/applications/${encodeURIComponent(applicationId)}/suggestions`)).suggestions,
  draftLookingFor: (applicationId) => api<VersionedState>(`/api/applications/${encodeURIComponent(applicationId)}/looking-for/summary`, { method: 'POST' }),
  listClaims: () => api('/api/claims'),
  startClaims: async (applicationId, providerId, refresh) =>
    (await api<{ claims: ClaimsRow }>(`/api/applications/${encodeURIComponent(applicationId)}/claims/${encodeURIComponent(providerId)}`, { body: { refresh } })).claims,
  listPriceChecks: async () => (await api<{ checks: PriceCheckRow[] }>('/api/price-checks')).checks,
  startPriceCheck: async (applicationId, providerId) =>
    (await api<{ check: PriceCheckRow }>(`/api/applications/${encodeURIComponent(applicationId)}/prices/${encodeURIComponent(providerId)}`, { body: {} })).check,
};
