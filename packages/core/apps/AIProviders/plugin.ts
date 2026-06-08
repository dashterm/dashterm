import { AppDefinition } from '../../registry/types';
import AIProviders from './index';

export const aiProvidersPlugin: AppDefinition = {
  id: 'aiproviders',
  type: 'aiproviders',
  title: 'AI PROVIDERS',
  description: 'Configure the AI backends apps route to (admin).',
  icon: '🧠',
  component: () => AIProviders(),
  defaultState: {},
  gridDefaults: { height: 360, minHeight: 240, column: 0, order: 101 },
  aiFunctions: [],
  getSummary: () => 'Manage AI providers',
  // Settings-space only — not offered in the command palette's add list.
  system: true,
};
