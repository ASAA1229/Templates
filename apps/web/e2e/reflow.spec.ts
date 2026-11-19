import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { accessibilityViolations, generateProject, signIn, unique } from "./fixtures";

/**
 * RG-09 extras: WCAG 1.4.10 reflow (320 CSS px = 400% zoom at 1280), 1.4.4 resize (200% text),
 * 2.4.7 focus visible / 2.1.1 keyboard, reduced-motion and forced-colors emulation over the critical pages.
 * Automated only; manual zoom and assistive-technology review remain separate human steps.
 */
test.describe.configure({ timeout: 240_000 });

async function pages(page: Page) {
  await signIn(page, "/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  const project = await generateProject(page, unique("RFL"));
  return [
    "/",
    "/projects",
    "/projects/new",
    `/projects/${project.projectId}`,
    `/projects/${project.projectId}/workspace`,
    "/catalog",
    "/security",
  ];
}

async function settle(page: Page, route: string) {
  await page.goto(route);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

const horizontalOverflow = (page: Page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    offenders: Array.from(document.body.querySelectorAll<HTMLElement>("*"))
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().right > window.innerWidth + 1)
      // Deepest offenders only (skip ancestors that merely contain an overflowing child).
      .filter((el) => !Array.from(el.children).some((c) => c.getBoundingClientRect().right > window.innerWidth + 1))
      .slice(0, 4)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}[${(el.textContent ?? "").trim().slice(0, 30)}]`,
      ),
  }));

test("320px reflow: no horizontal scroll and no axe violations on critical pages", async ({ page }) => {
  const routes = [...(await pages(page)), "/login"];
  await page.setViewportSize({ width: 320, height: 640 });
  const failures: string[] = [];
  for (const route of routes) {
    if (route === "/login") {
      await page.request.post("/api/auth/logout", { headers: { "x-requested-with": "asaa-templates" } });
      await page.goto(route);
      await expect(page.getByRole("heading").first()).toBeVisible();
    } else {
      await settle(page, route);
    }
    const overflow = await horizontalOverflow(page);
    if (overflow.scrollWidth > overflow.innerWidth + 1)
      failures.push(`${route}: scrollWidth ${overflow.scrollWidth} > ${overflow.innerWidth} (${overflow.offenders})`);
    const violations = await accessibilityViolations(page);
    if (violations.length) failures.push(`${route}: ${JSON.stringify(violations)}`);
  }
  expect(failures).toEqual([]);
});

test("200% text size: no horizontal scroll, headings, navigation and actions stay visible", async ({ page }) => {
  const routes = [...(await pages(page))];
  await page.setViewportSize({ width: 1280, height: 800 });
  const failures: string[] = [];
  for (const route of routes) {
    await settle(page, route);
    await page.addStyleTag({ content: "html{font-size:200%}" });
    await page.waitForTimeout(150);
    const overflow = await horizontalOverflow(page);
    if (overflow.scrollWidth > overflow.innerWidth + 1)
      failures.push(`${route}: scrollWidth ${overflow.scrollWidth} > ${overflow.innerWidth} (${overflow.offenders})`);
    if (!(await page.getByRole("heading", { level: 1 }).first().isVisible())) failures.push(`${route}: h1 hidden`);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    const menuButton = page.getByRole("button", { name: "Open menu" });
    if (!((await nav.isVisible()) || (await menuButton.isVisible()))) failures.push(`${route}: no navigation`);
    // Visible buttons must be fully inside the viewport width and not zero-sized (not clipped away).
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("main button, main a[href]"))
        .filter((el) => el.offsetParent !== null)
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width < 8 || box.height < 8 || box.right > window.innerWidth + 1 || box.left < -1;
        })
        .slice(0, 5)
        .map((el) => (el.textContent ?? el.getAttribute("aria-label") ?? el.tagName).trim().slice(0, 40)),
    );
    if (clipped.length) failures.push(`${route}: clipped controls ${JSON.stringify(clipped)}`);
  }
  expect(failures).toEqual([]);
});

test("keyboard: every control in the new-project wizard shows a focus indicator; Escape closes popups", async ({
  page,
}) => {
  await signIn(page, "/");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await settle(page, "/projects/new");
  const seen = new Set<string>();
  const problems: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      const shadow = style.boxShadow !== "none" && style.boxShadow !== "";
      return {
        id: `${el.tagName.toLowerCase()}|${el.getAttribute("aria-label") ?? el.id ?? ""}|${(el.textContent ?? "").trim().slice(0, 30)}|${Math.round(el.getBoundingClientRect().top)}`,
        visibleFocus: (outline || shadow) && el.matches(":focus-visible"),
        matches: el.matches(":focus-visible"),
      };
    });
    if (!info) continue;
    if (seen.has(info.id)) break; // wrapped around
    seen.add(info.id);
    if (!info.visibleFocus) problems.push(info.id);
  }
  expect(seen.size).toBeGreaterThan(3);
  expect(problems).toEqual([]);

  // Global search popup: typing opens it, Escape closes it and keeps focus in the field.
  const search = page.getByRole("combobox").first();
  await search.fill("pro");
  await page.keyboard.press("Escape");
  await expect(search).toHaveAttribute("aria-expanded", "false");

  // Mobile drawer: Escape closes it.
  await page.setViewportSize({ width: 360, height: 700 });
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("dialog").or(page.locator("#mobile-nav")).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toHaveAttribute("aria-expanded", "false");
});

test("prefers-reduced-motion: pages load without axe issues and without running animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const routes = await pages(page);
  const failures: string[] = [];
  for (const route of routes) {
    await settle(page, route);
    const violations = await accessibilityViolations(page);
    if (violations.length) failures.push(`${route}: ${JSON.stringify(violations)}`);
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === "running" && (a.effect?.getTiming().iterations ?? 1) === Infinity)
        .map((a) => a.id || (a as CSSAnimation).animationName || "animation"),
    );
    // Infinite animations (spinners, pulses) must be absent or disabled under reduced motion.
    if (running.length) failures.push(`${route}: infinite animations running ${JSON.stringify(running)}`);
  }
  expect(failures).toEqual([]);
});

test("forced-colors: pages have no axe violations and key controls stay visible", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  const routes = [...(await pages(page))];
  const failures: string[] = [];
  for (const route of routes) {
    await settle(page, route);
    // Forced colours replace author colours, so axe cannot evaluate colour-contrast there (checked in the normal scans).
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .disableRules(["color-contrast"])
      .analyze();
    if (results.violations.length) failures.push(`${route}: ${JSON.stringify(results.violations.map((v) => v.id))}`);
    const invisible = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          "main button, main input:not([type=radio]):not([type=checkbox]), main select, main textarea",
        ),
      )
        .filter((el) => el.offsetParent !== null)
        .filter((el) => {
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          const hasBorder = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none";
          const hasOutline = style.outlineStyle !== "none";
          return (
            box.width === 0 ||
            box.height === 0 ||
            style.visibility === "hidden" ||
            style.opacity === "0" ||
            // A control with no border and a transparent background disappears in forced colours.
            (!hasBorder &&
              !hasOutline &&
              !["button"].includes(el.tagName.toLowerCase()) &&
              el.getAttribute("type") !== "button")
          );
        })
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}:${el.getAttribute("name") ?? el.textContent?.trim().slice(0, 30)}`),
    );
    if (invisible.length) failures.push(`${route}: controls not distinguishable ${JSON.stringify(invisible)}`);
  }
  expect(failures).toEqual([]);
  await expect(page.getByRole("button").first()).toBeVisible();
});
