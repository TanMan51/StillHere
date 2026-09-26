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
const yes = () =>
  page.getByRole("button", { name: "Yes", exact: true }).click();
const no = () =>
  page.getByRole("button", { name: "No / not sure", exact: true }).click();
try {
  await page.goto("http://localhost:5173/dashboard");
  await page.getByLabel("Email address").fill("demo@stillhere.example");
  await page.getByLabel("Password", { exact: true }).fill("stillhere-demo");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Log in", exact: true })
    .click();
  await page.getByRole("button", { name: "Help me choose a spot" }).click();
  await page.getByRole("button", { name: "Compare my ideas" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Enter at least one idea" })
    .waitFor();
  const names = [
    "Personal drawer",
    "Shared door",
    "Stationary shelf",
    "Loose spot",
    "Rarely used drawer",
  ];
  for (let i = 0; i < names.length; i++)
    await page.getByLabel(`Idea ${i + 1}`, { exact: true }).fill(names[i]);
  await page.getByRole("button", { name: "Compare my ideas" }).click();
  await yes();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page
    .getByRole("heading", {
      name: "Can the tracker stay securely attached here?",
    })
    .waitFor();
  await yes();
  await yes();
  await yes();
  await yes();
  await yes();
  await yes();
  await yes();
  await no();
  await yes();
  await no();
  await no();
  await yes();
  await yes();
  await no();
  await page.getByRole("heading", { name: "Placement results" }).waitFor();
  assert.equal(await page.locator(".placement-results > li").count(), 5);
  assert.match(
    await page.locator(".placement-results > li").first().innerText(),
    /Personal drawer.*Recommended placement/s,
  );
  assert.equal(
    await page.getByText("Reconsider this spot", { exact: true }).count(),
    3,
  );
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({
    path: "screenshots/placement-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit my ideas" }).click();
  assert.equal(
    await page.getByLabel("Idea 1", { exact: true }).inputValue(),
    names[0],
  );
  for (let i = 1; i < 5; i++)
    await page.getByLabel(`Idea ${i + 1}`, { exact: true }).fill("");
  await page.getByLabel("Idea 2", { exact: true }).fill(" personal drawer ");
  await page.getByRole("button", { name: "Compare my ideas" }).click();
  await page.getByRole("alert").filter({ hasText: "different name" }).waitFor();
  await page.getByLabel("Idea 2", { exact: true }).fill("");
  await page.getByRole("button", { name: "Compare my ideas" }).click();
  await no();
  await page
    .getByRole("heading", { name: "Try a different set of spots" })
    .waitFor();
  await page.getByRole("button", { name: "Review last answer" }).click();
  await yes();
  await yes();
  await yes();
  await yes();
  await page.getByRole("heading", { name: "Recommended placements" }).waitFor();
  await page.getByRole("link", { name: "Setup", exact: true }).click();
  await page.getByRole("button", { name: "Help me choose a spot" }).click();
  await page
    .getByRole("heading", { name: "Where could your tracker go?" })
    .waitFor();
  await page.getByLabel("Idea 1", { exact: true }).fill("Fridge");
  await page.getByLabel("Idea 2", { exact: true }).fill("Drawer");
  await page.getByRole("button", { name: "Compare my ideas" }).click();
  for (let i = 0; i < 8; i++) await yes();
  await page
    .getByRole("heading", { name: "Placement context", exact: true })
    .waitFor();
  await page
    .getByLabel("What routine do you want to monitor?")
    .fill("Preparing breakfast");
  for (const name of ["Fridge", "Drawer"]) {
    await page
      .getByLabel(`How and when is ${name} used?`)
      .fill("Used each morning for breakfast");
    await page.getByLabel(`How closely does ${name} match`).selectOption("2");
    await page
      .getByLabel(`How consistent is use of ${name}?`)
      .selectOption("2");
    await page.getByLabel(`How often is ${name} used?`).selectOption("1");
  }
  await page
    .getByRole("button", { name: "Choose placement", exact: true })
    .click();
  await page.getByText("One more detail is needed", { exact: true }).waitFor();
  await page.getByLabel("Most reliable location").selectOption("Drawer");
  await page
    .getByLabel("What makes it more reliable for this person?")
    .fill("They always take their breakfast bowl from this drawer.");
  await page
    .getByRole("button", { name: "Choose placement", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Placement results", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".placement-results > li").first().innerText(),
    /Drawer.*Recommended placement.*breakfast bowl/s,
  );
  assert.equal(
    await page.getByText("Recommended placement", { exact: true }).count(),
    1,
  );
  await page.getByRole("button", { name: "Review last answer" }).click();
  await yes();
  await page
    .getByRole("heading", { name: "Placement context", exact: true })
    .waitFor();
  // Object knowledge should detect a phone without requiring the user to name the hazard.
  await page.goto("http://localhost:5173/placement");
  await page.getByLabel("Idea 1", { exact: true }).fill("Phone");
  await page.getByLabel("Idea 2", { exact: true }).fill("Bedroom drawer");
  await page
    .getByText("A phone may be taken near sinks", { exact: false })
    .waitFor();
  await page.getByRole("button", { name: "Compare my ideas" }).click();
  await page
    .getByRole("heading", {
      name: "Will the tracker stay dry during normal use and cleaning?",
    })
    .waitFor();
  await no();
  for (let i = 0; i < 4; i++) await yes();
  await page
    .getByRole("heading", { name: "Placement results", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".placement-results > li").first().innerText(),
    /Bedroom drawer.*Recommended placement/s,
  );
  assert.match(
    await page
      .locator(".placement-results > li")
      .filter({
        has: page.getByRole("heading", { name: "Phone", exact: true }),
      })
      .innerText(),
    /Reconsider this spot.*Water and cleaning/s,
  );
  await page.screenshot({
    path: "screenshots/placement-context-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  // Even with all checks confirmed, a portable phone loses an otherwise equal comparison.
  await page.getByRole("button", { name: "Edit my ideas" }).click();
  await page.getByRole("button", { name: "Compare my ideas" }).click();
  for (let i = 0; i < 10; i++) await yes();
  await page
    .getByRole("heading", { name: "Placement results", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".placement-results > li").first().innerText(),
    /Bedroom drawer.*Recommended placement/s,
  );
  assert.equal(
    await page.getByText("Recommended placement", { exact: true }).count(),
    1,
  );
  // A new hazard in the tie-break description must also affect the final outcome.
  await page.goto("http://localhost:5173/placement");
  await page.getByLabel("Idea 1", { exact: true }).fill("Drawer A");
  await page.getByLabel("Idea 2", { exact: true }).fill("Drawer B");
  await page.getByRole("button", { name: "Compare my ideas" }).click();
  for (let i = 0; i < 8; i++) await yes();
  await page
    .getByLabel("What routine do you want to monitor?")
    .fill("Breakfast");
  for (const name of ["Drawer A", "Drawer B"]) {
    await page
      .getByLabel(`How and when is ${name} used?`)
      .fill(
        name === "Drawer A"
          ? "Near the sink during breakfast"
          : "Used each morning",
      );
    await page.getByLabel(`How closely does ${name} match`).selectOption("2");
    await page
      .getByLabel(`How consistent is use of ${name}?`)
      .selectOption("2");
    await page.getByLabel(`How often is ${name} used?`).selectOption("1");
  }
  await page
    .getByLabel("Will the tracker stay dry during normal use and cleaning?")
    .selectOption("no");
  await page
    .getByRole("button", { name: "Choose placement", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Placement results", exact: true })
    .waitFor();
  assert.match(
    await page.locator(".placement-results > li").first().innerText(),
    /Drawer B.*Recommended placement/s,
  );
  assert.match(
    await page.locator(".placement-results > li").last().innerText(),
    /Drawer A.*Reconsider this spot.*water and cleaning/s,
  );
  assert.deepEqual(errors, []);
  process.stdout.write(
    "Placement checks passed: five ideas, branches, back/edit, validation, empty shortlist, mobile layout, and both entry buttons.\n",
  );
} finally {
  await browser.close();
}
