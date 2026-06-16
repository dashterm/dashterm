import { AppDefinition, AppComponentProps } from '../../registry/types';
import AppSettingsApp from './index';

export const appSettingsPlugin: AppDefinition = {
  id: 'appsettings',
  type: 'appsettings',
  title: 'APP SETTINGS',
  description: 'Dashboard-wide preferences (date format) + software updates.',
  icon: '⚙️',
  // Reads/writes the global webLayout.appSettings (not instance state), so it
  // takes appSettings + updateAppSettings off AppComponentProps rather than
  // state/updateState.
  component: ({ appSettings, updateAppSettings }: AppComponentProps) =>
    AppSettingsApp({ appSettings, onUpdate: updateAppSettings }),
  defaultState: {},
  gridDefaults: { height: 300, minHeight: 160, column: 0, order: 103 },
  aiFunctions: [],
  getSummary: (_state) => 'Dashboard preferences',
  // Settings-space only — hidden from the command palette's add list.
  system: true,
};
