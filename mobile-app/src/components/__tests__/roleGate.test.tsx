import { describe, it, expect, afterEach, jest } from '@jest/globals';
/**
 * RBAC regression: a role outside the screen's allow-list must get the
 * Access Denied fallback instead of the screen, and an allowed role must see
 * the screen. Mirrors the RoleGate wiring in DashboardRouter (MA-only,
 * payroll, leave management, ...).
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { RoleGate } from '../RoleGate';
import { ThemeProvider } from '../../context/ThemeContext';
import type { UserRole } from '../../types/user';

let mockUser: { role: UserRole } | null = { role: 'employee' };

jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

const mounted: renderer.ReactTestRenderer[] = [];

const renderGate = async (allowedRoles: UserRole[], child: React.ReactElement) => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(
      <ThemeProvider>
        <RoleGate allowedRoles={allowedRoles}>{child}</RoleGate>
      </ThemeProvider>
    );
  });
  mounted.push(tree!);
  return tree!;
};

const textsOf = (tree: renderer.ReactTestRenderer): string[] =>
  tree.root.findAllByType(Text).map((n) => String(n.props.children ?? '')).filter(Boolean);

afterEach(() => {
  for (const tree of mounted.splice(0)) {
    try { act(() => tree.unmount()); } catch { /* ignore */ }
  }
  mockUser = { role: 'employee' };
});

describe('RoleGate', () => {
  it('blocks an employee from a master-admin-only screen', async () => {
    mockUser = { role: 'employee' };
    const tree = await renderGate(['master-admin'], <Text>Support Tickets</Text>);
    const texts = textsOf(tree);
    expect(texts).toContain('Access Denied');
    expect(texts).not.toContain('Support Tickets');
  });

  it('blocks an employee from payroll screens', async () => {
    mockUser = { role: 'employee' };
    const tree = await renderGate(['master-admin', 'executive', 'team-leader'], <Text>Run Payroll</Text>);
    expect(textsOf(tree)).toContain('Access Denied');
  });

  it('lets the allowed role through', async () => {
    mockUser = { role: 'master-admin' };
    const tree = await renderGate(['master-admin'], <Text>Support Tickets</Text>);
    const texts = textsOf(tree);
    expect(texts).toContain('Support Tickets');
    expect(texts).not.toContain('Access Denied');
  });

  it('renders a company admin into leave management', async () => {
    mockUser = { role: 'company-admin' };
    const tree = await renderGate(
      ['master-admin', 'company-admin', 'executive', 'reporting-manager', 'team-leader'],
      <Text>Leave Management</Text>
    );
    expect(textsOf(tree)).toContain('Leave Management');
  });

  it('treats a missing user as denied', async () => {
    mockUser = null;
    const tree = await renderGate(['master-admin'], <Text>Payroll History</Text>);
    expect(textsOf(tree)).toContain('Access Denied');
  });
});
