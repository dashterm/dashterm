import { AppDefinition } from '../../registry/types';
import Secrets from './index';

export const secretsPlugin: AppDefinition = {
  id: 'secrets',
  type: 'secrets',
  title: 'SECRETS & VARS',
  description: 'Store API keys (write-only) and readable config your custom apps use by name.',
  icon: '🔑',
  component: () => Secrets(),
  defaultState: {},
  gridDefaults: { height: 360, minHeight: 240, column: 0, order: 102 },
  aiFunctions: [],
  getSummary: () => 'Manage secrets & variables',
  // Settings-space only — not offered in the command palette's add list.
  system: true,
};
