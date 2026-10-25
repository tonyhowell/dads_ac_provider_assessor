import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Expander, MoreText } from '../components/ui/Expander';

describe('Expander', () => {
  it('shows the summary and hides the detail until opened', async () => {
    const user = userEvent.setup();
    render(
      <Expander title="Your care plan" summary="5 services · 8 hr a week">
        <p>Detail</p>
      </Expander>,
    );
    const button = screen.getByRole('button', { name: /Your care plan\s*5 services/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Detail')).not.toBeVisible();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Detail')).toBeVisible();
  });

  it('can start open', () => {
    render(
      <Expander title="A" defaultOpen>
        <p>Detail</p>
      </Expander>,
    );
    expect(screen.getByText('Detail')).toBeVisible();
  });
});

describe('MoreText', () => {
  it('shows the first sentence and the rest on request', async () => {
    const user = userEvent.setup();
    render(<MoreText text="The level on your approval letter. If you moved over from a Home Care Package, choose your package level." />);
    expect(screen.getByText(/If you moved over/)).not.toBeVisible();
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText(/If you moved over/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Less' })).toBeInTheDocument();
  });

  it('leaves short text alone', () => {
    render(<MoreText text="Four digits." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
