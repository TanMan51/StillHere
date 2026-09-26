import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await mkdir("screenshots", { recursive: true });
try {
  await page.goto("http://localhost:5173/login");
  await page.locator(".scene-ready").waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), /hackgt/i);
  assert.ok(
    await page
      .locator(".ice-scene canvas")
      .evaluate((canvas) => canvas.width >= innerWidth),
  );
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.locator(".device-card").count(), 0);
  await page
    .locator(".landing-header")
    .getByRole("link", { name: "About us" })
    .click();
  await page
    .getByRole("heading", { name: "About StillHere", exact: true })
    .waitFor();
  assert.ok(page.url().endsWith("#about"));
  await page
    .locator(".landing-header")
    .getByRole("button", { name: "Log in" })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.goto("http://localhost:5173/");
  await page.locator(".scene-ready").waitFor();
  await page
    .getByRole("button", { name: "Motion: off", exact: true })
    .waitFor();
  await page.screenshot({
    path: "screenshots/scene-login-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Motion: off", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Motion: on", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Motion: on", exact: true }).click();
  await page
    .locator(".landing-header")
    .getByRole("button", { name: "Log in" })
    .click();
  await page.getByLabel("Email address").fill("demo@stillhere.example");
  await page.getByLabel("Password", { exact: true }).fill("stillhere-demo");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log in", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Mom's fridge", exact: true })
    .waitFor();
  await page.screenshot({
    path: "screenshots/scene-overview-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "View device status" }).click();
  assert.ok(page.url().endsWith("#device-status"));
  await page.goto("http://localhost:5173/");
  await page
    .locator(".landing-header")
    .getByRole("button", { name: "Log in" })
    .click();
  await page.getByRole("dialog").waitFor();
  assert.equal(
    await page
      .locator(".landing-header")
      .getByRole("link", { name: "Dashboard" })
      .count(),
    0,
  );
  await page.keyboard.press("Escape");
  await page.goto("http://localhost:5173/dashboard");
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `No horizontal overflow at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:5173/dashboard");
  await page
    .getByRole("heading", { name: "Mom's fridge", exact: true })
    .waitFor();
  await page.screenshot({
    path: "screenshots/scene-overview-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await page.getByRole("heading", { name: "StillHere", exact: true }).waitFor();
  await page.screenshot({
    path: "screenshots/scene-login-mobile.png",
    fullPage: true,
  });
  await page
    .locator(".ice-scene canvas")
    .evaluate((canvas) =>
      canvas
        .getContext("webgl")
        .getExtension("WEBGL_lose_context")
        .loseContext(),
    );
  await page.locator(".ice-scene:not(.scene-ready)").waitFor();
  assert.equal(await page.locator(".scene-fallback").isVisible(), true);
  assert.equal(
    await page
      .locator(".landing-header")
      .getByRole("button", { name: "Log in" })
      .isEnabled(),
    true,
  );
  assert.deepEqual(errors, []);
  process.stdout.write(
    "Scene checks passed: WebGL render, reduced motion, toggle, dashboard anchor, responsive layouts, and SVG fallback.\n",
  );
} finally {
  await browser.close();
}
