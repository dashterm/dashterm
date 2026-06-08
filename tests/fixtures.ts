/**
 * Test fixtures and helpers for Playwright tests
 */
import { test as base, Page, Locator, expect } from '@playwright/test';

// Custom test fixture with WorkoutTracker helpers
export const test = base.extend<{
  workoutPage: WorkoutTrackerPage;
}>({
  workoutPage: async ({ page }, use) => {
    const workoutPage = new WorkoutTrackerPage(page);
    await use(workoutPage);
  },
});

export { expect };

/**
 * Page Object Model for WorkoutTracker app
 */
export class WorkoutTrackerPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to the app and add WorkoutTracker to the dashboard
   */
  async goto() {
    await this.page.goto('/');
    // Wait for the dashboard to load
    await this.page.waitForLoadState('networkidle');
    // Wait for dashboard UI elements
    await this.page.waitForSelector('text=DASHTERM', { timeout: 30000 });
  }

  /**
   * Open command palette and add the Workout app to the dashboard
   */
  async addWorkoutApp() {
    // Open command palette with Cmd+K or Ctrl+K
    await this.page.keyboard.press('Meta+k');
    // Wait for command palette to open - look for the input with "Type a command" placeholder
    await this.page.waitForSelector('input[placeholder*="command"]', { timeout: 5000 }).catch(async () => {
      // Try Ctrl+K if Meta+K didn't work
      await this.page.keyboard.press('Control+k');
      await this.page.waitForSelector('input[placeholder*="command"]', { timeout: 5000 });
    });

    // Type to search for workout
    await this.page.keyboard.type('workout');
    await this.page.waitForTimeout(500);

    // Click on the "Add WORKOUT TRACKER" option
    await this.page.click('text=Add WORKOUT TRACKER').catch(async () => {
      // Try clicking on any workout-related item
      await this.page.click('text=/WORKOUT/i');
    });

    // Wait for the app to be added and boot sequence to start
    await this.page.waitForTimeout(2000);
  }

  /**
   * Wait for boot sequence to complete (look for the workout type buttons)
   */
  async waitForBootComplete() {
    // Wait for the boot sequence to finish - the workout type buttons should appear
    await this.page.waitForSelector('text=PUSH', { timeout: 30000 });
  }

  /**
   * Check if boot sequence is showing
   */
  async isBootSequenceVisible(): Promise<boolean> {
    const bootText = this.page.locator('text=WORKOUT-OS v4.0.0 BIOS');
    return await bootText.isVisible().catch(() => false);
  }

  /**
   * Get the terminal command input
   */
  getTerminalInput(): Locator {
    return this.page.locator('input[placeholder*="HELP"]').first();
  }

  /**
   * Execute a terminal command
   */
  async executeCommand(command: string) {
    const input = this.getTerminalInput();
    await input.fill(command);
    await input.press('Enter');
  }

  /**
   * Start a workout with a specific type
   */
  async startWorkout(type?: 'PUSH' | 'PULL' | 'LEGS' | 'UPPER' | 'LOWER' | 'FULL_BODY') {
    if (type) {
      // The UI shows "FULL BODY" with a space, not "FULL_BODY"
      const displayType = type === 'FULL_BODY' ? 'FULL BODY' : type;

      // Try to find and click the workout type button
      // First try the exact type, then try with the AI suggestion button
      const typeButton = this.page.locator(`text=${displayType}`).first();

      // Scroll to make sure the button is visible
      await typeButton.scrollIntoViewIfNeeded().catch(() => {});

      // Wait for the button to be visible
      await typeButton.waitFor({ state: 'visible', timeout: 5000 }).catch(async () => {
        // If not visible, the UI might only show AI suggestion - click on it if it matches
        const suggestionButton = this.page.locator(`text=${displayType}`);
        if (await suggestionButton.isVisible()) {
          await suggestionButton.click();
          return;
        }
        // Otherwise scroll down and try again
        await this.page.evaluate(() => {
          const scrollable = document.querySelector('[class*="content"]');
          if (scrollable) scrollable.scrollTop = 500;
        });
      });

      await typeButton.click();
    } else {
      // Click quick start
      await this.page.click('text=QUICK START').catch(async () => {
        // Fallback: click on AI WILL CLASSIFY
        await this.page.click('text=AI WILL CLASSIFY');
      });
    }
  }

  /**
   * End the current workout
   */
  async endWorkout() {
    await this.page.click('text=[ END ]');
  }

  /**
   * Check if a workout is active
   */
  async isWorkoutActive(): Promise<boolean> {
    // Check for signs of active workout: END button, DURATION display, or SESSION: ACTIVE
    const endButton = this.page.locator('text=[ END ]');
    const durationText = this.page.locator('text=DURATION:');
    const sessionActive = this.page.locator('text=SESSION: ACTIVE');

    const hasEndButton = await endButton.isVisible().catch(() => false);
    const hasDuration = await durationText.isVisible().catch(() => false);
    const hasSessionActive = await sessionActive.isVisible().catch(() => false);

    return hasEndButton || hasDuration || hasSessionActive;
  }

  /**
   * Log a set using natural language input
   */
  async logSet(input: string) {
    // Find the set input row - it should be visible when workout is active
    const setInput = this.page.locator('input[placeholder*="BP"]').first();
    if (await setInput.isVisible()) {
      await setInput.fill(input);
      await setInput.press('Enter');
    } else {
      // Fall back to terminal command
      await this.executeCommand(input);
    }
  }

  /**
   * Open exercises panel
   */
  async openExercises() {
    await this.page.click('text=[ EXERCISES ]');
  }

  /**
   * Open history panel
   */
  async openHistory() {
    await this.page.click('text=[ HISTORY ]');
  }

  /**
   * Open settings panel
   */
  async openSettings() {
    // Click the settings button (gear icon)
    await this.page.click('[class*="settingsButton"]').catch(async () => {
      // Fallback to text match
      await this.page.click('text=[ \u2699 ]');
    });
  }

  /**
   * Close any open inline panel
   */
  async closePanel() {
    await this.page.click('text=[ CLOSE ]');
  }

  /**
   * Check if exercises panel is open
   */
  async isExercisesPanelOpen(): Promise<boolean> {
    return await this.page.locator('text=EXERCISE SETUP').isVisible().catch(() => false);
  }

  /**
   * Check if history panel is open
   */
  async isHistoryPanelOpen(): Promise<boolean> {
    return await this.page.locator('text=WORKOUT HISTORY').isVisible().catch(() => false);
  }

  /**
   * Check if settings panel is open
   */
  async isSettingsPanelOpen(): Promise<boolean> {
    return await this.page.locator('text=WEIGHT UNIT').isVisible().catch(() => false);
  }

  /**
   * Switch weight unit in settings
   */
  async setWeightUnit(unit: 'KG' | 'LBS') {
    await this.page.click(`text=${unit}`);
  }

  /**
   * Get the current workout duration display
   */
  async getWorkoutDuration(): Promise<string | null> {
    const duration = this.page.locator('text=/DURATION: \\d+:\\d+/');
    if (await duration.isVisible()) {
      const text = await duration.textContent();
      return text?.replace('DURATION: ', '') || null;
    }
    return null;
  }

  /**
   * Get the total sets count
   */
  async getTotalSets(): Promise<number> {
    const setsText = this.page.locator('text=/TOTAL SETS: \\d+/');
    if (await setsText.isVisible()) {
      const text = await setsText.textContent();
      const match = text?.match(/TOTAL SETS: (\d+)/);
      return match ? parseInt(match[1]) : 0;
    }
    return 0;
  }

  /**
   * Check if AI suggestion is loading
   */
  async isAISuggestionLoading(): Promise<boolean> {
    return await this.page.locator('text=AI analyzing workout history').isVisible().catch(() => false);
  }

  /**
   * Check if AI suggestion is displayed
   */
  async hasAISuggestion(): Promise<boolean> {
    return await this.page.locator('text=AI RECOMMENDED WORKOUT').isVisible().catch(() => false);
  }

  /**
   * Click on the AI suggested workout
   */
  async acceptAISuggestion() {
    // Click on the first suggested workout button
    const suggestionButton = this.page.locator('[class*="suggestedWorkoutButton"]').first();
    if (await suggestionButton.isVisible()) {
      await suggestionButton.click();
    }
  }

  /**
   * Switch to sessions tab in history
   */
  async switchToSessionsTab() {
    await this.page.click('text=SESSIONS');
  }

  /**
   * Switch to exercises tab in history
   */
  async switchToExercisesTab() {
    await this.page.click('text=EXERCISES');
  }

  /**
   * Delete a session from history (first one)
   */
  async deleteFirstSession() {
    await this.page.click('text=[DEL]');
  }

  /**
   * Edit a session from history (first one)
   */
  async editFirstSession() {
    await this.page.click('text=[EDIT]');
  }

  /**
   * Save session type changes
   */
  async saveSessionChanges() {
    await this.page.click('text=[ SAVE CHANGES ]');
  }

  /**
   * Cancel session edit
   */
  async cancelSessionEdit() {
    await this.page.click('text=[CANCEL]');
  }

  /**
   * Clear all history in settings
   */
  async clearAllHistory() {
    await this.page.click('text=[ CLEAR ALL HISTORY ]');
  }

  /**
   * Check if a specific text is visible on the page
   */
  async hasText(text: string): Promise<boolean> {
    return await this.page.locator(`text=${text}`).isVisible().catch(() => false);
  }

  /**
   * Wait for specific text to appear
   */
  async waitForText(text: string, timeout = 10000) {
    await this.page.waitForSelector(`text=${text}`, { timeout });
  }

  /**
   * Get all visible set items
   */
  async getSetCount(): Promise<number> {
    const sets = this.page.locator('text=/SET \\d+:/');
    return await sets.count();
  }

  /**
   * Toggle completion of a set (click on it)
   */
  async toggleSetCompletion(setIndex: number) {
    const sets = this.page.locator('text=/SET \\d+:/');
    const set = sets.nth(setIndex);
    await set.click();
  }

  /**
   * Check if a set is completed
   */
  async isSetCompleted(setIndex: number): Promise<boolean> {
    const doneIndicators = this.page.locator('text=[DONE]');
    const count = await doneIndicators.count();
    return count > setIndex;
  }
}

/**
 * Test data constants
 */
export const TEST_EXERCISES = {
  benchPress: 'BB BP 60x8',
  benchPressWithRPE: 'BB BP 60x8@7',
  multiSet: 'BB BP 30x8 40x8 50x6',
  squat: 'SQUAT 100x5',
  deadlift: 'DL 120x3',
  pullUp: 'PULL UP 0x10',
  latPulldown: 'LAT PD 50x12',
  shoulderPress: 'OHP 40x8',
};

export const WORKOUT_TYPES = ['PUSH', 'PULL', 'LEGS', 'UPPER', 'LOWER', 'FULL_BODY'] as const;
