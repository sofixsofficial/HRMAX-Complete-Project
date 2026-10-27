import { describe, it, expect, afterEach } from '@jest/globals';
/**
 * Component tests for the reference-style UI pieces.
 *
 * Rendered with react-test-renderer under the jest-expo preset (React Native
 * host components are mocked), so these assert on the tree the app actually
 * produces. Every tree is unmounted afterwards because BrandHomeHero starts a
 * 1s clock that would otherwise keep the worker alive.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

import { BrandHomeHero } from '../BrandHomeHero';
import { MonthAttendanceCalendar } from '../MonthAttendanceCalendar';
import { ThemeProvider } from '../../context/ThemeContext';

const mounted: renderer.ReactTestRenderer[] = [];

const renderTree = async (node: React.ReactElement): Promise<renderer.ReactTestRenderer> => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(node);
  });
  mounted.push(tree!);
  return tree!;
};

/** MonthAttendanceCalendar reads the theme, so it must render inside one. */
const withTheme = (node: React.ReactElement) => <ThemeProvider>{node}</ThemeProvider>;

const stat = (label: string, value: number, color: string) => ({
  label,
  value,
  icon: 'checkmark-circle-outline' as const,
  color,
});

afterEach(() => {
  for (const tree of mounted.splice(0)) {
    try {
      tree.unmount();
    } catch {
      /* already unmounted */
    }
  }
});

describe('BrandHomeHero', () => {
  it('renders greeting, name, designation and every stat', async () => {
    const tree = await renderTree(
      <BrandHomeHero
        name="Test Employee"
        subtitle="QA Test Engineer"
        stats={[
          stat('Present', 3, '#10b981'),
          stat('Absent', 1, '#ef4444'),
          stat('On Leave', 0, '#8b5cf6'),
          stat('Total', 4, '#3b82f6'),
        ]}
      />,
    );

    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('Test Employee');
    expect(json).toContain('QA Test Engineer');
    for (const label of ['Present', 'Absent', 'On Leave', 'Total']) {
      expect(json).toContain(label);
    }
    expect(json).toContain('"3"');
    expect(json).toContain('"4"');
  });

  it('renders a clean hero header even without stats', async () => {
    const tree = await renderTree(<BrandHomeHero name="A" />);
    const json = JSON.stringify(tree.toJSON());
    expect(tree.toJSON()).toBeTruthy();
    // the header owns branding and the bell — the hero must not duplicate them
    expect(json).not.toContain('HR MAX');
    expect(json).not.toContain('notifications-outline');
  });

  it('omits the stat row entirely when no stats are passed', async () => {
    const tree = await renderTree(<BrandHomeHero name="A" />);
    const json = JSON.stringify(tree.toJSON());
    expect(json).not.toContain('Present');
    expect(json).not.toContain('Total');
  });
});

describe('MonthAttendanceCalendar', () => {
  it('renders the month label and an honest empty state', async () => {
    const tree = await renderTree(withTheme(<MonthAttendanceCalendar records={[]} />));
    const json = JSON.stringify(tree.toJSON());
    const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    expect(json).toContain(month);
    // never invent attendance when there are no records
    expect(json).toContain('No attendance records this month');
    expect(json).toContain('Present');
    expect(json).toContain('Absent');
  });

  it('renders one cell per day of the current month plus weekday padding', async () => {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const lead = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
    const expectedCells = Math.ceil((lead + daysInMonth) / 7) * 7;

    const tree = await renderTree(withTheme(<MonthAttendanceCalendar records={[]} />));
    const json = JSON.stringify(tree.toJSON());
    // react-test-renderer emits a JSON tree, not HTML: the day is a child
    // string, e.g. {"children":["31"]}
    expect(json).toContain(`"${daysInMonth}"`);
    expect(json).toContain('"1"');
    expect(expectedCells % 7).toBe(0);
  });

  it('marks today and dims future days', async () => {
    const tree = await renderTree(withTheme(<MonthAttendanceCalendar records={[]} />));
    const json = JSON.stringify(tree.toJSON());
    expect(json).toContain('#FF6600'); // today's outline
    expect(json).toContain('#9ca3af'); // dimmed future days
  });
});
