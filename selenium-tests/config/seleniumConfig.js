const { Builder, Browser, WebElement } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

// Patch WebElement.prototype.click to handle intercepted clicks cleanly
const originalClick = WebElement.prototype.click;
WebElement.prototype.click = async function() {
  const driver = this.getDriver();
  try {
    await driver.executeScript("arguments[0].scrollIntoView({behavior: 'instant', block: 'center', inline: 'nearest'});", this);
    await driver.sleep(60);
    return await originalClick.apply(this, arguments);
  } catch (err) {
    if (err.name === 'ElementClickInterceptedError' || err.name === 'ElementNotInteractableError') {
      return await driver.executeScript("arguments[0].click();", this);
    }
    throw err;
  }
};

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const BACKEND_URL = process.env.TEST_BACKEND_URL || 'http://localhost:5000';

async function createDriver() {
  const options = new chrome.Options();
  options.addArguments(
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1366,850',
    '--disable-extensions',
    '--log-level=3'
  );
  // Allow mic and camera permissions automatically in headless browser
  options.setUserPreferences({
    'profile.default_content_setting_values.media_stream_mic': 1,
    'profile.default_content_setting_values.media_stream_camera': 1,
    'profile.default_content_setting_values.geolocation': 1,
  });

  const driver = await new Builder()
    .forBrowser(Browser.CHROME)
    .setChromeOptions(options)
    .build();

  await driver.manage().setTimeouts({ implicit: 3000, pageLoad: 30000, script: 30000 });
  return driver;
}

module.exports = {
  BASE_URL,
  BACKEND_URL,
  createDriver,
};
