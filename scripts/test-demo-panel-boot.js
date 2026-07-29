#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

async function fetchOk(url) {
  return new Promise((resolve) => {
    http
      .get(url, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 400);
      })
      .on('error', () => resolve(false));
  });
}

async function main() {
  const demoOk = await fetchOk('http://127.0.0.1:3344/');
  const healthOk = await fetchOk('http://127.0.0.1:3344/health');
  if (!demoOk || !healthOk) {
    console.error('servers not up', { demoOk, healthOk });
    process.exit(1);
  }

  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    console.log('skip — playwright not installed');
    process.exit(0);
  }

  const browser = await playwright.chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('http://127.0.0.1:3344/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2500);

  const shell = page.locator('#vp-shell');
  const chip = page.locator('#vp-crank-reopen');
  const shellCount = await shell.count();
  const chipCount = await chip.count();
  console.log('initial', { shell: shellCount, chip: chipCount, errors });

  if (shellCount === 0) {
    console.error('FAIL — panel did not boot on demo page');
    if (errors.length) console.error('errors', errors);
    await browser.close();
    process.exit(1);
  }

  await page.locator('#vc-close').click();
  await page.waitForTimeout(500);
  const chipAfterClose = await chip.count();
  console.log('after close', { chip: chipAfterClose });

  if (chipAfterClose === 0) {
    console.error('FAIL — reopen chip missing after close');
    await browser.close();
    process.exit(1);
  }

  await chip.click();
  await page.waitForTimeout(2000);
  const shellAfterReopen = await shell.count();
  const visible =
    shellAfterReopen > 0 ? await shell.first().isVisible().catch(() => false) : false;
  console.log('after chip click', { shell: shellAfterReopen, visible, errors });

  await browser.close();

  if (shellAfterReopen === 0 || !visible) {
    console.error('FAIL — Crank CTA did not reopen panel');
    process.exit(1);
  }
  console.log('ok — demo panel boot + Crank CTA reopen');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
