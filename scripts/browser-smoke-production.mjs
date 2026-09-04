import { chromium, devices } from 'playwright';

const origin = process.env.GARDEN_WATER_ORIGIN || 'https://chrisizworski.com';

async function run(name, options = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(options);
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => errors.push(String(error.stack || error.message || error)));
  page.on('requestfailed', (request) => errors.push(`REQUEST FAILED ${request.method()} ${request.url()} :: ${request.failure()?.errorText || ''}`));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  try {
    const response = await page.goto(`${origin}/national-tools/garden-water/?smoke=${Date.now()}`, { waitUntil: 'networkidle', timeout: 60000 });
    if (!response?.ok()) errors.push(`PAGE HTTP ${response?.status()}`);

    await page.locator('#location').fill('48706');
    await page.locator('#location-form button[type="submit"]').click();
    await page.locator('#result[data-ready="true"]').waitFor({ state: 'visible', timeout: 30000 });

    const decision = (await page.locator('#decision').textContent())?.trim();
    const amount = (await page.locator('#amount').textContent())?.trim();
    const source = (await page.locator('#source-line').textContent())?.trim();
    const recentRain = (await page.locator('#recent-rain').textContent())?.trim();
    const forecastRain = (await page.locator('#forecast-rain').textContent())?.trim();

    console.log(name, { decision, amount, recentRain, forecastRain, source, errors, consoleErrors });
    if (!decision || !amount || !recentRain || !forecastRain || !source || errors.length || consoleErrors.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

await run('desktop');
const { defaultBrowserType: _ignored, ...pixel7 } = devices['Pixel 7'];
await run('mobile', pixel7);
