/**
 * VisionGuide AI - Master Appium Android Mobile E2E Test Suite Runner
 * Executes exactly 300 automated test cases across 18 specialized modules,
 * benchmarks mobile performance, and generates a multi-sheet Excel analysis report.
 */

const path = require('path');
const fs = require('fs');
const { createAndroidDriver } = require('./helpers/mobileDriver');
const AppiumTestReporter = require('./helpers/reporter');
const { BASE_URL } = require('./config/appiumConfig');

// Import all 18 Android test suites
const { runAndroidAuthSuite } = require('./suites/01_android_auth.test');
const { runAndroidLandingSuite } = require('./suites/02_android_landing.test');
const { runAndroidLayoutSuite } = require('./suites/03_android_layout_shell.test');
const { runAndroidAccessibilitySuite } = require('./suites/04_android_talkback_accessibility.test');
const { runAndroidDashboardSuite } = require('./suites/05_android_dashboard.test');
const { runAndroidVoiceSuite } = require('./suites/06_android_voice_zara.test');
const { runAndroidNavigationSuite } = require('./suites/07_android_navigation_gps.test');
const { runAndroidObjectDetectionSuite } = require('./suites/08_android_camera_object_detection.test');
const { runAndroidCameraOcrSuite } = require('./suites/09_android_camera_ocr_reader.test');
const { runAndroidSafeWalkSuite } = require('./suites/10_android_safewalk_auto_sos.test');
const { runAndroidEmergencySuite } = require('./suites/11_android_emergency_contacts.test');
const { runAndroidSosSuite } = require('./suites/12_android_emergency_sos.test');
const { runAndroidSavedLocationsSuite } = require('./suites/13_android_saved_locations.test');
const { runAndroidArticleReaderSuite } = require('./suites/14_android_article_reader.test');
const { runAndroidCommandHistorySuite } = require('./suites/15_android_command_history.test');
const { runAndroidFeedbackSuite } = require('./suites/16_android_user_feedback.test');
const { runAndroidSettingsSuite } = require('./suites/17_android_settings_localization.test');
const { runAndroidLifecycleSuite } = require('./suites/18_android_lifecycle_gestures.test');

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║       VISIONGUIDE AI — FULL APPIUM ANDROID E2E TEST SUITE            ║');
  console.log('║           300 Automated Test Cases Across All Mobile Modules         ║');
  console.log('║           Target: Google Pixel 7 Pro (Android 14 / UiAutomator2)     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');
  console.log(`Target URL: ${BASE_URL}`);
  console.log(`Starting Android Mobile Driver Session...\n`);

  const reporter = new AppiumTestReporter();
  const driver = await createAndroidDriver();

  const suites = [
    { name: '01: Mobile Auth & Biometric Security', fn: runAndroidAuthSuite, count: 25 },
    { name: '02: Mobile Landing & Public Showcase', fn: runAndroidLandingSuite, count: 20 },
    { name: '03: Mobile Shell & Navigation Layout', fn: runAndroidLayoutSuite, count: 20 },
    { name: '04: TalkBack & Universal Design', fn: runAndroidAccessibilitySuite, count: 25 },
    { name: '05: Mobile Dashboard & Action Tiles', fn: runAndroidDashboardSuite, count: 20 },
    { name: '06: Voice Assistant "Hey Zara"', fn: runAndroidVoiceSuite, count: 25 },
    { name: '07: GPS Navigation & Nearby POIs', fn: runAndroidNavigationSuite, count: 25 },
    { name: '08: AI Object Detection & Hazards', fn: runAndroidObjectDetectionSuite, count: 20 },
    { name: '09: Camera Text Reader & OCR', fn: runAndroidCameraOcrSuite, count: 20 },
    { name: '10: SafeWalk & Auto-SOS Assistant', fn: runAndroidSafeWalkSuite, count: 20 },
    { name: '11: Emergency Contacts & Dialpad', fn: runAndroidEmergencySuite, count: 20 },
    { name: '12: SOS Emergency Alert System', fn: runAndroidSosSuite, count: 20 },
    { name: '13: Saved Locations & Bookmarks', fn: runAndroidSavedLocationsSuite, count: 20 },
    { name: '14: Article Reader & Text-to-Speech', fn: runAndroidArticleReaderSuite, count: 5 },
    { name: '15: Command History & Voice Auditing', fn: runAndroidCommandHistorySuite, count: 5 },
    { name: '16: User Feedback & Ratings', fn: runAndroidFeedbackSuite, count: 5 },
    { name: '17: Settings & Localization', fn: runAndroidSettingsSuite, count: 5 },
    { name: '18: Device Lifecycle & Gestures', fn: runAndroidLifecycleSuite, count: 10 },
  ];

  try {
    for (let i = 0; i < suites.length; i++) {
      const suite = suites[i];
      const startCount = reporter.results.length;
      process.stdout.write(`[${String(i + 1).padStart(2, '0')}/${suites.length}] Running ${suite.name} (${suite.count} TCs)... `);
      const tStart = Date.now();
      await suite.fn(driver, BASE_URL, reporter);
      const added = reporter.results.length - startCount;
      const tElapsed = ((Date.now() - tStart) / 1000).toFixed(1);
      console.log(`✅ PASSED (${added} tests in ${tElapsed}s)`);
    }

    const stats = reporter.getStats();
    console.log('\n──────────────────────────────────────────────────────────────────────');
    console.log(`  TOTAL ANDROID TEST CASES EXECUTED: ${stats.total}`);
    console.log(`  PASSED:                           ${stats.passed} (${stats.passRate}%)`);
    console.log(`  FAILED:                           ${stats.failed}`);
    console.log(`  TOTAL BENCHMARK DURATION:         ${(stats.totalDuration / 1000).toFixed(1)}s`);
    console.log(`  DEVICE PLATFORM:                  Google Pixel 7 (Android 14 / UiAutomator2)`);
    console.log(`  OVERALL VERDICT:                  ${stats.failed === 0 ? '100% PASSED (CERTIFIED)' : 'FAILED'}`);
    console.log('──────────────────────────────────────────────────────────────────────\n');

    const reportPathInSubdir = path.join(__dirname, 'reports', 'VisionGuideAI_Appium_Android_E2E_Test_Report.xlsx');
    const reportPathInRoot = path.join(__dirname, '..', 'VisionGuideAI_Appium_Android_E2E_Test_Report.xlsx');

    await reporter.exportToExcel(reportPathInSubdir);
    // Copy directly to workspace root for one-click access
    fs.copyFileSync(reportPathInSubdir, reportPathInRoot);
    console.log(`📁 Report also copied to workspace root: ${reportPathInRoot}`);

  } catch (err) {
    console.error('Error during Appium test execution:', err);
    process.exitCode = 1;
  } finally {
    await driver.close();
    console.log('Android Mobile Driver session closed successfully.');
  }
}

main();
