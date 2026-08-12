import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProvider } from './surfaceTestHarness';
import InventorySurface from '../surfaces/InventorySurface';
import type { InventoryItem, InventoryNeed } from '../types/domain';

const timestamp = '2026-08-03T04:00:00.000Z';

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: 'item-inserts',
    name: 'M3 heat-set inserts',
    category: 'fastener',
    subcategory: 'screws_fasteners',
    imageUrl: 'https://m.media-amazon.com/images/I/inserts.jpg',
    trackingMode: 'counted',
    quantity: 10,
    unit: 'pcs',
    lowStockThreshold: 20,
    dimensions: { length: 20, width: 10, unit: 'mm' },
    specifications: { thread: 'M3' },
    condition: 'new',
    location: 'Workshop drawer',
    tags: ['3d printing'],
    notes: '',
    projectCatalogKeys: ['fixture-orbit'],
    lastVerifiedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function need(overrides: Partial<InventoryNeed> = {}): InventoryNeed {
  return {
    id: 'need-inserts',
    name: 'M3 heat-set inserts',
    category: 'fastener',
    subcategory: 'screws_fasteners',
    imageUrl: 'https://m.media-amazon.com/images/I/inserts.jpg',
    linkedItemId: 'item-inserts',
    projectCatalogKey: 'fixture-orbit',
    requiredQuantity: 50,
    unit: 'pcs',
    dimensions: { length: 20, width: 10, unit: 'mm' },
    specifications: { thread: 'M3' },
    priority: 'high',
    status: 'needed',
    notes: 'For the next fixture run',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function seedProject() {
  localStorage.setItem('helm:projects', JSON.stringify([{
    id: 'project-orbit',
    catalogKey: 'fixture-orbit',
    name: 'Orbit Console',
    kind: 'hardware',
    summary: '',
    status: 'active',
    tags: [],
    isPinned: false,
    links: [],
    setupSteps: [],
    runRecipes: [],
    preview: { icon: 'OC', accentColor: '#6d70ff', backgroundColor: '#111827' },
    createdAt: timestamp,
    updatedAt: timestamp,
  }]));
}

describe('InventorySurface', () => {
  beforeEach(() => localStorage.clear());

  it('shows low stock, filters the catalogue, and atomically acquires a need', async () => {
    seedProject();
    localStorage.setItem('helm:inventoryItems', JSON.stringify([
      item({}),
      item({
        id: 'item-calipers',
        name: 'Digital calipers',
        category: 'tool',
        subcategory: 'measuring_tools',
        imageUrl: 'https://m.media-amazon.com/images/I/calipers.jpg',
        trackingMode: 'durable',
        quantity: 1,
        unit: 'item',
        lowStockThreshold: 0,
        projectCatalogKeys: [],
      }),
    ]));
    localStorage.setItem('helm:inventoryNeeds', JSON.stringify([need()]));

    await act(async () => { renderWithProvider(<InventorySurface />); });
    expect(await screen.findByRole('heading', { name: 'Know what you have before you buy.' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Digital calipers' })).toBeInTheDocument();
    const caliperPhoto = screen.getByRole('img', { name: 'Digital calipers product photo' });
    expect(caliperPhoto).toHaveAttribute('src', 'https://m.media-amazon.com/images/I/calipers.jpg');
    expect(document.querySelector('.inventory-low-badge')).toHaveTextContent('Low stock');
    expect(screen.getByRole('heading', { name: 'Digital calipers' }).closest('.inventory-card')).toHaveTextContent('20 mm × 10 mm');
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fasteners' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter inventory category'), { target: { value: 'tool' } });
    expect(screen.getByRole('heading', { name: 'Digital calipers' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'M3 heat-set inserts' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fasteners' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter inventory category'), { target: { value: 'all' } });

    fireEvent.error(caliperPhoto);
    expect(screen.queryByRole('img', { name: 'Digital calipers product photo' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Digital calipers' }).closest('.inventory-card')?.querySelector('.inventory-card-visual')).not.toHaveClass('has-photo');

    fireEvent.change(screen.getByPlaceholderText(/Search tools, stock/i), { target: { value: 'calipers' } });
    expect(screen.getByRole('heading', { name: 'Digital calipers' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'M3 heat-set inserts' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Search tools, stock/i), { target: { value: '20 mm' } });
    expect(screen.getByRole('heading', { name: 'Digital calipers' })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Search tools, stock/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter inventory project'), { target: { value: 'fixture-orbit' } });
    expect(screen.getByRole('heading', { name: 'M3 heat-set inserts' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Digital calipers' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Needed' }));
    fireEvent.change(screen.getByPlaceholderText(/Search tools, stock/i), { target: { value: '10 mm' } });
    expect(screen.getByRole('heading', { name: 'M3 heat-set inserts' })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Search tools, stock/i), { target: { value: '' } });
    const needCard = screen.getByRole('heading', { name: 'M3 heat-set inserts' }).closest('.inventory-card') as HTMLElement;
    fireEvent.click(within(needCard).getByRole('button', { name: 'Mark acquired' }));
    await waitFor(() => expect(within(needCard).getByText('acquired')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('tab', { name: 'Owned' }));
    const ownedCard = screen.getByRole('heading', { name: 'M3 heat-set inserts' }).closest('.inventory-card') as HTMLElement;
    expect(within(ownedCard).getByText('60 pcs')).toBeInTheDocument();
  });

  it('reviews pasted candidates, flags a duplicate, and saves only selected items', async () => {
    localStorage.setItem('helm:inventoryItems', JSON.stringify([
      item({
        id: 'item-calipers',
        name: 'Digital calipers',
        category: 'tool',
        subcategory: 'measuring_tools',
        quantity: 1,
        lowStockThreshold: 0,
      }),
    ]));
    await act(async () => { renderWithProvider(<InventorySurface />); });
    await screen.findByRole('heading', { name: 'Digital calipers' });

    fireEvent.click(screen.getByRole('button', { name: 'Paste and review' }));
    const dialog = screen.getByRole('dialog', { name: 'Paste and review' });
    fireEvent.change(within(dialog).getByPlaceholderText(/digital calipers/i), {
      target: { value: '2x Digital calipers\n100 M3 heat-set inserts' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review candidates' }));
    expect(within(dialog).getByText('Likely duplicate')).toBeInTheDocument();

    const rows = dialog.querySelectorAll('.inventory-review-row');
    fireEvent.click(within(rows[0] as HTMLElement).getByRole('checkbox', { name: 'Save' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save selected' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Paste and review' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'M3 heat-set inserts' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Digital calipers' })).toHaveLength(1);
  });

  it('dismisses Inventory dialogs with Escape', async () => {
    await act(async () => { renderWithProvider(<InventorySurface />); });
    fireEvent.click(screen.getByRole('button', { name: '+ Add owned item' }));
    expect(screen.getByRole('dialog', { name: 'Add owned item' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Add owned item' })).not.toBeInTheDocument();
  });

  it('accepts dimensions in the owned-item editor and displays partial values', async () => {
    await act(async () => { renderWithProvider(<InventorySurface />); });
    fireEvent.click(screen.getByRole('button', { name: '+ Add owned item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add owned item' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'Secretlab desk' } });
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Dimension length' }), { target: { value: '160' } });
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Dimension width' }), { target: { value: '80' } });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Dimension unit' }), { target: { value: 'cm' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Specifications' }), { target: { value: 'mounting: VESA\nthickness: 25 mm' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Secretlab desk' })).toBeInTheDocument());
    const card = screen.getByRole('heading', { name: 'Secretlab desk' }).closest('.inventory-card');
    expect(card).toHaveTextContent('160 cm × 80 cm');
  });
});
