// E2E : au-dela de douze categories, les tuiles du Stock deviennent des lignes.
//
// Passation : « Categories de stock : grille jusqu'a [...] douze (desktop),
// lignes au-dela ». Deux serveurs semes : treize categories, et le temoin a
// douze -- la frontiere, des deux cotes.

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

function semer(n) {
  const seed = jeuDeDonnees();
  seed.stock = Array.from({ length: n }, (_, i) => ({
    id: `p-${i}`, code: `C-${i}`, nom: `Produit ${i}`, category: `Catégorie ${String(i).padStart(2, "0")}`,
    quantite: 50, alertThreshold: 5
  }));
  return seed;
}

async function colonnes(page, base) {
  await page.goto(base + "/#stock", { waitUntil: "networkidle" });
  const bloc = page.locator("#stkCategories");
  await expect(bloc.locator(".stk-tuile").first()).toBeVisible();
  const gauches = await bloc.locator(".stk-tuile")
    .evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().left))).size);
  return { bloc, gauches };
}

test.describe("treize catégories", () => {
  let srv;
  test.beforeAll(async () => { srv = await demarrer({ port: 3162, seed: semer(13) }); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  test("des lignes, pas une grille", async ({ page }) => {
    const { bloc, gauches } = await colonnes(page, srv.base);
    await expect(bloc.locator(".stk-tuile")).toHaveCount(13);
    await expect(bloc).toHaveClass(/stk-categories--liste/);
    expect(gauches).toBe(1);
  });
});

test.describe("douze catégories (le témoin)", () => {
  let srv;
  test.beforeAll(async () => { srv = await demarrer({ port: 3163, seed: semer(12) }); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  test("une grille de trois colonnes", async ({ page }) => {
    const { bloc, gauches } = await colonnes(page, srv.base);
    await expect(bloc.locator(".stk-tuile")).toHaveCount(12);
    await expect(bloc).not.toHaveClass(/stk-categories--liste/);
    expect(gauches).toBe(3);
  });
});
