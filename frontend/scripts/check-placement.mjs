import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Placement guide: type ideas, get a ranking with no questions, and correct a guess by tapping.
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://localhost:5173/placement");
  await page.getByLabel("Email address").fill("demo@stillhere.example");
  await page.getByLabel("Password", { exact: true }).fill("stillhere-demo");
  await page.getByRole("dialog").getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("button", { name: "Rank my ideas" }).click();
  await page.getByRole("alert").filter({ hasText: "Enter at least one idea" }).waitFor();
  const names = ["Bookshelf", "Front door", "Walker", "TV remote"];
  for (let i = 0; i < names.length; i++)
    await page.getByLabel(`Idea ${i + 1}`, { exact: true }).fill(names[i]);
  await page.getByLabel("Lives with others").check();
  await page.getByRole("button", { name: "Rank my ideas" }).click();
  await page.getByRole("heading", { name: "Best spot: Walker" }).waitFor();
  assert.equal(await page.locator(".placement-results > li").count(), 4);
  assert.equal(
    await page.locator(".placement-results").getByText("Not a good spot", { exact: true }).count(),
    2,
  );
  assert.ok(await page.locator(".placement-podium svg").isVisible());
  const walker = page.locator(".placement-results > li", { hasText: "Walker" });
  await walker.getByRole("button", { name: /Moves when used/ }).click();
  await page.getByRole("heading", { name: "Best spot: Front door" }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/placement-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("placement check passed");
} finally {
  await browser.close();
}
