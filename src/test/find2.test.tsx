import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { gathered, memoryBackend, memoryServer, renderApp } from './renderApp';
import type { AppState } from '../state/reducer';

const AT = '2026-11-01T00:00:00.000Z';
const shortlisted = (...ids: string[]): Partial<AppState> => ({
  selection: ids.map((provider_id) => ({ provider_id, stage: 'scan' as const, why: '', watch: '', added_at: AT, stage_changed_at: AT })),
});

describe('Find: shortlisting', () => {
  it('shows progress toward the target, and the target can change', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/providers', { server: memoryServer(gathered(shortlisted('bolton-clarke', 'anglicare-southern-queensland'))) });
    expect(screen.getByText(/shortlisted$/).textContent).toBe('2 of 5 shortlisted');
    await user.selectOptions(screen.getByLabelText('Aim for'), '2');
    await waitFor(() => expect(server.state.find.target).toBe(2));
    expect(screen.getByText('Target reached')).toBeInTheDocument();
  });

  it('records quick reasons when shortlisting, carried into the comparison', async () => {
    const user = userEvent.setup();
    const { server } = await renderApp('/providers', { server: memoryServer(gathered(shortlisted('bolton-clarke'))) });
    const card = screen.getByRole('article', { name: 'Bolton Clarke' });
    const reasons = within(card).getByRole('group', { name: 'Why shortlist them?' });
    await user.click(within(reasons).getByRole('button', { name: 'The same workers' }));
    await user.click(within(reasons).getByRole('button', { name: 'Local' }));
    await waitFor(() => expect(server.state.selection[0].why).toBe('The same workers, Local'));
    await user.click(within(reasons).getByRole('button', { name: /The same workers/ }));
    await waitFor(() => expect(server.state.selection[0].why).toBe('Local'));
  });

  it('lets family react, and shows reactions and reasons side by side', async () => {
    const user = userEvent.setup();
    const server = memoryServer(gathered(shortlisted('bolton-clarke', 'anglicare-southern-queensland')));
    await renderApp('/providers/bolton-clarke', { server });
    const box = screen.getByRole('region', { name: 'What we know about Bolton Clarke' });
    await user.type(within(box).getByLabelText('Your comment (optional)'), 'Lovely on the phone');
    await user.click(within(box).getByRole('button', { name: /Thumbs up/ }));
    await waitFor(() => expect(server.state.find.reactions['bolton-clarke']).toMatchObject([{ value: 'up', comment: 'Lovely on the phone' }]));
    expect(within(box).getByText(/1 up, 0 down/)).toBeInTheDocument();

    // A note from a phone call.
    await user.click(within(box).getByRole('button', { name: /I rang them/ }));
    await user.type(within(box).getByLabelText('Who you spoke to'), 'Priya, intake');
    await user.type(within(box).getByLabelText('What they said'), 'They have a veterans team.');
    await user.type(within(box).getByLabelText('Availability'), 'Can start in two weeks');
    await user.click(within(box).getByRole('button', { name: 'Save call note' }));
    await waitFor(() => expect(server.state.notes[0]).toMatchObject({ source: 'call', text: 'Phone call with Priya, intake.\nThey have a veterans team.\nAvailability: Can start in two weeks' }));
  });

  it('compares reasons and reactions on the shortlist', async () => {
    const state = gathered(shortlisted('bolton-clarke', 'anglicare-southern-queensland'));
    state.selection[0].why = 'The same workers';
    state.find.reactions['bolton-clarke'] = [{ user_id: 'u2', name: 'Sam', value: 'up', comment: 'Felt right', at: AT }];
    await renderApp('/compare', { server: memoryServer(state) });
    const table = screen.getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Why shortlisted' }).parentElement).toHaveTextContent('The same workers');
    expect(within(table).getByRole('rowheader', { name: 'Family reactions' }).parentElement).toHaveTextContent('Up · Sam: “Felt right”');
  });
});

describe('Find: insight tabs', () => {
  it("shows what you'd pay, the quality record, and answers to questions", async () => {
    const user = userEvent.setup();
    const server = memoryServer(gathered());
    const backend = memoryBackend(server);
    backend.complianceRows = [
      {
        provider_id: 'bolton-clarke',
        status: 'ready',
        error: null,
        started_at: AT,
        finished_at: AT,
        result: {
          summary: 'One notice of non-compliance in 2025.',
          none_found: false,
          checked_pages: 3,
          findings: [{ kind: 'non_compliance', date: 'March 2025', text: 'Care planning', source_url: 'https://www.agedcarequality.gov.au/x', source_title: 'Notice' }],
        },
      },
    ];
    await renderApp('/providers?p=bolton-clarke', { server, backend });
    expect(screen.getByText('1 compliance finding from the Quality and Safety Commission')).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: 'Bolton Clarke' });
    await user.click(within(panel).getByRole('tab', { name: 'Cost' }));
    expect(within(panel).getByText(/Your contribution:/).parentElement).toHaveTextContent(/about \$\d/);
    await user.click(within(panel).getByRole('tab', { name: 'Quality 1' }));
    expect(within(panel).getByText('Non-compliance')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Notice/ })).toHaveAttribute('href', 'https://www.agedcarequality.gov.au/x');
    await user.click(within(panel).getByRole('tab', { name: 'Ask' }));
    await user.type(within(panel).getByLabelText('Your question'), 'Do they offer weekend visits?');
    await user.click(within(panel).getByRole('button', { name: 'Ask Claude' }));
    expect(await within(panel).findByText('They offer weekend visits at a higher rate.')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Price list/ })).toHaveAttribute('href', 'https://example.org/prices');
  });
});
