const { By, until } = require('selenium-webdriver');

async function waitForUrl(driver, regex, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const url = await driver.getCurrentUrl();
    if (regex.test(url)) return url;
    await driver.sleep(150);
  }
  const finalUrl = await driver.getCurrentUrl();
  throw new Error(`Timeout waiting for URL matching ${regex}. Current URL: ${finalUrl}`);
}

async function loginAsDemo(driver, baseUrl) {
  // First check if already logged in and on a dashboard page
  try {
    const curUrl = await driver.getCurrentUrl();
    if (curUrl.includes('/dashboard')) {
      const hasToken = await driver.executeScript(() => {
        const u = localStorage.getItem('visionguide_user');
        return !!(u && JSON.parse(u).token);
      }).catch(() => false);
      if (hasToken) {
        return; // Already authenticated and on dashboard!
      }
    }
  } catch {}

  // Navigate to /dashboard directly
  await driver.get(`${baseUrl}/dashboard`);
  await driver.sleep(200);

  // Check if we got redirected to /signin (meaning no valid token in localStorage)
  let curUrl = await driver.getCurrentUrl();
  if (!curUrl.includes('/dashboard')) {
    // Inject the valid demo user token into localStorage
    await driver.executeScript(() => {
      localStorage.setItem('visionguide_user', JSON.stringify({
        id: '165e7bba-4cae-4c12-adcd-4e13c517ec8e',
        name: 'Demo User',
        email: 'demouser2026@visionguide.ai',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxNjVlN2JiYS00Y2FlLTRjMTItYWRjZC00ZTEzYzUxN2VjOGUiLCJlbWFpbCI6ImRlbW91c2VyMjAyNkB2aXNpb25ndWlkZS5haSIsImlhdCI6MTc5Mjk1NDk1NywiZXhwIjoxNzk1NTQ2OTU3fQ.G72bJ9di-NVVdYwhD-bxzIjHk6wfahJAPmUe_Hyw0ew'
      }));
    });
    // Now navigate to /dashboard with token present
    await driver.get(`${baseUrl}/dashboard`);
    await waitForUrl(driver, /dashboard/, 10000);
  }

  // Ensure primary layout is rendered
  await waitForH1(driver, 6000);
}

async function waitForH1(driver, timeout = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const text = await driver.executeScript(() => {
        const h1s = Array.from(document.querySelectorAll('h1'));
        for (const h of h1s) {
          const t = (h.innerText || h.textContent || '').trim();
          if (t.length > 0) return t;
        }
        return '';
      });
      if (text && text.length > 0) return text;
    } catch {}
    await driver.sleep(100);
  }
  return '';
}

async function waitForSubtitle(driver, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const text = await driver.executeScript(() => {
        const ps = Array.from(document.querySelectorAll('.page-header p, p, header p, .header p'));
        for (const p of ps) {
          const t = (p.innerText || p.textContent || '').trim();
          if (t.length > 5) return t;
        }
        return '';
      });
      if (text && text.length > 5) return text;
    } catch {}
    await driver.sleep(100);
  }
  return '';
}

async function findElementSafe(driver, by, timeout = 5000) {
  try {
    const el = await driver.wait(until.elementLocated(by), timeout);
    await driver.wait(until.elementIsVisible(el), timeout);
    return el;
  } catch {
    return null;
  }
}

module.exports = {
  waitForUrl,
  loginAsDemo,
  findElementSafe,
  waitForH1,
  waitForSubtitle,
};
