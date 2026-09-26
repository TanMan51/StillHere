import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://localhost:5173/contacts");
  await page.getByRole("heading", { name: "Log in", exact: true }).waitFor();
  assert.ok(page.url().endsWith("/login"));
  assert.equal(
    await page.getByRole("navigation", { name: "Main navigation" }).count(),
    0,
  );
  await page.getByLabel("Email address").fill("wrong@example.com");
  await page.getByLabel("Password", { exact: true }).fill("invalid");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log in", exact: true })
    .click();
  await page.getByRole("alert").waitFor();
  await page.getByLabel("Email address").fill("demo@stillhere.example");
  await page.getByLabel("Password", { exact: true }).fill("stillhere-demo");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log in", exact: true })
    .click();
  await page.getByRole("heading", { name: "Contacts", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Contacts", exact: true }).waitFor();
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...sessionStorage, ...localStorage }),
  );
  assert.ok(
    !stored.includes('stillhere-demo"') &&
      !stored.includes("demo@stillhere.example"),
  );
  await page.getByRole("button", { name: "Log out", exact: true }).click();

  await page.getByRole("heading", { name: "StillHere", exact: true }).waitFor();
  await page.reload();
  await page
    .getByRole("button", { name: "Log in", exact: false })
    .first()
    .click();
  await page.getByRole("heading", { name: "Log in", exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Password", { exact: true }).inputValue(),
    "",
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({
    path: "screenshots/login-mobile.png",
    fullPage: true,
  });
  await page.goto("http://localhost:5173/devices/fridge-1");
  await page.getByRole("heading", { name: "Log in", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  process.stdout.write(
    "Login checks passed: invalid credentials, deep link return, refresh, logout, no stored credentials, and mobile layout.\n",
  );
} finally {
  await browser.close();
}
