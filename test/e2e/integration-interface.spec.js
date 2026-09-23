// E2E : l'integration des lots d'interface du 23/09 (DESIGN.md, « Integration
// des lots d'interface du 23/09 »).
//
// L'ANNEAU CLAVIER EN SOMBRE. `--focus-ring` n'etait declare que sous
// `:root[data-color-scheme="light"]` : en sombre, toute regle
// `outline: none; box-shadow: var(--focus-ring)` rendait une declaration
// invalide -- AUCUN indicateur. Quatre lots l'ont releve chacun de leur cote
// (lot 3 de l'audit geo, Clients au telephone, Creation d'abonnement, Ecrans
// sans planche) et l'ont contourne dans leur seul bloc en ecrivant les deux
// tons en clair. L'integration declare le jeton pour tous les themes : ses
// deux tons (--v8-focus, --v8-focus-halo) suivent deja le theme.
//
// Les elements mesures sont ceux que la section « Clients au telephone » nomme
// « constate hors du lot, non corrige » -- au BUREAU, en sombre : « Modifier »,
// une commande de la fiche, une ligne de la liste -- plus une ligne de
// l'ecran Commandes (`.cmd-ligne`). Temoin : le meme releve en clair.

const http = require("node:http");
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

/** Un mandataire qui peut retenir des requetes d'API (le motif de livreur-ne-perd-rien.spec.js). */
async function mandataire(cible) {
  const etat = { retenir: null, attente: [] };
  const server = http.createServer((req, res) => {
    const passer = () => {
      const amont = http.request(cible + req.url, { method: req.method, headers: req.headers }, r => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      amont.on("error", () => res.destroy());
      req.pipe(amont);
    };
    if (etat.retenir && etat.retenir.test(req.url)) etat.attente.push(passer);
    else passer();
  });
  server.listen(0, "127.0.0.1");
  await require("node:events").once(server, "listening");
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    retenir(motif) { etat.retenir = motif; },
    liberer() { etat.retenir = null; for (const f of etat.attente.splice(0)) f(); },
    retenues() { return etat.attente.length; },
    async arreter() {
      this.liberer();
      server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
  };
}

let srv, srvVide, mdt;
test.beforeAll(async () => {
  srv = await demarrer({ port: 3308, seed: jeuDeDonnees() });
  // Aucune commande : « Aucune commande » est alors la VRAIE reponse.
  srvVide = await demarrer({ port: 3309, seed: { ...jeuDeDonnees(), commandes: [], routes: [] } });
  mdt = await mandataire(srvVide.base);
});
test.afterAll(async () => {
  if (mdt) await mdt.arreter();
  if (srv) await srv.arreter();
  if (srvVide) await srvVide.arreter();
});

const BUREAU = { width: 1280, height: 900 };

async function ouvrir(page, schema, ecran) {
  await page.addInitScript(m => {
    try { localStorage.setItem("sereo:colorScheme", m); } catch { /* ignore */ }
  }, schema);
  await page.emulateMedia({ colorScheme: schema });
  await page.setViewportSize(BUREAU);
  await page.goto(srv.base + "/#" + ecran, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  // Un Tab d'abord : le focus qui suit est un focus clavier (:focus-visible).
  await page.keyboard.press("Tab");
}

/** L'anneau de l'element actif : son ombre et son contour, et s'il est bien :focus-visible. */
const anneau = page => page.evaluate(() => {
  const e = document.activeElement, cs = getComputedStyle(e);
  return {
    theme: document.documentElement.dataset.colorScheme,
    focus: e.matches(":focus-visible"),
    ombre: cs.boxShadow,
    contour: cs.outlineStyle === "none" ? "none" : `${cs.outlineStyle} ${cs.outlineWidth}`
  };
});

// Un anneau : un contour, ou une ombre pleine autour (0 0 0 n).
const sansAnneau = vus => Object.entries(vus)
  .filter(([, v]) => !v.focus || (!/0px 0px 0px/.test(v.ombre) && v.contour === "none"))
  .map(([quoi, v]) => ({ quoi, ...v }));

for (const schema of ["light", "dark"]) {
  test(`au bureau, l'anneau clavier se voit : Clients et Commandes (${schema})`, async ({ page }) => {
    const vus = {};
    await ouvrir(page, schema, "crm");
    expect(await page.evaluate(() => document.documentElement.dataset.colorScheme), "prealable : le theme").toBe(schema);
    await page.locator("#crmList .cli-ligne").first().focus();
    vus.ligne = await anneau(page);
    await page.locator("#crmList .cli-ligne", { hasText: "Tilleuls" }).click();
    await expect(page.locator("#cliFiche")).toBeVisible();
    await page.keyboard.press("Tab");
    await page.locator("#cliFiche .cli-bouton-contour", { hasText: "Modifier" }).first().focus();
    vus.modifier = await anneau(page);
    await page.locator("#cliFiche .cli-commande").first().focus();
    vus.commande = await anneau(page);

    await ouvrir(page, schema, "commandes");
    await page.locator("#cmdLignes .cmd-ligne").first().focus();
    vus.cmdLigne = await anneau(page);

    expect(sansAnneau(vus)).toEqual([]);
  });
}

// LES COMMANDES « INDISPONIBLES », PUIS LUES EN RETARD. Les finitions disent
// « Commandes indisponibles » quand /api/orders a echoue (commandesEnErreur,
// pose par loadData). Le lot 1 de l'audit geo montre les reponses TARDIVES :
// le service worker rend l'echec au bout de 3 s (pas de copie en cache), puis
// la reponse arrive, il la range et previent la page (appliquerReponsesTardives).
// Sur la fusion, cette reponse n'effacait pas l'erreur : une liste vraiment
// vide restait « indisponible » jusqu'au rechargement suivant.
test("des commandes lues en retard ne sont plus « indisponibles »", async ({ browser }) => {
  test.setTimeout(90000);
  const ctx = await browser.newContext({ viewport: BUREAU });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(mdt.base + "/#commandes", { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  // Pas de copie des commandes : le repli de 3 s echoue, il ne rend rien.
  await page.evaluate(async () => {
    for (const nom of await caches.keys()) if (nom.startsWith("sereo-api-")) await caches.delete(nom);
  });
  mdt.retenir(/^\/api\/orders(\?|$)/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const liste = page.locator("#cmdLignes");
  await expect(liste, "prealable : l'echec de la lecture est dit").toContainText("Commandes indisponibles", { timeout: 15000 });
  expect(mdt.retenues(), "prealable : la lecture des commandes doit etre retenue").toBeGreaterThan(0);

  // La reponse arrive, en retard : aucune commande.
  mdt.liberer();
  await expect(liste, "la reponse tardive n'a pas efface l'erreur").toContainText("Aucune commande", { timeout: 10000 });
  await expect(liste).not.toContainText("Commandes indisponibles");
  await expect(page.locator("#pageSubtitle")).not.toHaveText("Commandes indisponibles");
  expect(erreurs).toEqual([]);
  await ctx.close();
});
