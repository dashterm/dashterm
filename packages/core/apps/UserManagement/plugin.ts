import { AppDefinition, AppComponentProps } from '../../registry/types';
import UserManagement from './index';

export const userManagementPlugin: AppDefinition = {
  id: 'usermgmt',
  type: 'usermgmt',
  title: 'USER MANAGEMENT',
  description: 'List and manage user accounts (admin only).',
  icon: '👥',
  component: ({ state, updateState, userProfile }: AppComponentProps) =>
    UserManagement({ appState: state, onUpdate: updateState, userProfile }),
  defaultState: {},
  gridDefaults: { height: 320, minHeight: 200, column: 0, order: 100 },
  aiFunctions: [],
  getSummary: () => 'Manage users',
  // Settings-space only — hidden from the command palette's add list.
  system: true,
};
