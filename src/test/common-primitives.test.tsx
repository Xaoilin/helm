import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MetricCard } from '../components/common/MetricCard';
import { StatusPill } from '../components/common/StatusPill';

describe('MetricCard', () => {
  it('shows the label, value, and note as a surface card by default', () => {
    const { container } = render(<MetricCard label="Open Work" value="4" note="Incomplete tasks." />);
    expect(screen.getByText('Open Work')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('Incomplete tasks.')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('card');
  });

  it('omits the note when none is given', () => {
    const { container } = render(<MetricCard label="Progress" value="50%" />);
    expect(container.firstElementChild?.children).toHaveLength(2);
  });

  it('renders the compact stat tile with label, value, and note', () => {
    const { container } = render(<MetricCard variant="stat" label="Events" value="12" note="content-free records" />);
    const tile = container.firstElementChild;
    expect(tile).toHaveClass('activity-stat');
    expect(tile?.querySelector('span')).toHaveTextContent('Events');
    expect(tile?.querySelector('strong')).toHaveTextContent('12');
    expect(tile?.querySelector('small')).toHaveTextContent('content-free records');
  });
});

describe('StatusPill', () => {
  it('shows the label in the given tone', () => {
    render(<StatusPill label="Active" tone={{ background: 'rgb(1, 2, 3)', color: 'rgb(4, 5, 6)', border: 'rgb(7, 8, 9)' }} />);
    const pill = screen.getByText('Active');
    expect(pill).toHaveStyle({ background: 'rgb(1, 2, 3)', color: 'rgb(4, 5, 6)', border: '1px solid rgb(7, 8, 9)' });
  });
});
