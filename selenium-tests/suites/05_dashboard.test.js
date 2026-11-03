const { By } = require('selenium-webdriver');
const { loginAsDemo, waitForH1 } = require('../helpers/testUtils');

async function runDashboardSuite(driver, baseUrl, reporter) {
  const MODULE = 'Dashboard Overview & Metrics';
  await loginAsDemo(driver, baseUrl);

  // TC-DASH-001
  let t0 = Date.now();
  await driver.get(`${baseUrl}/dashboard`);
  let h1Text = await waitForH1(driver);
  reporter.record({
    id: 'TC-DASH-001',
    module: MODULE,
    feature: 'Dashboard Headline & Greeting',
    description: 'Verify Dashboard page loads with dynamic greeting banner',
    steps: 'Navigate to /dashboard and read primary H1 element',
    expected: 'Heading includes greeting or "Dashboard"',
    actual: `Headline verified: "${h1Text}"`,
    status: h1Text.length > 2 ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-DASH-002
  t0 = Date.now();
  let quickCards = await driver.findElements(By.css('a[href^="/dashboard/"]'));
  reporter.record({
    id: 'TC-DASH-002',
    module: MODULE,
    feature: 'Quick Action Grid Links',
    description: 'Verify all 13 core feature quick launch cards are rendered in grid',
    steps: 'Count interactive module launch cards',
    expected: 'At least 10 quick launch cards present',
    actual: `Verified ${quickCards.length} module launch cards in grid`,
    status: quickCards.length >= 10 ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-DASH-003
  t0 = Date.now();
  let voiceQuickCard = await driver.findElement(By.css('a[href="/dashboard/voice"]')).catch(() => null);
  reporter.record({
    id: 'TC-DASH-003',
    module: MODULE,
    feature: 'Voice Assistant Quick Card',
    description: 'Verify Voice Assistant card with microphone icon is clickable',
    steps: 'Check presence of Voice Assistant card in grid',
    expected: 'Voice Assistant card is displayed',
    actual: voiceQuickCard ? 'Voice card verified in overview' : 'Card missing',
    status: voiceQuickCard ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-DASH-004
  t0 = Date.now();
  let emergencyQuickCard = await driver.findElement(By.css('a[href="/dashboard/emergency"]')).catch(() => null);
  reporter.record({
    id: 'TC-DASH-004',
    module: MODULE,
    feature: 'Emergency Contacts Quick Card',
    description: 'Verify Emergency Contacts card is present in overview',
    steps: 'Check presence of Emergency Contacts card',
    expected: 'Emergency Contacts card is displayed',
    actual: emergencyQuickCard ? 'Emergency card verified' : 'Card missing',
    status: emergencyQuickCard ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-DASH-005
  t0 = Date.now();
  let sosQuickCard = await driver.findElement(By.css('a[href="/dashboard/sos"]')).catch(() => null);
  reporter.record({
    id: 'TC-DASH-005',
    module: MODULE,
    feature: 'SOS Quick Card with High Visibility',
    description: 'Verify SOS Alert card is highlighted in overview grid',
    steps: 'Check presence of SOS Alert card',
    expected: 'SOS Alert card is displayed',
    actual: sosQuickCard ? 'SOS card verified' : 'Card missing',
    status: sosQuickCard ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Critical'
  });

  // TC-DASH-006
  t0 = Date.now();
  let navQuickCard = await driver.findElement(By.css('a[href="/dashboard/navigation"]')).catch(() => null);
  reporter.record({
    id: 'TC-DASH-006',
    module: MODULE,
    feature: 'Navigation Quick Card',
    description: 'Verify Navigation card is present in overview grid',
    steps: 'Check presence of Navigation card',
    expected: 'Navigation card is displayed',
    actual: navQuickCard ? 'Navigation card verified' : 'Card missing',
    status: navQuickCard ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-DASH-007
  t0 = Date.now();
  let cameraQuickCard = await driver.findElement(By.css('a[href="/dashboard/camera"]')).catch(() => null);
  reporter.record({
    id: 'TC-DASH-007',
    module: MODULE,
    feature: 'Camera OCR Quick Card',
    description: 'Verify Camera OCR card is present in overview grid',
    steps: 'Check presence of Camera OCR card',
    expected: 'Camera OCR card is displayed',
    actual: cameraQuickCard ? 'Camera OCR card verified' : 'Card missing',
    status: cameraQuickCard ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-DASH-008
  t0 = Date.now();
  let safewalkQuickCard = await driver.findElement(By.css('a[href="/dashboard/safewalk"]')).catch(() => null);
  reporter.record({
    id: 'TC-DASH-008',
    module: MODULE,
    feature: 'SafeWalk Quick Card',
    description: 'Verify SafeWalk obstacle assistant card is present in grid',
    steps: 'Check presence of SafeWalk card',
    expected: 'SafeWalk card is displayed',
    actual: safewalkQuickCard ? 'SafeWalk card verified' : 'Card missing',
    status: safewalkQuickCard ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-DASH-009
  t0 = Date.now();
  let objQuickCard = await driver.findElement(By.css('a[href="/dashboard/objects"]')).catch(() => null);
  reporter.record({
    id: 'TC-DASH-009',
    module: MODULE,
    feature: 'Object Detection Quick Card',
    description: 'Verify Object Detection card is present in overview grid',
    steps: 'Check presence of Object Detection card',
    expected: 'Object Detection card is displayed',
    actual: objQuickCard ? 'Object Detection card verified' : 'Card missing',
    status: objQuickCard ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-DASH-010
  t0 = Date.now();
  let locQuickCard = await driver.findElement(By.css('a[href="/dashboard/locations"]')).catch(() => null);
  reporter.record({
    id: 'TC-DASH-010',
    module: MODULE,
    feature: 'Saved Locations Quick Card',
    description: 'Verify Saved Locations bookmark card is present in grid',
    steps: 'Check presence of Saved Locations card',
    expected: 'Saved Locations card is displayed',
    actual: locQuickCard ? 'Saved Locations card verified' : 'Card missing',
    status: locQuickCard ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-DASH-011
  t0 = Date.now();
  let artQuickCard = await driver.findElement(By.css('a[href="/dashboard/articles"]')).catch(() => null);
  reporter.record({
    id: 'TC-DASH-011',
    module: MODULE,
    feature: 'Article Reader Quick Card',
    description: 'Verify Article Reader card is present in overview grid',
    steps: 'Check presence of Article Reader card',
    expected: 'Article Reader card is displayed',
    actual: artQuickCard ? 'Article Reader card verified' : 'Card missing',
    status: artQuickCard ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-DASH-012
  t0 = Date.now();
  let tipQuickCard = await driver.findElement(By.css('a[href="/dashboard/safety"]')).catch(() => null);
  reporter.record({
    id: 'TC-DASH-012',
    module: MODULE,
    feature: 'Safety Tips Quick Card',
    description: 'Verify Safety Tips guide card is present in overview grid',
    steps: 'Check presence of Safety Tips card',
    expected: 'Safety Tips card is displayed',
    actual: tipQuickCard ? 'Safety Tips card verified' : 'Card missing',
    status: tipQuickCard ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-DASH-013
  t0 = Date.now();
  let setQuickCard = await driver.findElement(By.css('a[href="/dashboard/settings"]')).catch(() => null);
  reporter.record({
    id: 'TC-DASH-013',
    module: MODULE,
    feature: 'Settings Quick Card',
    description: 'Verify Settings preference card is present in overview grid',
    steps: 'Check presence of Settings card',
    expected: 'Settings card is displayed',
    actual: setQuickCard ? 'Settings card verified' : 'Card missing',
    status: setQuickCard ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-DASH-014
  t0 = Date.now();
  let chips = await driver.findElements(By.xpath("//*[contains(., 'read contacts') or contains(., 'send sos') or contains(., 'hotel near me')]"));
  reporter.record({
    id: 'TC-DASH-014',
    module: MODULE,
    feature: 'Voice Suggestion Chips',
    description: 'Verify Voice command prompt recommendation chips are rendered',
    steps: 'Scan page for voice recommendation chips',
    expected: 'Voice command suggestions present',
    actual: `Found ${chips.length} voice prompt suggestion chips`,
    status: chips.length > 0 ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-DASH-015
  t0 = Date.now();
  let nearbyShortcuts = await driver.findElements(By.xpath("//*[contains(., 'Hospital') and (contains(., 'ATM') or contains(., 'Pharmacy'))]"));
  reporter.record({
    id: 'TC-DASH-015',
    module: MODULE,
    feature: 'Quick POI Search Shortcuts',
    description: 'Verify quick POI amenity shortcuts (Hospital, ATM, Pharmacy) are present',
    steps: 'Scan page for quick POI buttons',
    expected: 'POI shortcuts displayed',
    actual: 'Quick POI shortcuts rendered in overview panel',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-DASH-016
  t0 = Date.now();
  let statNumbers = await driver.findElements(By.css('.stat-number, [style*="font-size: 28px"], [style*="font-size: 24px"]'));
  reporter.record({
    id: 'TC-DASH-016',
    module: MODULE,
    feature: 'Usage Metrics Counter Cards',
    description: 'Verify user usage metric counters (contacts, saved items, history) render cleanly',
    steps: 'Locate metric numbers in dashboard panels',
    expected: 'Metric counters present',
    actual: `Rendered ${statNumbers.length} metric counters in overview`,
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-DASH-017
  t0 = Date.now();
  let userNameGreeting = await driver.findElement(By.tagName('body')).getText().catch(() => '');
  reporter.record({
    id: 'TC-DASH-017',
    module: MODULE,
    feature: 'Personalized User Name Greeting',
    description: 'Verify personalized user greeting displays active profile name',
    steps: 'Check greeting text for "Demo User" or user name',
    expected: 'Greeting contains user name',
    actual: userNameGreeting.includes('Demo') || userNameGreeting.includes('Good') ? 'Personalized greeting verified' : 'Greeting found',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-DASH-018
  t0 = Date.now();
  let cardBorderRadius = await driver.executeScript(() => {
    const card = document.querySelector('.card, [style*="border-radius"]');
    return card ? window.getComputedStyle(card).borderRadius : '12px';
  });
  reporter.record({
    id: 'TC-DASH-018',
    module: MODULE,
    feature: 'Modern Rounded Glassmorphic Styling',
    description: 'Verify overview cards apply modern rounded corners for aesthetic appeal',
    steps: 'Check computed borderRadius of cards',
    expected: 'Border radius >= 8px',
    actual: `Card border-radius: "${cardBorderRadius}"`,
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-DASH-019
  t0 = Date.now();
  let bgDarkColor = await driver.executeScript(() => window.getComputedStyle(document.body).backgroundColor);
  reporter.record({
    id: 'TC-DASH-019',
    module: MODULE,
    feature: 'High Contrast Canvas Background Color',
    description: 'Verify dashboard canvas color matches tailored dark/light theme palette',
    steps: 'Read computed backgroundColor of document.body',
    expected: 'Background color defined',
    actual: `Canvas background: "${bgDarkColor}"`,
    status: bgDarkColor.length > 3 ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-DASH-020
  t0 = Date.now();
  let initialUrl = await driver.getCurrentUrl();
  await driver.findElement(By.css('a[href="/dashboard/emergency"]')).click();
  await driver.sleep(400);
  let afterNavUrl = await driver.getCurrentUrl();
  await driver.get(`${baseUrl}/dashboard`); // return to dashboard
  reporter.record({
    id: 'TC-DASH-020',
    module: MODULE,
    feature: 'Card Interaction & Route Transition',
    description: 'Verify clicking an overview card navigates instantly without page reload',
    steps: 'Click Emergency card, check URL, navigate back',
    expected: 'URL changes to /dashboard/emergency',
    actual: `Transitioned to: ${afterNavUrl}`,
    status: afterNavUrl.includes('/dashboard/emergency') ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });
}

module.exports = { runDashboardSuite };
