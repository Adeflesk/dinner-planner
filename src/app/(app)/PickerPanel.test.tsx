// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { PickerOption } from '@/lib/services/planning';

// next/link wants app-router context a bare render cannot provide, and the
// action module would pull the whole DB layer into a DOM test. Neither is
// what these tests are about.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/app/actions/plan', () => ({ swapDayAction: '/stub-action' }));

const { PickLink, PickerPanel } = await import('./PickerPanel');

// This project doesn't run vitest with `globals`, so Testing Library's
// automatic cleanup never registers and renders would pile up in one document.
afterEach(cleanup);

const option = (over: Partial<PickerOption> = {}): PickerOption => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Chicken Katsu',
  cuisine: 'japanese',
  kcal: 712,
  favourite: true,
  plannedDay: null,
  ...over,
});

const panel = (over: Partial<Parameters<typeof PickerPanel>[0]> = {}) =>
  render(
    <PickerPanel
      day={2}
      week=""
      query=""
      dayLabel="Wednesday 15 July"
      options={[option()]}
      {...over}
    />,
  );

describe('PickLink', () => {
  it('links to the picker for its own day and anchors to the panel', () => {
    render(<PickLink day={4} week="" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/?pick=4#pick');
  });

  it('keeps the next-week context', () => {
    render(<PickLink day={4} week="next" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/?pick=4&week=next#pick');
  });
});

describe('PickerPanel', () => {
  it('names the day it is picking for', () => {
    panel();
    expect(screen.getByRole('heading').textContent).toContain('Wednesday 15 July');
  });

  it('shows each recipe with its cuisine and calories', () => {
    panel({ options: [option({ name: 'Beef Rendang', cuisine: 'indonesian', kcal: 690 })] });
    expect(screen.getByText('Beef Rendang')).toBeDefined();
    const row = screen.getByText('Beef Rendang').closest('li')!;
    expect(within(row).getByText(/indonesian/).textContent).toContain('690 kcal');
  });

  it('marks a recipe already planned this week but still offers it', () => {
    panel({ options: [option({ plannedDay: 1 })] });
    const row = screen.getByText('Chicken Katsu').closest('li')!;
    expect(row.textContent).toContain('already on Tue');
    expect(within(row).getByRole('button').textContent).toBe('Use');
  });

  it('distinguishes AI dinners from favourites', () => {
    panel({ options: [option({ favourite: false })] });
    expect(screen.getByText('Chicken Katsu').closest('li')!.textContent).toContain('from a past plan');
  });

  it('carries the day, week and recipe id so the action knows what to swap', () => {
    panel({ day: 5, week: 'next', options: [option({ id: '22222222-2222-4222-8222-222222222222' })] });
    const form = screen.getByText('Chicken Katsu').closest('li')!.querySelector('form')!;
    const value = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value;
    expect(value('day')).toBe('5');
    expect(value('week')).toBe('next');
    expect(value('mode')).toBe('pick');
    expect(value('recipeId')).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('explains an empty search rather than showing a blank box', () => {
    panel({ query: 'zzz', options: [] });
    expect(screen.getByText(/Nothing matches/).textContent).toContain('zzz');
  });

  it('points an empty library at the Recipes page instead', () => {
    panel({ query: '', options: [] });
    expect(screen.getByText(/No recipes yet/)).toBeDefined();
  });

  it('keeps the current search in the box and the week on the close link', () => {
    panel({ week: 'next', query: 'katsu' });
    expect(screen.getByRole('textbox').getAttribute('value')).toBe('katsu');
    expect(screen.getByText('close').getAttribute('href')).toBe('/?week=next');
  });
});
