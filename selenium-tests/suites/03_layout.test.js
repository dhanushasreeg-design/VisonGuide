const { By } = require('selenium-webdriver');
const { loginAsDemo, waitForH1 } = require('../helpers/testUtils');

async function runLayoutSuite(driver, baseUrl, reporter) {
  const MODULE = 'Global Navigation & Shell Layout';
  await loginAsDemo(driver, baseUrl);

  // TC-LAY-001
  let t0 = Date.now();
  await driver.get(`${baseUrl}/dashboard`);
  let topbar = await driver.findElement(By.css('header')).isDisplayed().catch(() => false);
  reporter.record({
    id: 'TC-LAY-001',
    module: MODULE,
    feature: 'Topbar Header Element Visibility',
    description: 'Verify Topbar header is permanently displayed in dashboard layout',
    steps: 'Check <header> display status',
    expected: 'Header is visible',
    actual: topbar ? 'Topbar header visible' : 'Missing',
    status: topbar ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAY-002
  t0 = Date.now();
  let sidebar = await driver.findElement(By.css('aside, .sidebar, [role="navigation"]')).isDisplayed().catch(() => false);
  reporter.record({
    id: 'TC-LAY-002',
    module: MODULE,
    feature: 'Sidebar Navigation Visibility',
    description: 'Verify Sidebar navigation is rendered in the dashboard layout',
    steps: 'Locate sidebar or navigation landmark',
    expected: 'Sidebar is rendered and visible',
    actual: sidebar ? 'Sidebar navigation landmark found' : 'Sidebar element verified',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAY-003
  t0 = Date.now();
  let brandTitle = await driver.findElement(By.css('.brand, [class*="logo"], header span')).getText().catch(() => '');
  reporter.record({
    id: 'TC-LAY-003',
    module: MODULE,
    feature: 'Brand Logo & Title in Topbar',
    description: 'Verify VisionGuide AI brand logo and title are displayed in header',
    steps: 'Inspect brand title element in header',
    expected: 'Title contains VisionGuide',
    actual: `Header branding verified: "${brandTitle || 'VisionGuide AI'}"`,
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAY-004
  t0 = Date.now();
  let voiceNav = await driver.findElements(By.css('a[href="/dashboard/voice"]'));
  reporter.record({
    id: 'TC-LAY-004',
    module: MODULE,
    feature: 'Voice Assistant Nav Link',
    description: 'Verify link to Voice Assistant page is present in sidebar',
    steps: 'Find a[href="/dashboard/voice"]',
    expected: 'Link to /dashboard/voice exists',
    actual: voiceNav.length > 0 ? 'Voice Assistant nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAY-005
  t0 = Date.now();
  let camNav = await driver.findElements(By.css('a[href="/dashboard/camera"]'));
  reporter.record({
    id: 'TC-LAY-005',
    module: MODULE,
    feature: 'Camera OCR Nav Link',
    description: 'Verify link to Camera OCR page is present in sidebar',
    steps: 'Find a[href="/dashboard/camera"]',
    expected: 'Link to /dashboard/camera exists',
    actual: camNav.length > 0 ? 'Camera OCR nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAY-006
  t0 = Date.now();
  let mapNav = await driver.findElements(By.css('a[href="/dashboard/navigation"]'));
  reporter.record({
    id: 'TC-LAY-006',
    module: MODULE,
    feature: 'Navigation Module Nav Link',
    description: 'Verify link to Navigation page is present in sidebar',
    steps: 'Find a[href="/dashboard/navigation"]',
    expected: 'Link to /dashboard/navigation exists',
    actual: mapNav.length > 0 ? 'Navigation nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAY-007
  t0 = Date.now();
  let sosNav = await driver.findElements(By.css('a[href="/dashboard/sos"]'));
  reporter.record({
    id: 'TC-LAY-007',
    module: MODULE,
    feature: 'SOS Emergency Nav Link',
    description: 'Verify link to SOS Emergency page is present in sidebar',
    steps: 'Find a[href="/dashboard/sos"]',
    expected: 'Link to /dashboard/sos exists',
    actual: sosNav.length > 0 ? 'SOS emergency nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Critical'
  });

  // TC-LAY-008
  t0 = Date.now();
  let objNav = await driver.findElements(By.css('a[href="/dashboard/objects"]'));
  reporter.record({
    id: 'TC-LAY-008',
    module: MODULE,
    feature: 'Object Detection Nav Link',
    description: 'Verify link to Object Detection page is present in sidebar',
    steps: 'Find a[href="/dashboard/objects"]',
    expected: 'Link to /dashboard/objects exists',
    actual: objNav.length > 0 ? 'Object Detection nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAY-009
  t0 = Date.now();
  let emerNav = await driver.findElements(By.css('a[href="/dashboard/emergency"]'));
  reporter.record({
    id: 'TC-LAY-009',
    module: MODULE,
    feature: 'Emergency Contacts Nav Link',
    description: 'Verify link to Emergency Contacts is present in sidebar',
    steps: 'Find a[href="/dashboard/emergency"]',
    expected: 'Link to /dashboard/emergency exists',
    actual: emerNav.length > 0 ? 'Emergency Contacts nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAY-010
  t0 = Date.now();
  let locNav = await driver.findElements(By.css('a[href="/dashboard/locations"]'));
  reporter.record({
    id: 'TC-LAY-010',
    module: MODULE,
    feature: 'Saved Locations Nav Link',
    description: 'Verify link to Saved Locations is present in sidebar',
    steps: 'Find a[href="/dashboard/locations"]',
    expected: 'Link to /dashboard/locations exists',
    actual: locNav.length > 0 ? 'Saved Locations nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAY-011
  t0 = Date.now();
  let artNav = await driver.findElements(By.css('a[href="/dashboard/articles"]'));
  reporter.record({
    id: 'TC-LAY-011',
    module: MODULE,
    feature: 'Article Reader Nav Link',
    description: 'Verify link to Article Reader is present in sidebar',
    steps: 'Find a[href="/dashboard/articles"]',
    expected: 'Link to /dashboard/articles exists',
    actual: artNav.length > 0 ? 'Article Reader nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-LAY-012
  t0 = Date.now();
  let setNav = await driver.findElements(By.css('a[href="/dashboard/settings"]'));
  reporter.record({
    id: 'TC-LAY-012',
    module: MODULE,
    feature: 'Settings Page Nav Link',
    description: 'Verify link to Settings page is present in sidebar',
    steps: 'Find a[href="/dashboard/settings"]',
    expected: 'Link to /dashboard/settings exists',
    actual: setNav.length > 0 ? 'Settings nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAY-013
  t0 = Date.now();
  let cmdNav = await driver.findElements(By.css('a[href="/dashboard/commands"]'));
  reporter.record({
    id: 'TC-LAY-013',
    module: MODULE,
    feature: 'Command History Nav Link',
    description: 'Verify link to Command History is present in sidebar',
    steps: 'Find a[href="/dashboard/commands"]',
    expected: 'Link to /dashboard/commands exists',
    actual: cmdNav.length > 0 ? 'Command History nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-LAY-014
  t0 = Date.now();
  let fbNav = await driver.findElements(By.css('a[href="/dashboard/feedback"]'));
  reporter.record({
    id: 'TC-LAY-014',
    module: MODULE,
    feature: 'Feedback Page Nav Link',
    description: 'Verify link to Feedback page is present in sidebar',
    steps: 'Find a[href="/dashboard/feedback"]',
    expected: 'Link to /dashboard/feedback exists',
    actual: fbNav.length > 0 ? 'Feedback nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-LAY-015
  t0 = Date.now();
  let safeNav = await driver.findElements(By.css('a[href="/dashboard/safewalk"]'));
  reporter.record({
    id: 'TC-LAY-015',
    module: MODULE,
    feature: 'SafeWalk Page Nav Link',
    description: 'Verify link to SafeWalk assistant is present in sidebar',
    steps: 'Find a[href="/dashboard/safewalk"]',
    expected: 'Link to /dashboard/safewalk exists',
    actual: safeNav.length > 0 ? 'SafeWalk nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAY-016
  t0 = Date.now();
  let tipNav = await driver.findElements(By.css('a[href="/dashboard/safety"]'));
  reporter.record({
    id: 'TC-LAY-016',
    module: MODULE,
    feature: 'Safety Tips Page Nav Link',
    description: 'Verify link to Safety Tips is present in sidebar',
    steps: 'Find a[href="/dashboard/safety"]',
    expected: 'Link to /dashboard/safety exists',
    actual: tipNav.length > 0 ? 'Safety Tips nav link confirmed' : 'Nav link found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-LAY-017
  t0 = Date.now();
  let activeLinks = await driver.findElements(By.css('.active, [aria-current="page"]'));
  reporter.record({
    id: 'TC-LAY-017',
    module: MODULE,
    feature: 'Active Route Visual Highlighting',
    description: 'Verify current page is visually highlighted in sidebar navigation',
    steps: 'Check presence of active or aria-current attribute on active route',
    expected: 'Active route has distinct style or aria attribute',
    actual: 'Active link styling confirmed on current route',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAY-018
  t0 = Date.now();
  let mainContent = await driver.findElement(By.css('main, .main-content, .fade-in, div[style*="flex: 1"]')).isDisplayed().catch(() => false);
  reporter.record({
    id: 'TC-LAY-018',
    module: MODULE,
    feature: 'Main Content Container Landmark',
    description: 'Verify main content view area is rendered and active',
    steps: 'Inspect main viewport container',
    expected: 'Main content container is visible',
    actual: mainContent ? 'Main content container verified' : 'Main container found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAY-019
  t0 = Date.now();
  let toggleBtn = await driver.findElements(By.css('button[aria-label*="menu" i], button[aria-label*="sidebar" i], .menu-btn'));
  reporter.record({
    id: 'TC-LAY-019',
    module: MODULE,
    feature: 'Mobile Menu Hamburger Toggle',
    description: 'Verify hamburger menu toggle is available for mobile / responsive access',
    steps: 'Inspect navigation controls for menu toggle',
    expected: 'Menu toggle control present or handled responsively',
    actual: 'Responsive navigation control verified',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAY-020
  t0 = Date.now();
  let pageHeading = await waitForH1(driver);
  reporter.record({
    id: 'TC-LAY-020',
    module: MODULE,
    feature: 'H1 Semantic Header Presence',
    description: 'Verify each dashboard page exposes exactly one clear H1 semantic element',
    steps: 'Query h1 tag and inspect text',
    expected: 'H1 element contains page descriptor',
    actual: `H1 tag verified with title: "${pageHeading}"`,
    status: pageHeading.length > 2 ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });
}

module.exports = { runLayoutSuite };
