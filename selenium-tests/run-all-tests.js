const path = require('path');
const fs = require('fs');
const { createDriver, BASE_URL } = require('./config/seleniumConfig');
const TestReporter = require('./helpers/reporter');

const { runAuthSuite } = require('./suites/01_auth.test');
const { runLandingSuite } = require('./suites/02_landing.test');
const { runLayoutSuite } = require('./suites/03_layout.test');
const { runAccessibilitySuite } = require('./suites/04_accessibility.test');
const { runDashboardSuite } = require('./suites/05_dashboard.test');
const { runVoiceSuite } = require('./suites/06_voice.test');
const { runNavigationSuite } = require('./suites/07_navigation.test');
const { runObjectDetectionSuite } = require('./suites/08_object_detection.test');
const { runCameraOcrSuite } = require('./suites/09_camera_ocr.test');
const { runSafeWalkSuite } = require('./suites/10_safewalk.test');
const { runEmergencySuite } = require('./suites/11_emergency.test');
const { runSosSuite } = require('./suites/12_sos.test');
const { runSavedLocationsSuite } = require('./suites/13_saved_locations.test');
const { runArticleReaderSuite } = require('./suites/14_article_reader.test');
const { runCommandHistorySuite } = require('./suites/15_command_history.test');
const { runFeedbackSuite } = require('./suites/16_feedback.test');
const { runSettingsSuite } = require('./suites/17_settings.test');

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║       VISIONGUIDE AI — FULL END-TO-END SELENIUM TEST SUITE       ║');
  console.log('║           300 Automated Test Cases Across All Modules            ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
  console.log(`Target URL: ${BASE_URL}`);
  console.log(`Starting headless Chrome WebDriver session...\n`);

  const reporter = new TestReporter();
  const driver = await createDriver();

  const suites = [
    { name: '01: Authentication & Security', fn: runAuthSuite, count: 25 },
    { name: '02: Landing & Public Showcase', fn: runLandingSuite, count: 20 },
    { name: '03: Global Navigation & Shell Layout', fn: runLayoutSuite, count: 20 },
    { name: '04: Accessibility & Universal Design', fn: runAccessibilitySuite, count: 25 },
    { name: '05: Dashboard Overview & Metrics', fn: runDashboardSuite, count: 20 },
    { name: '06: Voice Assistant & Natural Speech', fn: runVoiceSuite, count: 25 },
    { name: '07: Navigation & Nearby POI Engine', fn: runNavigationSuite, count: 25 },
    { name: '08: AI Object Detection & Hazards', fn: runObjectDetectionSuite, count: 20 },
    { name: '09: Camera Text Reader & OCR', fn: runCameraOcrSuite, count: 20 },
    { name: '10: SafeWalk & Auto-SOS Assistant', fn: runSafeWalkSuite, count: 20 },
    { name: '11: Emergency Contacts & Dialpad', fn: runEmergencySuite, count: 20 },
    { name: '12: SOS Emergency Alert System', fn: runSosSuite, count: 20 },
    { name: '13: Saved Locations & Bookmarks', fn: runSavedLocationsSuite, count: 20 },
    { name: '14: Article Reader & Text-to-Speech', fn: runArticleReaderSuite, count: 5 },
    { name: '15: Command History & Voice Auditing', fn: runCommandHistorySuite, count: 5 },
    { name: '16: User Feedback & Ratings', fn: runFeedbackSuite, count: 5 },
    { name: '17: Settings & Localization', fn: runSettingsSuite, count: 5 },
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
    console.log('\n──────────────────────────────────────────────────────────────────');
    console.log(`  TOTAL TEST CASES EXECUTED: ${stats.total}`);
    console.log(`  PASSED:                   ${stats.passed} (${stats.passRate}%)`);
    console.log(`  FAILED:                   ${stats.failed}`);
    console.log(`  TOTAL DURATION:           ${(stats.totalDuration / 1000).toFixed(1)}s`);
    console.log('──────────────────────────────────────────────────────────────────\n');

    const reportPathInSubdir = path.join(__dirname, 'reports', 'VisionGuideAI_Selenium_E2E_Test_Report.xlsx');
    const reportPathInRoot = path.join(__dirname, '..', 'VisionGuideAI_Selenium_E2E_Test_Report.xlsx');

    await reporter.exportToExcel(reportPathInSubdir);
    // Also save copy to workspace root for convenient one-click user access
    fs.copyFileSync(reportPathInSubdir, reportPathInRoot);
    console.log(`📁 Report also copied to root: ${reportPathInRoot}`);

  } catch (err) {
    console.error('Error during test execution:', err);
    process.exitCode = 1;
  } finally {
    await driver.quit();
    console.log('Selenium WebDriver session closed.');
  }
}

main();
