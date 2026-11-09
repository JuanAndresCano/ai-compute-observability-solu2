import { test, expect, type APIRequestContext } from '@playwright/test';
import { ObservabilityDashboardPage } from './pages/ObservabilityDashboardPage';

const HOT_NODE = 'ws-gpu-22';
const FLEET_SIZE = 32; // 31 workstations + server-gpu-01

const fleetNodeIds = [
  ...Array.from({ length: 31 }, (_, i) => `ws-gpu-${String(i + 1).padStart(2, '0')}`),
  'server-gpu-01',
];

/** Given: every node reports healthy telemetry except ws-gpu-22, which is at 91°C (> 88°C). Sent through the real ingestion API. */
async function seedFleetWithThermalAlert(request: APIRequestContext): Promise<void> {
  const batch = fleetNodeIds.map((node_id) => ({
    node_id,
    gpu_util_pct: 55,
    mem_used_mb: 9000,
    temp_c: node_id === HOT_NODE ? 91 : 62,
  }));
  const res = await request.post('/v1/telemetry/batches', { data: batch });
  expect(res.ok(), `telemetry seed failed: ${res.status()}`).toBeTruthy();
}

// The console keeps fleet state in memory, and the cordon scenario mutates it: run in file order.
test.describe.configure({ mode: 'serial' });

test.describe('Fleet Thermal Heatmap: node drill-down and incident triage', () => {
  test.beforeAll(async ({ request }) => {
    await seedFleetWithThermalAlert(request);
  });

  test('shows the whole fleet and highlights only the node above 88°C', async ({ page }) => {
    const dashboard = new ObservabilityDashboardPage(page);

    await dashboard.goto();

    await dashboard.expectFleetRendered(FLEET_SIZE);
    await dashboard.expectThermalAlert(HOT_NODE);
    await dashboard.expectNotAlerting('ws-gpu-01');
    await dashboard.expectNotAlerting('server-gpu-01');
    await expect(dashboard.alertCount).toHaveText('1 thermal alert');
  });

  test('Engineer drills down into thermal alert and cordons node', async ({ page }) => {
    const dashboard = new ObservabilityDashboardPage(page);

    // Given Liam is viewing the Fleet Thermal Heatmap
    await dashboard.goto();
    // And node cell "ws-gpu-22" is flashing Red (> 88°C)
    await dashboard.expectThermalAlert(HOT_NODE);

    // When Liam clicks on cell "ws-gpu-22"
    await dashboard.openNodeDrawer(HOT_NODE);

    // Then a slide-out drawer opens displaying live telemetry graphs and recent error logs
    await dashboard.expectDrawerOpenFor(HOT_NODE);
    await expect(dashboard.drawerTemperature).toHaveText('91°C');
    await dashboard.expectTelemetryGraphRendered();
    await dashboard.expectErrorLogLine(/temperature 91C exceeds threshold/);

    // When Liam clicks "Cordon Node from Cluster" in the drawer
    await expect(dashboard.cordonButton).toHaveText('Cordon Node from Cluster');
    await dashboard.cordonSelectedNode();

    // Then the node cell turns Gray with a "CORDONED" lock icon
    await dashboard.expectCordoned(HOT_NODE);
    // And an audit event confirming the cordon action appears in the activity feed
    await dashboard.expectActivityEntry(`Node ${HOT_NODE} cordoned by liam`);
    await expect(dashboard.cordonedCount).toHaveText('1 cordoned');
    await expect(dashboard.cordonButton).toBeDisabled();
  });

  test('Escape closes the drawer and the cordoned state survives a reload', async ({ page }) => {
    const dashboard = new ObservabilityDashboardPage(page);

    await dashboard.goto();
    await dashboard.openNodeDrawer(HOT_NODE);
    await dashboard.expectDrawerOpenFor(HOT_NODE);

    await dashboard.closeDrawerWithEscape();
    await dashboard.expectDrawerClosed();

    await dashboard.reload();
    await dashboard.expectCordoned(HOT_NODE);
  });
});
