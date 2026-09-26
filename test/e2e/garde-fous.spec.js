// E2E : les garde-fous du 25/09, ce que l'ecran en montre.
//
//   1. La carte « Sauvegardes » dit la seconde copie (SEREO_BACKUP_COPY_DIR,
//      decision 3) : la derniere, ou « non configuree », ou l'echec en mots,
//      dans la couleur d'alerte.
// Les regles elles-memes (copie relue, retention, alerte) sont tenues par
// test/garde-fous-copie.test.js ; ici, ce que la carte en dit.
//
// Un seul port pour les serveurs sans connexion, lances l'un apres l'autre
// (test/ports-e2e.test.js) : 3600.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

const lancer = (env = {}) => demarrer({ port: 3600, env });

async function ouvrirParametres(page, { base, largeur = 1440, schema = "light" } = {}) {
  await page.addInitScript(s => { try { localStorage.setItem("sereo:colorScheme", s); } catch { /* sans stockage */ } }, schema);
  await page.setViewportSize({ width: largeur, height: largeur < 800 ? 844 : 900 });
  await page.goto(base + "/#parametres", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", schema);
  await expect(page.locator("#parSauvegardeDerniere")).not.toHaveText("Chargement…");
}

// Le contraste d'un element visible (fond opaque le plus proche).
function contraste(page, selecteur) {
  return page.locator(selecteur).evaluate(e => {
    const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fond = n => { for (; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] === 1)) return c.slice(0, 3); } return [255, 255, 255]; };
    const [a, b] = [lum(rgb(getComputedStyle(e).color).slice(0, 3)), lum(fond(e))].sort((x, y) => y - x);
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
  });
}

test.describe("seconde copie posée", () => {
  let srv;
  let dossier;
  test.beforeAll(async () => {
    dossier = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-copie-e2e-"));
    // L'autre disque, monte, avec son fichier temoin (relecture du 26/09).
    fs.mkdirSync(path.join(dossier, "second"));
    fs.writeFileSync(path.join(dossier, "second", "sereo-second-dossier"), "");
    srv = await lancer({ SEREO_BACKUP_COPY_DIR: path.join(dossier, "second") });
  });
  test.afterAll(async () => {
    if (srv) await srv.arreter();
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  test("la carte dit la dernière copie après « Sauvegarder maintenant »", async ({ page }) => {
    await ouvrirParametres(page, { base: srv.base });
    const ligne = page.locator("#parSauvegardesCopie");
    await expect(ligne).toHaveText("Aucune depuis le démarrage (à la prochaine sauvegarde).");
    await page.locator('[data-action="sauvegarder-maintenant"]').click();
    await expect(ligne).toHaveText(/^\d{1,2} \S+ à \d{1,2} h \d{2} · dans le second dossier$/);
    expect(fs.readdirSync(path.join(dossier, "second")).filter(n => n.endsWith(".sqlite.gz"))).toHaveLength(1);
  });

  for (const schema of ["light", "dark"]) {
    test(`au téléphone en ${schema === "light" ? "clair" : "sombre"} : la ligne tient dans l'écran, à 4,5:1`, async ({ page }) => {
      await ouvrirParametres(page, { base: srv.base, largeur: 390, schema });
      const ligne = page.locator("#parSauvegardesCopie");
      await ligne.scrollIntoViewIfNeeded();
      const deborde = await page.evaluate(() => [...document.querySelectorAll("#parSauvegardes, #parSauvegardes *")]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 0.5; })
        .map(e => e.id || e.className || e.tagName));
      expect(deborde).toEqual([]);
      expect(await contraste(page, "#parSauvegardesCopie")).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe("seconde copie en échec", () => {
  let srv;
  let dossier;
  test.beforeAll(async () => {
    // Le second dossier est SOUS un fichier : la copie echoue, la sauvegarde non.
    dossier = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-copie-echec-e2e-"));
    fs.writeFileSync(path.join(dossier, "pas-un-dossier"), "");
    srv = await lancer({ SEREO_BACKUP_COPY_DIR: path.join(dossier, "pas-un-dossier", "second") });
  });
  test.afterAll(async () => {
    if (srv) await srv.arreter();
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  for (const schema of ["light", "dark"]) {
    test(`en ${schema === "light" ? "clair" : "sombre"}, l'échec de la copie se lit, en mots et dans la couleur d'alerte`, async ({ page }) => {
      await ouvrirParametres(page, { base: srv.base, schema });
      await page.locator('[data-action="sauvegarder-maintenant"]').click();
      const alerte = page.locator("#parSauvegardesAlerte");
      await expect(alerte).toHaveText(/^La copie dans le second dossier a échoué \(\d{1,2} \S+ à \d{1,2} h \d{2}\) : .+\. La sauvegarde est faite, mais seulement sur ce disque\.$/);
      await expect(page.locator("#parSauvegardeDerniere")).toHaveText(/ · /);
      const couleurs = await alerte.evaluate(e => ({
        texte: getComputedStyle(e).color,
        alerte: getComputedStyle(document.documentElement).getPropertyValue("--v8-alerte").trim()
      }));
      const hex = couleurs.alerte.replace("#", "");
      expect(couleurs.texte).toBe(`rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`);
      expect(await contraste(page, "#parSauvegardesAlerte")).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe("sans seconde copie", () => {
  let srv;
  test.beforeAll(async () => { srv = await lancer(); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  test("la carte dit qu'elle n'est pas configurée", async ({ page }) => {
    await ouvrirParametres(page, { base: srv.base });
    await expect(page.locator("#parSauvegardesCopie")).toHaveText("Non configurée : les sauvegardes ne sont que sur ce disque.");
  });
});

// --- 2. Decision 6 : un compte non administrateur voit les cartes fermees ----
//
// Le serveur seme tourne sans connexion (tout visiteur y est administrateur) :
// la reponse de /api/me est celle d'un compte « bureau ». Le refus 403 lui-meme
// est tenu par test/garde-fous-routes.test.js.

const BUREAU = { identifiant: "marc", role: "bureau", roleLibelle: "Bureau", administration: false, onglets: "*", separationDesRoles: false, source: "compte" };
const BLOCS_PARAMETRES = ["parSecteursTitre", "parImportsTitre", "parHorizonTitre", "parTourneeTitre", "parDangerTitre"];

test.describe("compte non administrateur", () => {
  let srv;
  test.beforeAll(async () => { srv = await lancer(); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  async function commeBureau(page) {
    await page.route("**/api/me", route => route.fulfill({ json: BUREAU }));
  }

  test("Paramètres : import, purge, réglages fermés, et la carte dit pourquoi ; « Y aller » reste libre", async ({ page }) => {
    await commeBureau(page);
    await ouvrirParametres(page, { base: srv.base });
    for (const titre of BLOCS_PARAMETRES) {
      const carte = page.locator(`article[aria-labelledby="${titre}"]`);
      await expect(carte.locator(":scope > .par-reserve-note"), titre).toHaveText("Réservé aux administrateurs.");
      const ouverts = await carte.locator("input, select, textarea, button").evaluateAll(els => els
        .filter(e => !e.disabled && !e.closest("[data-appareil]"))
        .map(e => e.id || e.dataset.action || e.name || e.className));
      expect(ouverts, `${titre} : commandes encore ouvertes`).toEqual([]);
    }
    await expect(page.locator('[data-action="purge-orders"]')).toBeDisabled();
    await expect(page.locator("#parHorizonSlider")).toBeDisabled();
    await expect(page.locator("#tourneeSpeedSlider")).toBeDisabled();
    // Le logo (dans « Theme ») : ferme ; le mode clair / sombre, reglage de cet appareil, libre.
    await expect(page.locator("#brandImageInput")).toBeDisabled();
    await expect(page.locator('[data-action="select-color-scheme"]').first()).toBeEnabled();
    const yAller = page.locator("#parNavigation button");
    expect(await yAller.count()).toBeGreaterThan(0);
    for (const bouton of await yAller.all()) await expect(bouton).toBeEnabled();
  });

  test("Journée : les imports sont fermés et disent pourquoi", async ({ page }) => {
    await commeBureau(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(srv.base + "/#journee", { waitUntil: "networkidle" });
    const panneau = page.locator("#journee .panel.visual-panel[data-reserve-admin]");
    await expect(panneau.locator(":scope > .par-reserve-note")).toHaveText("Réservé aux administrateurs.");
    for (const id of ["#importVentesButton", "#importStockButton", "#ventesFile", "#stockFile"]) {
      await expect(page.locator(id), id).toBeDisabled();
    }
    const entete = page.locator('#enteteActions [data-action="importer-ventes"]');
    await expect(entete).toHaveCount(1);
    await expect(entete).toBeDisabled();
    await expect(entete).toHaveAttribute("title", "Réservé aux administrateurs.");
  });

  for (const schema of ["light", "dark"]) {
    test(`au téléphone en ${schema === "light" ? "clair" : "sombre"} : la note se lit (4,5:1) et rien ne déborde`, async ({ page }) => {
      await commeBureau(page);
      await ouvrirParametres(page, { base: srv.base, largeur: 390, schema });
      const note = page.locator('article[aria-labelledby="parDangerTitre"] > .par-reserve-note');
      await note.scrollIntoViewIfNeeded();
      await expect(note).toBeVisible();
      expect(await contraste(page, 'article[aria-labelledby="parDangerTitre"] > .par-reserve-note')).toBeGreaterThanOrEqual(4.5);
      const deborde = await page.evaluate(() => [...document.querySelectorAll("#parametres .par-reserve-note")]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 0.5; })
        .map(e => e.parentElement?.getAttribute("aria-labelledby") || e.parentElement?.className));
      expect(deborde).toEqual([]);
    });
  }

  test("témoin : l'administrateur n'a ni note ni commande fermée", async ({ page }) => {
    await ouvrirParametres(page, { base: srv.base });
    await expect(page.locator(".par-reserve-note")).toHaveCount(0);
    await expect(page.locator('[data-action="purge-orders"]')).toBeEnabled();
    await expect(page.locator("#parHorizonSlider")).toBeEnabled();
    await expect(page.locator("#tourneeSpeedSlider")).toBeEnabled();
  });
});

// --- 2 bis. Le livreur lit le stock, il ne le modifie pas (relecture du 26/09)
//
// Le serveur refuse au livreur PATCH /api/stock/:id (refuserAuLivreur, tenu par
// test/garde-fous-routes.test.js). L'ecran lui laissait − / +, la quantite et
// le seuil ouverts : il l'apprenait au clic (403), ou quand la file hors ligne
// retirait le geste. Ils sont fermes, et l'ecran dit pourquoi.

const LIVREUR = { identifiant: "julie", role: "livreur", roleLibelle: "Livreur", administration: false, onglets: "*", separationDesRoles: false, source: "compte" };

test.describe("compte livreur : le stock se lit, il ne se modifie pas", () => {
  let srv;
  test.beforeAll(async () => { srv = await lancer(); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  const commandesOuvertes = (page, conteneur) => page.locator(`${conteneur} input, ${conteneur} button[data-stock-delta]`).evaluateAll(els => ({
    total: els.length,
    ouvertes: els.filter(e => !e.disabled).map(e => e.id || e.getAttribute("aria-label"))
  }));

  async function ouvrir(page, onglet, me, { largeur = 1440, schema = "light" } = {}) {
    await page.addInitScript(s => { try { localStorage.setItem("sereo:colorScheme", s); } catch { /* sans stockage */ } }, schema);
    if (me) await page.route("**/api/me", route => route.fulfill({ json: me }));
    await page.setViewportSize({ width: largeur, height: largeur < 800 ? 844 : 900 });
    await page.goto(`${srv.base}/#${onglet}`, { waitUntil: "networkidle" });
  }

  test("Stock : quantité, seuil, − et + fermés, et la note dit pourquoi ; aucun ajustement ne part", async ({ page }) => {
    await ouvrir(page, "stock", LIVREUR);
    await expect(page.locator("#stockList .stk-ligne").first()).toBeVisible();
    await expect(page.locator("#stkReserveNote")).toBeVisible();
    await expect(page.locator("#stkReserveNote")).toHaveText("Réservé au bureau et à la préparation.");
    const { total, ouvertes } = await commandesOuvertes(page, "#stockList");
    expect(total, "temoin : aucune commande de stock a l'ecran").toBeGreaterThan(0);
    expect(ouvertes, "commandes de stock encore ouvertes au livreur").toEqual([]);
    // Un bouton reste ouvert (un ancien rendu) : le geste ne part pas pour autant.
    const patchs = [];
    page.on("request", r => { if (r.method() === "PATCH" && r.url().includes("/api/stock/")) patchs.push(r.url()); });
    const plus = page.locator("#stockList button[data-stock-delta='1']").first();
    await plus.evaluate(b => b.removeAttribute("disabled"));
    await plus.click();
    await expect(page.locator(".toast").filter({ hasText: "Réservé au bureau et à la préparation." }).first()).toBeVisible();
    expect(patchs).toEqual([]);
  });

  test("Stock : /api/me qui répond APRÈS le premier rendu ferme quand même les commandes", async ({ page }) => {
    let repondre;
    const retenue = new Promise(r => { repondre = r; });
    await page.route("**/api/me", async route => { await retenue; await route.fulfill({ json: LIVREUR }); });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${srv.base}/#stock`);
    await expect(page.locator("#stockList .stk-ligne").first()).toBeVisible();
    // Avant la reponse : rien ne change (ouvert, sans note).
    expect((await commandesOuvertes(page, "#stockList")).ouvertes.length).toBeGreaterThan(0);
    await expect(page.locator("#stkReserveNote")).toBeHidden();
    repondre();
    await expect.poll(async () => (await commandesOuvertes(page, "#stockList")).ouvertes).toEqual([]);
    await expect(page.locator("#stkReserveNote")).toBeVisible();
  });

  for (const schema of ["light", "dark"]) {
    test(`au téléphone en ${schema === "light" ? "clair" : "sombre"} : la note se lit (4,5:1) et rien ne déborde`, async ({ page }) => {
      await ouvrir(page, "stock", LIVREUR, { largeur: 390, schema });
      const note = page.locator("#stkReserveNote");
      await note.scrollIntoViewIfNeeded();
      await expect(note).toBeVisible();
      expect(await contraste(page, "#stkReserveNote")).toBeGreaterThanOrEqual(4.5);
      const deborde = await page.evaluate(() => [...document.querySelectorAll("#stock .stk-tableau, #stock .stk-tableau *")]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 0.5; })
        .map(e => e.id || e.className || e.tagName));
      expect(deborde).toEqual([]);
    });
  }

  test("témoin : le bureau et l'administrateur gardent le stock ouvert, sans note", async ({ page }) => {
    await ouvrir(page, "stock", BUREAU);
    await expect(page.locator("#stockList .stk-ligne").first()).toBeVisible();
    await expect(page.locator("#stkReserveNote")).toBeHidden();
    expect((await commandesOuvertes(page, "#stockList")).ouvertes.length).toBeGreaterThan(0);
    const admin = await page.context().newPage();
    await admin.goto(`${srv.base}/#stock`, { waitUntil: "networkidle" });
    await expect(admin.locator("#stockList .stk-ligne").first()).toBeVisible();
    await expect(admin.locator("#stkReserveNote")).toBeHidden();
    expect((await commandesOuvertes(admin, "#stockList")).ouvertes.length).toBeGreaterThan(0);
  });
});

// --- 3. Mot de passe d'environnement court : plus de bandeau a l'ecran
//
// Le bandeau rouge (25/09) est retire le 26/09, a la demande de Thomas : il
// changera le mot de passe plus tard. Le serveur le signale toujours dans son
// journal, et /api/me a l'administration (tenus par
// test/garde-fous-mot-de-passe.test.js). Serveur seme AVEC connexion (port
// 3601, un seul endroit), mot de passe de 11 caracteres.

const lancerAvecConnexion = motDePasse => demarrer({ port: 3601, env: { SEREO_AUTH_USER: "admin-e2e", SEREO_AUTH_PASSWORD: motDePasse, SEREO_AUTH_MAX_ATTEMPTS: "50" } });

async function seConnecter(page, base, identifiant, motDePasse, { largeur = 1440, schema = "light" } = {}) {
  await page.addInitScript(s => { try { localStorage.setItem("sereo:colorScheme", s); } catch { /* sans stockage */ } }, schema);
  await page.setViewportSize({ width: largeur, height: largeur < 800 ? 844 : 900 });
  await page.goto(base + "/login", { waitUntil: "networkidle" });
  await page.fill("#username", identifiant);
  await page.fill("#password", motDePasse);
  await Promise.all([page.waitForURL(u => !String(u).includes("/login")), page.getByRole("button", { name: "Se connecter" }).click()]);
  await page.waitForLoadState("networkidle");
}

test.describe("mot de passe d'environnement court", () => {
  const COURT = "motdepasse1";
  let srv;
  test.beforeAll(async () => { srv = await lancerAvecConnexion(COURT); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  for (const largeur of [1440, 390]) {
    test(`${largeur < 800 ? "au téléphone" : "au bureau"}, l'administrateur n'a aucun bandeau, bien que le serveur le sache court`, async ({ page }) => {
      await seConnecter(page, srv.base, "admin-e2e", COURT, { largeur });
      // Temoin positif : la condition qui montrait le bandeau est bien la.
      // Sans elle, l'absence ci-dessous ne distinguerait rien.
      const moi = await page.evaluate(async () => (await fetch("/api/me")).json());
      expect(moi.motDePasseEnvironnementCourt).toBe(true);
      // L'ecran a lu /api/me : le titre dit l'identifiant qui en vient.
      await expect(page.getByText("admin-e2e").first()).toBeAttached();
      await expect(page.locator("#bandeauMotDePasseCourt")).toHaveCount(0);
      await expect(page.getByText("moins de 12 caractères")).toHaveCount(0);
      await expect(page.getByText("Mot de passe d’administration trop court")).toHaveCount(0);
    });
  }
});

// --- 4. « Se deconnecter » pendant une lecture en vol
//
// Une lecture de l'ecran partie pendant la deconnexion recoit 401 (la session
// est fermee cote serveur des le POST /logout depuis le 25/09 ; avant, des que
// la reponse effacait le cookie). apiFetch envoyait alors la page vers
// /login?next=... : une SECONDE navigation, qui interrompait celle du
// formulaire (net::ERR_ABORTED : connexion.spec.js rougissait parfois).
// Le montage : les lectures de Parametres sont retenues au navigateur, le
// serveur traite la deconnexion, elles partent, puis la reponse de la
// deconnexion est rendue a la page. Sans service worker : page.route ne voit
// pas les requetes qu'il fait.

test.describe("se déconnecter pendant une lecture", () => {
  const MOT_DE_PASSE = "mot-de-passe-long-sans-valeur-e2e";
  let srv;
  test.beforeAll(async () => { srv = await lancerAvecConnexion(MOT_DE_PASSE); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  test("une lecture en vol ne détourne pas la déconnexion : une seule navigation, vers /login", async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();
    await seConnecter(page, srv.base, "admin-e2e", MOT_DE_PASSE);
    const versLogin = [];
    page.on("framenavigated", f => {
      if (f !== page.mainFrame()) return;
      const u = new URL(f.url());
      if (u.pathname.startsWith("/login")) versLogin.push(u.pathname + u.search);
    });
    const retenues = [];
    const statuts = [];
    page.on("response", r => { if (r.url().includes("/api/")) statuts.push(r.status()); });
    await page.route("**/api/**", route => { retenues.push(route); });
    await page.route("**/logout", async route => {
      const reponse = await route.fetch({ maxRedirects: 0 });
      await page.unroute("**/api/**");
      for (const r of retenues) await r.continue().catch(() => {});
      // Le temps que les 401 reviennent et que la page les traite.
      await new Promise(r => setTimeout(r, 800));
      await route.fulfill({ response: reponse }).catch(() => {});
    });
    await page.locator(".sidebar").getByRole("button", { name: "Paramètres et compte" }).click();
    await expect.poll(() => retenues.length).toBeGreaterThan(0);
    let erreur = null;
    await Promise.all([
      page.waitForURL(/\/login/).catch(e => { erreur = e.message.split("\n")[0]; }),
      page.locator(".sidebar").getByRole("button", { name: "Se déconnecter" }).click()
    ]);
    await expect.poll(() => new URL(page.url()).pathname).toBe("/login");
    // Temoin du montage : des lectures sont bien parties apres la fermeture de
    // la session, et ont recu 401 (sinon rien n'aurait ete eprouve).
    expect(statuts.filter(s => s === 401).length).toBeGreaterThan(0);
    expect({ versLogin, erreur }).toEqual({ versLogin: ["/login"], erreur: null });
    await ctx.close();
  });
});
