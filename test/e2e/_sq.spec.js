const { test } = require("@playwright/test");
test("cycle de vie du squelette", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.route("**/api/**", async route => { await new Promise(r => setTimeout(r, 2500)); route.continue(); });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const pendant = await page.evaluate(() => ({
    squelettes: document.querySelectorAll(".squelette").length,
    blocs: document.querySelectorAll(".squelette-bloc").length,
    busy: document.querySelectorAll('[aria-busy="true"]').length,
    texte: [...document.querySelectorAll(".squelette")].some(s => s.textContent.trim().length > 0)
  }));
  console.log("\n  PENDANT : " + JSON.stringify(pendant));
  await page.screenshot({ path: "test-results/squelette.png" });
  await page.waitForTimeout(5000);
  const apres = await page.evaluate(() => ({
    squelettes: document.querySelectorAll(".squelette").length,
    busy: document.querySelectorAll('[aria-busy="true"]').length
  }));
  console.log("  APRES   : " + JSON.stringify(apres));
  await ctx.close();
});
