/**
 * The ship-with-the-app plugin registry.
 *
 * After Phase 2 the native registered apps shipped in the bundle are limited
 * to the core primitives: the AI assistant (the vibe-coding driver) plus
 * the two server-coupled overlays (AgenticCoder, Scheduler). Everything else
 * users want lives as a vibe-coded app in the apps/{shareCode} collection.
 *
 * AgenticCoder + Scheduler are exported as plugin DEFINITIONS but NOT added
 * to the addable-app list — they're opened via global overlays (CMD-K A/S)
 * rather than placed as tiles. The plugin entry still exists so the registry
 * can dispatch their type if a leftover tile is encountered.
 */

import { registerApp } from '../registry';
import { aiPlugin } from './AIAssistant/plugin';
import { agenticCoderPlugin } from './AgenticCoder/plugin';
import { schedulerPlugin } from './Scheduler/plugin';
import { userManagementPlugin } from './UserManagement/plugin';
import { aiProvidersPlugin } from './AIProviders/plugin';
import { secretsPlugin } from './Secrets/plugin';

export function registerAllApps() {
  registerApp(aiPlugin);
  // The three settings tiles. They're flagged `system: true`, so the command
  // palette hides them from its addable-app list — they live only in the
  // reserved Settings space (see ensureSystemSpace).
  registerApp(userManagementPlugin);
  registerApp(aiProvidersPlugin);
  registerApp(secretsPlugin);
  // AgenticCoder and Scheduler are NOT tile-able — they live as global
  // overlays opened via CMD-K (A / S). The plugin files exist so the
  // registry can resolve their type, but they're not registered for the
  // palette's addable-app list.
  // registerApp(agenticCoderPlugin);
  // registerApp(schedulerPlugin);
}

export { aiPlugin } from './AIAssistant/plugin';
export { agenticCoderPlugin } from './AgenticCoder/plugin';
export { schedulerPlugin } from './Scheduler/plugin';
export { userManagementPlugin } from './UserManagement/plugin';
export { aiProvidersPlugin } from './AIProviders/plugin';
export { secretsPlugin } from './Secrets/plugin';
