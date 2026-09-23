// E2E : les finitions d'interface de l'audit du 23/09.
//
// Un audit de completude contre les 49 planches V8 a releve une liste de
// defauts ; chaque cas ci-dessous en mesure un, par le numero du rapport. Chacun
// a d'abord ete lance sur le code d'avant, pour s'assurer qu'il rougit sur le
// defaut et pour la bonne cause (DESIGN.md, « Finitions d interface »).
//
// Deux serveurs : le serveur commun (sans donnees) pour ce qui se juge a vide,
// et un serveur seme (port 3301) pour ce qui ne se juge que sur des donnees --
// une pastille, des toasts, une page assez longue pour defiler.

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, AUJOURDHUI } = require("./serveur-seme");

const LENTEUR_MS = 2500;

function luminance([r, g, b]) {
  const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function rgb(chaine) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(chaine || "");
  return m ? { rgb: [+m[1], +m[2], +m[3]], alpha: m[4] === undefined ? 1 : +m[4] } : null;
}
function contraste(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

async function contexte(browser, { mode = "light", viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: mode });
  await ctx.addInitScript(m => {
    try { localStorage.setItem("sereo:colorScheme", m); } catch { /* ignore */ }
  }, mode);
  return ctx;
}

async function ralentirApi(page) {
  await page.route("**/api/**", async route => {
    await new Promise(r => setTimeout(r, LENTEUR_MS));
    route.continue().catch(() => { /* page fermee */ });
  });
}

/** Le semé commun, plus un abonnement dont deux échéances sont passées. */
function semeAvecEcheances() {
  const seed = jeuDeDonnees();
  const il = n => new Date(Date.parse(AUJOURDHUI) - n * 86400000).toISOString().slice(0, 10);
  // Toutes les semaines depuis J-10 : J-10 et J-3 sont echues sans commande ;
  // J+4 a son rappel (2 jours) a J+2, pas encore arrive. Les deux autres
  // abonnements sont en pause et arretes : le serveur ne les planifie pas.
  seed.subscriptions[0] = { ...seed.subscriptions[0], startDate: il(10), frequency: { unit: "days", interval: 7 }, reminderDays: 2 };
  return seed;
}

let srv;
// Un seul worker pour le fichier (le serveur seme a UN port), mais pas
// « serial » : un cas rouge ne doit pas faire sauter les suivants.
test.describe.configure({ mode: "default" });
test.beforeAll(async () => { srv = await demarrer({ port: 3301, seed: semeAvecEcheances() }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

test("2 — les zones de texte multilignes sont en Poppins, comme les champs voisins", async ({ browser }) => {
  const ctx = await contexte(browser);
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  const r = await page.evaluate(() => [...document.querySelectorAll("textarea")].map(t => {
    const cadre = t.closest("form, dialog, .panel") || document.body;
    const voisin = [...cadre.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select")][0];
    const cs = getComputedStyle(t);
    return {
      nom: t.id || t.name,
      police: cs.fontFamily.split(",")[0].replace(/"/g, "").trim(),
      voisin: voisin ? getComputedStyle(voisin).fontFamily : null,
      famille: cs.fontFamily
    };
  }));
  console.log("[textarea] " + r.map(t => `${t.nom}: ${t.police}`).join(" · "));
  // Preable : les quatre notes du rapport sont bien dans la page.
  expect(r.length, "aucune zone de texte trouvee").toBeGreaterThanOrEqual(4);
  expect(r.filter(t => t.police !== "Poppins").map(t => `${t.nom} : ${t.famille}`), "zone de texte hors Poppins").toEqual([]);
  expect(r.filter(t => t.voisin && t.voisin !== t.famille).map(t => t.nom), "police differente du champ voisin").toEqual([]);
  await ctx.close();
});

test("3 — Commande client : aucun champ coupé, de 821 à 1920 px", async ({ browser }) => {
  test.setTimeout(180000);
  const coupes = [];
  for (const largeur of [821, 900, 1024, 1180, 1181, 1280, 1366, 1440, 1600, 1920]) {
    const ctx = await contexte(browser, { viewport: { width: largeur, height: 900 } });
    const page = await ctx.newPage();
    await page.goto("/#commande-client", { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    for (const type of ["immediate", "planifiee"]) {
      await page.selectOption("#customerOrderType", type);
      const r = await page.evaluate(() => {
        // Ce qu'un controle doit loger : son texte affiche, ses marges, et
        // la place de sa fleche (liste) ou de son calendrier (date). Les
        // reserves sont GENEREUSES : un « rien de coupe » ne doit pas tenir a
        // une fleche comptee trop etroite.
        const c = document.createElement("canvas").getContext("2d");
        const largeurTexte = (el, texte) => {
          const cs = getComputedStyle(el);
          c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          return c.measureText(texte).width;
        };
        const out = [];
        const champs = [...document.querySelectorAll("#customerOrderForm select, #customerOrderForm input[type=date], #commande-client .crm-toolbar select")];
        for (const el of champs) {
          const cs = getComputedStyle(el);
          const marges = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
          const texte = el.tagName === "SELECT" ? (el.selectedOptions[0]?.text || "") : null;
          const besoin = el.tagName === "SELECT"
            ? largeurTexte(el, texte) + marges + 24
            : Math.max(largeurTexte(el, "dd/mm/yyyy"), largeurTexte(el, "00/00/0000")) + marges + 28;
          out.push({ id: el.id, texte, besoin: Math.ceil(besoin), largeur: el.clientWidth });
        }
        const form = document.getElementById("customerOrderForm").getBoundingClientRect();
        return { out, form: Math.round(form.width), deborde: document.documentElement.scrollWidth - innerWidth };
      });
      for (const ch of r.out.filter(ch => ch.besoin > ch.largeur)) {
        coupes.push(`${largeur}px ${ch.id}${ch.texte ? ` « ${ch.texte} »` : ""} : ${ch.largeur}px pour ${ch.besoin}`);
      }
      if (r.deborde > 0) coupes.push(`${largeur}px : la page deborde de ${r.deborde}px`);
      if (r.form < 320) coupes.push(`${largeur}px : formulaire de ${r.form}px`);
    }
    await ctx.close();
  }
  console.log(`[commande-client] ${coupes.length} coupe(s)` + coupes.map(c => "\n   " + c).join(""));
  expect(coupes).toEqual([]);
});

test("10 — la pastille « Abonnements » compte les échéances à générer, en alerte s'il y a du retard", async ({ browser }) => {
  const ctx = await contexte(browser);
  const page = await ctx.newPage();
  await page.goto(srv.base + "/#journee", { waitUntil: "networkidle" });
  const pastille = page.locator('.nav-badge[data-badge="abonnements"]');
  await expect(pastille).toBeVisible();
  await expect(pastille).toHaveText("2");
  await expect(pastille).toHaveAttribute("data-alerte", "");
  await expect(pastille).toHaveAttribute("aria-label", "2 échéances à générer");
  await ctx.close();
});

test("12 — « Cette semaine » ne dit pas 0 pendant le chargement", async ({ browser }) => {
  test.setTimeout(60000);
  const ctx = await contexte(browser);
  const page = await ctx.newPage();
  await ralentirApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const pendant = await page.locator("#opWeekCount").evaluate(e => ({ texte: e.textContent.trim(), squelette: e.classList.contains("squelette-chiffre") }));
  expect(pendant.texte, "un chiffre pendant le chargement").toBe("");
  expect(pendant.squelette).toBe(true);
  await expect(page.locator("#opWeekCount")).toHaveText(/^\d+ échéances?$/, { timeout: 15000 });
  await ctx.close();
});

test("12 — au téléphone, les « Stock mis à jour » ne s'empilent pas", async ({ browser }) => {
  test.setTimeout(90000);
  const ctx = await contexte(browser, { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(srv.base + "/#stock", { waitUntil: "networkidle" });
  const plus = page.locator('#stockList [data-stock-delta="1"]').first();
  for (let i = 0; i < 3; i++) {
    await plus.click();
    await expect(page.locator(".toast", { hasText: "Stock mis à jour" }).last()).toBeVisible();
    await page.waitForTimeout(150);
  }
  const vivants = await page.locator(".toast", { hasText: "Stock mis à jour" }).count();
  expect(vivants, "un seul toast, remplace a chaque geste").toBe(1);
  await ctx.close();
});

test("12 — la page ne remonte pas toute seule si on a défilé pendant le chargement", async ({ browser }) => {
  test.setTimeout(60000);
  const ctx = await contexte(browser, { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await ralentirApi(page);
  await page.goto(srv.base + "/#journee", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await page.mouse.move(195, 400);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(300);
  const avant = await page.evaluate(() => scrollY);
  expect(avant, "prealable : la page doit avoir defile").toBeGreaterThan(300);
  await page.waitForLoadState("load");
  await page.waitForTimeout(LENTEUR_MS + 2500);
  const apres = await page.evaluate(() => scrollY);
  expect(apres, "la page est remontee toute seule").toBeGreaterThan(200);
  await ctx.close();
});

test("12 — si les commandes n'ont pas pu être lues, les listes disent l'erreur, pas « Aucune commande »", async ({ browser }) => {
  const ctx = await contexte(browser);
  const page = await ctx.newPage();
  await page.route("**/api/orders", route => route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"panne"}' }));
  await page.goto("/#commandes", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const liste = page.locator("#cmdLignes");
  await expect(liste).toContainText("Commandes indisponibles");
  await expect(liste).not.toContainText("Aucune commande");
  await expect(liste.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await page.evaluate(() => { location.hash = "#preparation"; });
  await expect(page.locator("#preparationList")).toContainText("Commandes indisponibles");
  await expect(page.locator("#preparationList")).not.toContainText("Aucune commande");
  await ctx.close();
});

test("12 — « Tout sélectionner » des commandes du jour attend les commandes", async ({ browser }) => {
  test.setTimeout(60000);
  const ctx = await contexte(browser);
  const page = await ctx.newPage();
  await ralentirApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const boutons = page.locator('[data-action="select-all-today-orders"], [data-action="clear-today-orders"]');
  expect(await boutons.count()).toBe(2);
  for (const b of await boutons.all()) await expect(b).toBeDisabled();
  for (const b of await boutons.all()) await expect(b).toBeEnabled({ timeout: 15000 });
  await ctx.close();
});

test("14 — « Se déconnecter » : dans la barre au bureau, dans « Plus » au téléphone", async ({ browser }) => {
  const bureau = await contexte(browser);
  const page = await bureau.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  const bouton = page.locator(".sidebar").getByRole("button", { name: "Se déconnecter" });
  await expect(bouton).toBeVisible();
  const r = await bouton.evaluate(b => ({ h: b.getBoundingClientRect().height, type: b.type,
    methode: b.form?.getAttribute("method"), action: b.form?.getAttribute("action") }));
  expect(r.h).toBeGreaterThanOrEqual(44);
  expect(r).toMatchObject({ type: "submit", methode: "post", action: "/logout" });
  // Le geste va vraiment au serveur : un POST /logout qui navigue.
  const [requete] = await Promise.all([page.waitForRequest(q => q.url().endsWith("/logout")), bouton.click()]);
  expect(requete.method()).toBe("POST");
  await bureau.close();

  const tel = await contexte(browser, { viewport: { width: 390, height: 844 } });
  const mobile = await tel.newPage();
  await mobile.goto("/", { waitUntil: "networkidle" });
  await expect(mobile.locator(".sidebar").getByRole("button", { name: "Se déconnecter" })).toBeHidden();
  await mobile.locator("#mobile-tab-more").click();
  const item = mobile.locator("#mobile-more-sheet").getByRole("menuitem", { name: "Se déconnecter" });
  await expect(item).toBeVisible();
  expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await item.evaluate(b => b.form?.getAttribute("action"))).toBe("/logout");
  await tel.close();
});

for (const mode of ["light", "dark"]) {
  test(`8 — l'avertissement : un seul jeton, et son bouton lisible au repos comme au survol, en ${mode}`, async ({ browser }) => {
    const ctx = await contexte(browser, { mode });
    const page = await ctx.newPage();
    await page.goto("/#relances", { waitUntil: "networkidle" });
    const jetons = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { warning: cs.getPropertyValue("--warning").trim().toUpperCase(), avertissement: cs.getPropertyValue("--v8-avertissement").trim().toUpperCase() };
    });
    expect(jetons.avertissement, "prealable : le jeton de la charte existe").toMatch(/^#[0-9A-F]{6}$/);
    expect(jetons.warning, "--warning n'est pas le jeton d'avertissement").toBe(jetons.avertissement);

    // Le seul texte pose sur cette famille : le bouton « Reporte » des rappels.
    // On le pose dans l'ecran visible -- c'est la cascade qu'on juge.
    await page.evaluate(() => {
      const b = document.createElement("button");
      b.className = "button warning compact"; b.type = "button"; b.id = "banc-warning"; b.textContent = "Reporte";
      document.querySelector("#relances").prepend(b);
    });
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
    const lire = () => page.locator("#banc-warning").evaluate(b => {
      const cs = getComputedStyle(b);
      return { couleur: cs.color, fond: cs.backgroundColor, image: cs.backgroundImage };
    });
    const etats = { repos: await lire() };
    await page.locator("#banc-warning").hover();
    etats.survol = await lire();
    for (const [etat, e] of Object.entries(etats)) {
      expect(e.image, `${etat} : un degrade sous le texte ne se mesure pas`).toBe("none");
      const fond = rgb(e.fond), texte = rgb(e.couleur);
      expect(fond.alpha, `${etat} : fond transparent`).toBe(1);
      const ratio = contraste(texte.rgb, fond.rgb);
      console.log(`[avertissement/${mode}] ${etat} : ${e.couleur} sur ${e.fond} = ${ratio.toFixed(2)}`);
      expect(ratio, `${etat} : contraste`).toBeGreaterThanOrEqual(4.5);
    }
    await ctx.close();
  });
}
