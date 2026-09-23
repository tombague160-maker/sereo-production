// E2E : les finitions de la barre laterale, relevees AVANT la publication de
// la v1.34.0.
//
// Une relecture independante a lu le code ; ces bancs MESURENT ce qu'elle a
// signale. Chaque cas a d'abord ete lance sur le code non corrige, pour
// s'assurer qu'il rougit sur le defaut -- un banc qui passe sur le defaut ne
// garde rien.

const { test, expect } = require("./tuiles");

const CLAIR = async ctx => ctx.addInitScript(() => {
  try { localStorage.setItem("sereo:colorScheme", "light"); } catch { /* ignore */ }
});

test.describe("Barre laterale -- finitions de la v1.34.0", () => {
  test("entre 821 et 920 px, en clair, le contenu est a l'ecran sans defiler", async ({ browser }) => {
    // Le defaut mesure : en clair, la page passait en une colonne des 920 px
    // alors que le bandeau n'arrive qu'a 820. Entre les deux, la barre
    // occupait TOUT un ecran -- 900 px de large, 800 de haut -- et le contenu
    // commencait 800 px plus bas. Un telephone tenu a l'horizontale (844 px)
    // tombe dans cette plage.
    const ctx = await browser.newContext({ viewport: { width: 900, height: 800 }, colorScheme: "light" });
    await CLAIR(ctx);
    const page = await ctx.newPage();
    await page.goto("/#journee", { waitUntil: "networkidle" });
    const r = await page.evaluate(() => ({
      barre: document.querySelector(".sidebar").getBoundingClientRect().width,
      contenu: document.querySelector(".content").getBoundingClientRect().top
    }));
    expect(r.barre, "la barre ne doit pas prendre toute la largeur").toBeLessThanOrEqual(300);
    expect(r.contenu, "le contenu doit commencer dans le premier ecran").toBeLessThan(150);
    await ctx.close();
  });

  test("sur un petit portable, le bloc compte n'est pas ecrase", async ({ browser }) => {
    // Mesure a 1280x720 : le bloc compte passait de 64 a 50 px, rogne sous
    // son propre contenu. La barre doit DEFILER plutot que d'ecraser.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto("/#journee", { waitUntil: "networkidle" });
    const r = await page.evaluate(() => ({
      compte: document.querySelector(".sidebar-compte").getBoundingClientRect().height,
      recherche: document.querySelector(".sidebar-search").getBoundingClientRect().height,
      defile: getComputedStyle(document.querySelector(".sidebar")).overflowY
    }));
    expect(r.compte, "bloc compte : 12 + 40 + 12 px de contenu").toBeGreaterThanOrEqual(64);
    expect(r.recherche).toBeGreaterThanOrEqual(44);
    expect(["auto", "scroll"]).toContain(r.defile);
    await ctx.close();
  });

  test("au clavier, activer une pilule garde le focus sur les pilules", async ({ page }) => {
    // La rangee est reconstruite a chaque changement d'ecran. Sans precaution,
    // le bouton qui avait le focus est detruit et le focus retombe sur <body> :
    // Tab repart du haut de la page.
    await page.goto("/", { waitUntil: "networkidle" });
    // Commandes, Stock et Clients n'ont plus de pilules d'ecran (planches
    // 13c, 13d, 13e) : Analyse en a deux.
    await page.locator("#nav-analyse").click();
    await page.locator("#tab-exports").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#exports")).toHaveClass(/active/);
    const focus = await page.evaluate(() => ({
      id: document.activeElement?.id || null,
      dansLaRangee: !!document.activeElement?.closest("#sousOnglets")
    }));
    expect(focus.dansLaRangee, `focus sur ${focus.id}`).toBe(true);
    expect(focus.id).toBe("tab-exports");
  });

  test("« A jour » ne s'affiche pas quand la version n'a pas pu etre lue", async ({ page }) => {
    // La pastille etait ecrite en dur : elle disait « A jour » meme quand
    // /api/version echouait et que la ligne affichait « -- ».
    await page.route("**/api/version", route => route.fulfill({ status: 500, body: "{}" }));
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("#sidebar-version-value")).toHaveText("—");
    await expect(page.locator("#sidebarVersionEtat")).toBeHidden();
  });

  test("« A jour » s'affiche quand la version a ete lue", async ({ page }) => {
    // Le temoin positif du cas precedent : sans lui, une pastille toujours
    // masquee passerait le banc.
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("#sidebar-version-value")).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(page.locator("#sidebarVersionEtat")).toBeVisible();
  });

  test("les ecrans a un seul onglet gardent un nom accessible", async ({ page }) => {
    // aria-labelledby="tab-journee" visait un element qui n'existait plus : le
    // Tableau de bord, la Preparation, la Tournee et les Abonnements n'ont
    // qu'un ecran, donc pas de pilule, donc pas d'identifiant a viser.
    // Depuis les planches V8, d'autres ecrans ont perdu leur pilule (Commandes,
    // Stock, Clients, et les ecrans secondaires) : ils se nomment par
    // aria-label. Un aria-labelledby qui vise un element absent ne nomme rien.
    for (const onglet of ["journee", "preparation", "livreur", "abonnements", "commandes", "commande-client",
      "stock", "recommande", "crm", "relances"]) {
      await page.goto(`/#${onglet}`, { waitUntil: "networkidle" });
      const nom = await page.evaluate(id => {
        const section = document.getElementById(id);
        const cible = section.getAttribute("aria-labelledby");
        const el = cible && document.getElementById(cible);
        return el ? el.textContent.trim() : (section.getAttribute("aria-label") || "").trim() || null;
      }, onglet);
      expect(nom, `nom accessible de #${onglet}`).toBeTruthy();
    }
  });

  test("l'anneau de focus de la barre est clair, en mode clair aussi", async ({ browser }) => {
    // La regle de la barre (0,3,0) perdait contre une regle generique du mode
    // clair (0,3,1) : l'anneau prevu, dans la palette de la barre, n'etait pas
    // applique, et un anneau sombre tombait a 2,44:1 sur le vert.
    const ctx = await browser.newContext({ colorScheme: "light" });
    await CLAIR(ctx);
    const page = await ctx.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("#menuSearch").focus();
    await page.keyboard.press("Tab");
    const anneau = await page.evaluate(() => {
      const e = document.activeElement;
      const cs = getComputedStyle(e);
      return { dansLaBarre: !!e.closest(".sidebar"), couleur: cs.outlineColor, style: cs.outlineStyle };
    });
    expect(anneau.dansLaBarre).toBe(true);
    expect(anneau.style).not.toBe("none");
    // --bl-secondaire en clair : #d6e5e3
    expect(anneau.couleur).toBe("rgb(214, 229, 227)");
    await ctx.close();
  });
});
