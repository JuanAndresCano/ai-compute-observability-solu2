import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page Object for the Fleet Thermal Heatmap (`/observability/heatmap`).
 * Every selector and interaction lives here; specs read like Liam's user story and never touch the DOM directly.
 */
export class ObservabilityDashboardPage {
  readonly grid: Locator;
  readonly cells: Locator;
  readonly alertCount: Locator;
  readonly cordonedCount: Locator;
  readonly activityItems: Locator;

  readonly drawer: Locator;
  readonly drawerNodeId: Locator;
  readonly drawerStatus: Locator;
  readonly drawerTemperature: Locator;
  readonly drawerChart: Locator;
  readonly drawerLogs: Locator;
  readonly cordonButton: Locator;
  readonly closeButton: Locator;

  constructor(private readonly page: Page) {
    this.grid = page.getByTestId('fleet-grid');
    this.cells = this.grid.locator('[data-testid^="node-cell-"]');
    this.alertCount = page.getByTestId('alert-count');
    this.cordonedCount = page.getByTestId('cordoned-count');
    this.activityItems = page.getByTestId('activity-item');

    this.drawer = page.getByTestId('node-drawer');
    this.drawerNodeId = page.getByTestId('drawer-node-id');
    this.drawerStatus = page.getByTestId('drawer-status');
    this.drawerTemperature = page.getByTestId('drawer-temperature');
    this.drawerChart = page.getByTestId('telemetry-chart');
    this.drawerLogs = page.getByTestId('drawer-logs');
    this.cordonButton = page.getByTestId('cordon-button');
    this.closeButton = page.getByTestId('drawer-close');
  }

  async goto(): Promise<void> {
    await this.page.goto('/observability/heatmap');
  }

  async reload(): Promise<void> {
    await this.page.reload();
  }

  cell(nodeId: string): Locator {
    return this.page.getByTestId(`node-cell-${nodeId}`);
  }

  cordonedBadge(nodeId: string): Locator {
    return this.cell(nodeId).getByTestId('cordoned-badge');
  }

  async openNodeDrawer(nodeId: string): Promise<void> {
    await this.cell(nodeId).click();
  }

  async closeDrawerWithEscape(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }

  async cordonSelectedNode(): Promise<void> {
    await this.cordonButton.click();
  }

  // ---- Web-first assertions (auto-retrying; no sleeps, no manual polling) ----

  async expectFleetRendered(expectedCells: number): Promise<void> {
    await expect(this.cells).toHaveCount(expectedCells);
  }

  async expectThermalAlert(nodeId: string): Promise<void> {
    await expect(this.cell(nodeId)).toHaveAttribute('data-state', 'alert');
  }

  async expectNotAlerting(nodeId: string): Promise<void> {
    await expect(this.cell(nodeId)).not.toHaveAttribute('data-state', 'alert');
  }

  async expectDrawerOpenFor(nodeId: string): Promise<void> {
    await expect(this.drawer).toBeVisible();
    await expect(this.drawerNodeId).toHaveText(nodeId);
  }

  async expectDrawerClosed(): Promise<void> {
    await expect(this.drawer).toBeHidden();
  }

  async expectTelemetryGraphRendered(): Promise<void> {
    await expect(this.drawerChart).toBeVisible();
    await expect(this.drawerChart).toHaveAttribute('data-points', /^[1-9]\d*$/);
    await expect(this.drawerChart.locator('polygon.area')).toBeVisible();
  }

  async expectErrorLogLine(text: string | RegExp): Promise<void> {
    await expect(this.drawerLogs).toContainText(text);
  }

  async expectCordoned(nodeId: string): Promise<void> {
    await expect(this.cell(nodeId)).toHaveAttribute('data-state', 'cordoned');
    await expect(this.cordonedBadge(nodeId)).toHaveText('CORDONED');
    await expect(this.cordonedBadge(nodeId).getByTestId('lock-icon')).toBeVisible();
  }

  async expectActivityEntry(text: string | RegExp): Promise<void> {
    await expect(this.activityItems.filter({ hasText: text })).toHaveCount(1);
  }
}
