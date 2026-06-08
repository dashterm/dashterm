export interface AppState {
  counter: number;
  message: string;
  activeTab: 'home' | 'settings' | 'profile';
  accordionOpen: boolean;
  textInput: string;
  lastUpdated: number;
  deviceType: 'mobile' | 'web';
}