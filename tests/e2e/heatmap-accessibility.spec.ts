import { test, expect } from '@playwright/test';
import { ObservabilityDashboardPage } from './pages/ObservabilityDashboardPage';

const HOT_NODE = 'ws-gpu-22';
const fleetNodeIds = [
  ...Array.from({ length: 31 }, (_, i) => `ws-gpu-${String(i + 1).padStart(2, '0')}`),
  'server-gpu-01',
];

test.describe('Fleet Thermal Heatmap: accessibility (WCAG 2.1 AA, NFR-07)', () => {
  test.beforeAll(async ({ request }) => {
    const res = await request.post('/v1/telemetry/batches', {
      data: fleetNodeIds.map((node_id) => ({ node_id, gpu_util_pct: 55, mem_used_mb: 9000, temp_c: node_id === HOT_NODE ? 91 : 62 })),
    });
    expect(res.ok()).toBeTruthy();
  });

  test('the heatmap with a thermal alert has no axe violations', async ({ page }) => {
    const dashboard = new ObservabilityDashboardPage(page);
    await dashboard.goto();
    await dashboard.expectFleetRendered(32);
    await dashboard.expectThermalAlert(HOT_NODE);

    await dashboard.expectNoAccessibilityViolations();
  });

  test('the open drill-down drawer has no axe violations and is keyboard operable', async ({ page }) => {
    const dashboard = new ObservabilityDashboardPage(page);
    await dashboard.goto();
    await dashboard.expectFleetRendered(32);

    await dashboard.focusCell(HOT_NODE);
    await dashboard.pressEnter();
    await dashboard.expectDrawerOpenFor(HOT_NODE);
    await dashboard.expectCloseButtonFocused();
    await dashboard.expectNoAccessibilityViolations();

    await dashboard.closeDrawerWithEscape();
    await dashboard.expectDrawerClosed();
    await dashboard.expectCellFocused(HOT_NODE);
  });
});
