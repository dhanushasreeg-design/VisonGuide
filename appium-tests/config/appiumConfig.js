/**
 * VisionGuide AI - Appium Android Test Configuration
 * Defines Appium capabilities, Android device profiles, server endpoints, and mobile runtime options.
 */

const APPIUM_HOST = process.env.APPIUM_HOST || '127.0.0.1';
const APPIUM_PORT = process.env.APPIUM_PORT || 4723;
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const BACKEND_URL = process.env.TEST_BACKEND_URL || 'http://localhost:5000';

// Standard Appium W3C Capabilities for Android Mobile Testing
const androidCapabilities = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:deviceName': 'Android Google Pixel 7 Pro',
  'appium:platformVersion': '14.0',
  'appium:appPackage': 'com.visionguideai.app',
  'appium:appActivity': 'com.visionguideai.MainActivity',
  'appium:orientation': 'PORTRAIT',
  'appium:autoGrantPermissions': true,
  'appium:newCommandTimeout': 3600,
  'appium:noReset': false,
  'appium:fullReset': false,
  'appium:nativeWebScreenshot': true,
  'appium:ensureWebviewsHavePages': true,
  'browserName': 'Chrome',
  'appium:chromedriverArgs': ['--disable-build-check'],
  'appium:chromeOptions': {
    w3c: true,
    args: [
      '--disable-popup-blocking',
      '--disable-notifications',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--enable-features=NetworkService,NetworkServiceInProcess',
      '--ignore-certificate-errors',
    ],
    prefs: {
      'profile.default_content_setting_values.media_stream_mic': 1,
      'profile.default_content_setting_values.media_stream_camera': 1,
      'profile.default_content_setting_values.geolocation': 1,
      'profile.default_content_setting_values.notifications': 1,
    },
  },
};

// Android Device Profiles for Responsive and Touch Testing
const deviceProfiles = {
  pixel7: {
    name: 'Google Pixel 7',
    platform: 'Android 14',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.240205.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
  },
  galaxyS23: {
    name: 'Samsung Galaxy S23',
    platform: 'Android 14',
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 3.0,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  },
  tablet: {
    name: 'Samsung Galaxy Tab S9',
    platform: 'Android 14',
    viewport: { width: 800, height: 1280 },
    deviceScaleFactor: 2.0,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  },
};

// Mock GPS Coordinates for Navigation & SafeWalk Testing (Downtown Tech & Medical Center)
const mockGeolocation = {
  latitude: 37.774929,
  longitude: -122.419416,
  accuracy: 5,
};

module.exports = {
  APPIUM_HOST,
  APPIUM_PORT,
  BASE_URL,
  BACKEND_URL,
  androidCapabilities,
  deviceProfiles,
  mockGeolocation,
};
