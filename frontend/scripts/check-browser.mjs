import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Run after npm run dev. Uses installed Chrome; set BROWSER_CHANNEL to override.
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir("screenshots", { recursive: true });
try {
  await page.goto("http://localhost:5173");
  await page.getByRole("heading", { name: "Around the home" }).waitFor();
  await page.getByRole("heading", { name: "Mom's fridge" }).waitFor();
  await page.screenshot({
    path: "screenshots/overview-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: /Mom's fridge/ }).click();
  await page.getByRole("heading", { name: "The everyday rhythm" }).waitFor();
  await page.locator(".recharts-bar-rectangle").first().waitFor();
  await page.getByLabel("Device name").fill("Kitchen fridge");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByRole("heading", { name: "Kitchen fridge" }).waitFor();
  await page
    .getByRole("button", { name: "I checked in · mark handled" })
    .click();
  await page.getByRole("heading", { name: "Activity looks normal" }).waitFor();
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Browser Test");
  await page.getByLabel("Phone number").fill("+14045550124");
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  await page.getByText("Browser Test", { exact: true }).waitFor();
  await page
    .locator(".contact")
    .filter({ hasText: "Browser Test" })
    .getByRole("button", { name: "Remove" })
    .click();
  await page
    .getByText("Browser Test", { exact: true })
    .waitFor({ state: "detached" });
  await page.getByRole("link", { name: "Setup", exact: true }).click();
  await page
    .getByRole("heading", { name: "Your home, a scan away." })
    .waitFor();
  assert.equal(await page.locator(".setup svg").count(), 1);
  await page.goto("http://localhost:5173/demo");
  await page.getByRole("button", { name: "Enable fast clock (1440×)" }).click();
  await page.getByRole("button", { name: "Disable fast clock" }).waitFor();
  await page.getByRole("button", { name: "Load a normal week" }).click();
  await page.getByText("42 events loaded", { exact: true }).waitFor();
  await page.goto("http://localhost:5173");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Mom's fridge" }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile page must not overflow horizontally",
  );
  await page.screenshot({
    path: "screenshots/overview-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: /Mom's fridge/ }).click();
  await page.getByRole("heading", { name: "The everyday rhythm" }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile detail must not overflow horizontally",
  );
  await page.screenshot({
    path: "screenshots/detail-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log(
    "Browser checks passed: overview, settings, resolve, contacts, QR, demo, mobile layout.",
  );
} finally {
  await browser.close();
}
