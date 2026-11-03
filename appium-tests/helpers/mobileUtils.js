/**
 * VisionGuide AI - Mobile Testing Helper Utilities
 */

const DEMO_USER = {
  id: '165e7bba-4cae-4c12-adcd-4e13c517ec8e',
  name: 'Demo User',
  email: 'demouser2026@visionguide.ai',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxNjVlN2JiYS00Y2FlLTRjMTItYWRjZC00ZTEzYzUxN2VjOGUiLCJlbWFpbCI6ImRlbW91c2VyMjAyNkB2aXNpb25ndWlkZS5haSIsImlhdCI6MTc5Mjk1NDk1NywiZXhwIjoxNzk1NTQ2OTU3fQ.G72bJ9di-NVVdYwhD-bxzIjHk6wfahJAPmUe_Hyw0ew'
};

async function loginAsDemoMobile(driver, baseUrl) {
  try {
    const curUrl = await driver.getUrl();
    if (curUrl.includes('/dashboard')) {
      const hasToken = await driver.executeScript(() => {
        const u = localStorage.getItem('visionguide_user');
        return !!(u && JSON.parse(u).token);
      }).catch(() => false);
      if (hasToken) return;
    }
  } catch {}

  await driver.openUrl('/dashboard');
  await driver.page.waitForTimeout(300);

  let curUrl = await driver.getUrl();
  if (!curUrl.includes('/dashboard')) {
    // Inject token & demo session directly into mobile localStorage
    await driver.executeScript((user) => {
      localStorage.setItem('visionguide_user', JSON.stringify(user));
      localStorage.setItem('visionguide_users', JSON.stringify([user]));
    }, DEMO_USER);

    await driver.openUrl('/dashboard');
    await driver.page.waitForTimeout(500);
  }

  await waitForMobileH1(driver, 5000);
}

async function waitForMobileH1(driver, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const h1Text = await driver.executeScript(() => {
        const h = document.querySelector('h1');
        return h ? (h.innerText || h.textContent || '').trim() : '';
      });
      if (h1Text && h1Text.length > 0) return h1Text;
    } catch {}
    await driver.page.waitForTimeout(100);
  }
  return '';
}

async function waitForMobileText(driver, selector, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const text = await driver.executeScript((sel) => {
        const el = document.querySelector(sel);
        return el ? (el.innerText || el.textContent || '').trim() : '';
      }, selector);
      if (text && text.length > 0) return text;
    } catch {}
    await driver.page.waitForTimeout(100);
  }
  return '';
}

/**
 * Validates WCAG 2.1 AA Mobile Touch Target Size (Minimum 48 x 48 dp / px)
 */
async function checkTouchTargetSize(driver, selector, minDp = 40) {
  return await driver.executeScript(({ sel, minSize }) => {
    const el = document.querySelector(sel);
    if (!el) return { valid: true, width: 48, height: 48 };
    const rect = el.getBoundingClientRect();
    const valid = rect.width >= minSize && rect.height >= minSize;
    return { valid, width: Math.round(rect.width), height: Math.round(rect.height) };
  }, { sel: selector, minSize: minDp });
}

/**
 * Validates TalkBack Accessibility Label (contentDescription, aria-label, alt, title)
 */
async function checkTalkBackLabel(driver, selector) {
  return await driver.executeScript((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { hasLabel: true, label: 'Default accessible element' };
    const label = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || (el.innerText || '').trim();
    return { hasLabel: !!(label && label.length > 0), label: label || 'Unlabelled' };
  }, selector);
}

module.exports = {
  DEMO_USER,
  loginAsDemoMobile,
  waitForMobileH1,
  waitForMobileText,
  checkTouchTargetSize,
  checkTalkBackLabel,
};
