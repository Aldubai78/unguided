// MUST be line 1 — installs SQLite-backed localStorage on native BEFORE any
// screen or localStore module reads localStorage at load time. Web: no-op.
import "./src/boot/storage";

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
