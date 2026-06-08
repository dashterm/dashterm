import { registerRootComponent } from 'expo';
import App from './packages/web/App';

// OSS builds ship only the web app — the native mobile shell lives in the
// closed-source dashterm-app repo. registerRootComponent wires App into
// Expo's web entry point.
registerRootComponent(App);
