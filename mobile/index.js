import { Platform } from 'react-native';
import * as Expo from 'expo';

// Polyfill Platform on global and Expo namespace for Hermes runtime safety
if (typeof globalThis !== 'undefined') {
  if (!globalThis.Platform) globalThis.Platform = Platform;
}
if (Expo && !Expo.Platform) {
  try {
    Object.defineProperty(Expo, 'Platform', {
      configurable: true,
      enumerable: true,
      get: () => Platform,
    });
  } catch (_) {
    Expo.Platform = Platform;
  }
}

import { registerRootComponent } from 'expo';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
