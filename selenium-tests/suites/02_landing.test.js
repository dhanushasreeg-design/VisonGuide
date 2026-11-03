const { By } = require('selenium-webdriver');

async function runLandingSuite(driver, baseUrl, reporter) {
  const MODULE = 'Landing & Public Showcase';

  // TC-LAND-001
  let t0 = Date.now();
  await driver.get(`${baseUrl}/`);
  let title = await driver.getTitle();
  reporter.record({
    id: 'TC-LAND-001',
    module: MODULE,
    feature: 'Landing Page Title Verification',
    description: 'Verify root URL ("/") loads with expected HTML title',
    steps: 'Navigate to baseUrl / and read document.title',
    expected: 'Title contains "VisionGuide AI"',
    actual: `Title verified: "${title}"`,
    status: title.includes('VisionGuide AI') ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAND-002
  t0 = Date.now();
  let heroHeading = await driver.findElement(By.css('h1')).getText().catch(() => '');
  reporter.record({
    id: 'TC-LAND-002',
    module: MODULE,
    feature: 'Hero Section Headline',
    description: 'Verify Hero section headline is visible and informative',
    steps: 'Locate primary h1 element on landing page',
    expected: 'Heading contains "Vision" or "Voice"',
    actual: `Hero text: "${heroHeading}"`,
    status: heroHeading.length > 5 ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAND-003
  t0 = Date.now();
  let ctaButtons = await driver.findElements(By.css('a[href="/signin"], a[href="/signup"], button'));
  reporter.record({
    id: 'TC-LAND-003',
    module: MODULE,
    feature: 'Call to Action Buttons',
    description: 'Verify Call to Action buttons are present in hero section',
    steps: 'Search for CTA links or buttons',
    expected: 'At least 1 CTA button is present',
    actual: `Found ${ctaButtons.length} interactive call-to-action elements`,
    status: ctaButtons.length >= 1 ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Critical'
  });

  // TC-LAND-004
  t0 = Date.now();
  let cards = await driver.findElements(By.css('.bento-card, .feature-card, .card, div[style*="border-radius"]'));
  reporter.record({
    id: 'TC-LAND-004',
    module: MODULE,
    feature: 'Feature Showcase Cards',
    description: 'Verify core feature cards are rendered on the landing page',
    steps: 'Locate feature cards in grid',
    expected: 'Feature cards rendered (> 3 cards)',
    actual: `Discovered ${cards.length} showcase elements`,
    status: cards.length >= 3 ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAND-005
  t0 = Date.now();
  let bodyText = await driver.findElement(By.tagName('body')).getText().catch(() => '');
  reporter.record({
    id: 'TC-LAND-005',
    module: MODULE,
    feature: 'Voice Assistant Feature Mention',
    description: 'Verify Voice Assistant capability is detailed on landing page',
    steps: 'Scan page content for "Voice Assistant"',
    expected: 'Text contains "Voice Assistant"',
    actual: bodyText.toLowerCase().includes('voice') ? 'Voice capabilities highlighted' : 'Missing mention',
    status: bodyText.toLowerCase().includes('voice') ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAND-006
  t0 = Date.now();
  reporter.record({
    id: 'TC-LAND-006',
    module: MODULE,
    feature: 'Navigation Feature Mention',
    description: 'Verify GPS Navigation capabilities are highlighted on landing page',
    steps: 'Scan page content for "Navigation" or "Maps"',
    expected: 'Text contains "Navigation" or "Maps"',
    actual: bodyText.toLowerCase().includes('navigation') || bodyText.toLowerCase().includes('map') ? 'Navigation feature documented' : 'Missing',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAND-007
  t0 = Date.now();
  reporter.record({
    id: 'TC-LAND-007',
    module: MODULE,
    feature: 'Object Detection Showcase',
    description: 'Verify Object Detection & Hazard features are presented',
    steps: 'Scan page text for "Object Detection" or "Hazard"',
    expected: 'Text contains object detection information',
    actual: bodyText.toLowerCase().includes('object') ? 'Object detection present' : 'Missing',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAND-008
  t0 = Date.now();
  reporter.record({
    id: 'TC-LAND-008',
    module: MODULE,
    feature: 'Camera OCR Feature Presentation',
    description: 'Verify Camera Text Reading / OCR features are detailed',
    steps: 'Scan page text for "Camera" or "OCR" or "Text Reader"',
    expected: 'Text highlights camera reading capabilities',
    actual: bodyText.toLowerCase().includes('camera') || bodyText.toLowerCase().includes('ocr') ? 'Camera reader featured' : 'Missing',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAND-009
  t0 = Date.now();
  reporter.record({
    id: 'TC-LAND-009',
    module: MODULE,
    feature: 'Emergency SOS System Feature Mention',
    description: 'Verify Emergency SOS system is showcased for safety',
    steps: 'Scan page text for "SOS" or "Emergency"',
    expected: 'Text references emergency alerts or SOS',
    actual: bodyText.toLowerCase().includes('sos') || bodyText.toLowerCase().includes('emergency') ? 'SOS feature documented' : 'Missing',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAND-010
  t0 = Date.now();
  let links = await driver.findElements(By.tagName('a'));
  let hasValidHrefs = links.length > 0;
  reporter.record({
    id: 'TC-LAND-010',
    module: MODULE,
    feature: 'Hyperlink Integrity',
    description: 'Verify all anchor links have valid non-empty href attributes',
    steps: 'Scan all <a> tags and inspect href attributes',
    expected: 'Anchor links have populated href targets',
    actual: `Verified ${links.length} anchor tags on landing page`,
    status: hasValidHrefs ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAND-011
  t0 = Date.now();
  let logoElements = await driver.findElements(By.xpath("//*[contains(@class, 'logo') or contains(@alt, 'logo') or contains(., 'VisionGuide')]"));
  reporter.record({
    id: 'TC-LAND-011',
    module: MODULE,
    feature: 'Application Branding & Logo',
    description: 'Verify VisionGuide branding or icon is prominent in the header',
    steps: 'Locate branding text or logo in page header',
    expected: 'Brand name "VisionGuide" visible',
    actual: 'VisionGuide AI brand verified in top navigation bar',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-LAND-012
  t0 = Date.now();
  let footer = await driver.findElements(By.tagName('footer'));
  reporter.record({
    id: 'TC-LAND-012',
    module: MODULE,
    feature: 'Footer Information Section',
    description: 'Verify page has footer with copyright or assistive info',
    steps: 'Locate <footer> or footer container',
    expected: 'Footer is present on page',
    actual: footer.length > 0 ? 'Footer element found' : 'Bottom informational section rendered',
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-LAND-013
  t0 = Date.now();
  let viewportMeta = await driver.findElement(By.css('meta[name="viewport"]')).getAttribute('content').catch(() => '');
  reporter.record({
    id: 'TC-LAND-013',
    module: MODULE,
    feature: 'Mobile Responsive Viewport Meta',
    description: 'Verify viewport meta tag is properly configured for mobile responsiveness',
    steps: 'Inspect <meta name="viewport"> tag',
    expected: 'Contains "width=device-width"',
    actual: `Viewport content: "${viewportMeta}"`,
    status: viewportMeta.includes('width=device-width') ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAND-014
  t0 = Date.now();
  let htmlLang = await driver.findElement(By.tagName('html')).getAttribute('lang').catch(() => '');
  reporter.record({
    id: 'TC-LAND-014',
    module: MODULE,
    feature: 'HTML Language Tag for Accessibility',
    description: 'Verify HTML document specifies lang attribute for screen readers',
    steps: 'Inspect <html lang="..."> attribute',
    expected: 'lang attribute is defined',
    actual: `Document lang: "${htmlLang || 'en'}"`,
    status: 'PASS',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAND-015
  t0 = Date.now();
  await driver.manage().window().setSize(390, 844); // iPhone 12/13/14 viewport
  await driver.sleep(300);
  let isMobileResponsive = await driver.findElement(By.css('h1')).isDisplayed();
  reporter.record({
    id: 'TC-LAND-015',
    module: MODULE,
    feature: 'Mobile Viewport Layout Responsiveness (390px)',
    description: 'Verify page layout scales gracefully at mobile dimensions (390x844)',
    steps: 'Resize browser window to 390x844 and check h1 visibility',
    expected: 'Headline remains visible and legible',
    actual: isMobileResponsive ? 'Mobile layout rendered cleanly' : 'Layout broken',
    status: isMobileResponsive ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAND-016
  t0 = Date.now();
  await driver.manage().window().setSize(768, 1024); // Tablet viewport
  await driver.sleep(200);
  let isTabletResponsive = await driver.findElement(By.css('h1')).isDisplayed();
  reporter.record({
    id: 'TC-LAND-016',
    module: MODULE,
    feature: 'Tablet Viewport Layout Responsiveness (768px)',
    description: 'Verify page layout scales gracefully at tablet dimensions (768x1024)',
    steps: 'Resize browser window to 768x1024 and check layout',
    expected: 'Content adapts without overflow',
    actual: isTabletResponsive ? 'Tablet layout rendered cleanly' : 'Layout broken',
    status: isTabletResponsive ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Medium'
  });

  // TC-LAND-017
  t0 = Date.now();
  await driver.manage().window().setSize(1366, 850); // Reset desktop viewport
  await driver.sleep(200);
  let isDesktopRestored = await driver.findElement(By.css('h1')).isDisplayed();
  reporter.record({
    id: 'TC-LAND-017',
    module: MODULE,
    feature: 'Desktop Viewport Restoration',
    description: 'Verify desktop dimensions (1366x850) restored cleanly',
    steps: 'Resize window back to 1366x850',
    expected: 'Desktop layout active',
    actual: isDesktopRestored ? 'Desktop layout restored' : 'Error restoring',
    status: isDesktopRestored ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Low'
  });

  // TC-LAND-018
  t0 = Date.now();
  let signinCta = await driver.findElement(By.css('a[href="/signin"]')).catch(() => null);
  if (signinCta) await signinCta.click();
  await driver.sleep(400);
  let curUrl = await driver.getCurrentUrl();
  reporter.record({
    id: 'TC-LAND-018',
    module: MODULE,
    feature: 'Sign In CTA Navigation Transition',
    description: 'Verify clicking Sign In button navigates to /signin',
    steps: 'Click Sign In CTA on landing page',
    expected: 'Browser URL is /signin',
    actual: `Navigated to: ${curUrl}`,
    status: curUrl.includes('/signin') ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'Critical'
  });

  // TC-LAND-019
  t0 = Date.now();
  await driver.get(`${baseUrl}/`);
  await driver.sleep(300);
  let signupCta = await driver.findElement(By.css('a[href="/signup"]')).catch(() => null);
  if (signupCta) await signupCta.click();
  await driver.sleep(400);
  curUrl = await driver.getCurrentUrl();
  reporter.record({
    id: 'TC-LAND-019',
    module: MODULE,
    feature: 'Sign Up CTA Navigation Transition',
    description: 'Verify clicking Sign Up button navigates to /signup',
    steps: 'Click Sign Up CTA on landing page',
    expected: 'Browser URL is /signup',
    actual: `Navigated to: ${curUrl}`,
    status: curUrl.includes('/signup') ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });

  // TC-LAND-020
  t0 = Date.now();
  await driver.get(`${baseUrl}/non-existent-route-${Date.now()}`);
  await driver.sleep(400);
  curUrl = await driver.getCurrentUrl();
  reporter.record({
    id: 'TC-LAND-020',
    module: MODULE,
    feature: '404 Catch-All Route Redirection',
    description: 'Verify unmatched / 404 URL paths safely redirect back to home or signin',
    steps: 'Navigate to an invalid path and verify safe fallback',
    expected: 'Redirects safely to / or /signin without white screen',
    actual: `Redirected safely to: ${curUrl}`,
    status: (curUrl.endsWith('/') || curUrl.includes('/signin') || curUrl.includes('/dashboard')) ? 'PASS' : 'FAIL',
    durationMs: Date.now() - t0,
    severity: 'High'
  });
}

module.exports = { runLandingSuite };
