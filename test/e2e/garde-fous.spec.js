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

// --- 3. Mot de passe d'environnement court : un bandeau pour l'administrateur
//
// Serveur seme AVEC connexion (port 3601, un seul endroit), l'un apres l'autre :
// un mot de passe de 11 caracteres, puis un de 26 (temoin). Le journal du
// demarrage et /api/me sont tenus par test/garde-fous-mot-de-passe.test.js.

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

  for (const schema of ["light", "dark"]) {
    test(`en ${schema === "light" ? "clair" : "sombre"}, l'administrateur lit le bandeau (4,5:1), sa croix fait 44 px et montre son focus`, async ({ page }) => {
      await seConnecter(page, srv.base, "admin-e2e", COURT, { schema });
      const bandeau = page.locator("#bandeauMotDePasseCourt");
      await expect(bandeau).toBeVisible();
      await expect(bandeau).toHaveAttribute("role", "alert");
      await expect(bandeau).toContainText("moins de 12 caractères");
      await expect(bandeau).not.toContainText(COURT);
      expect(await contraste(page, "#bandeauMotDePasseCourt strong")).toBeGreaterThanOrEqual(4.5);
      expect(await contraste(page, "#bandeauMotDePasseCourt p")).toBeGreaterThanOrEqual(4.5);
      const croix = bandeau.getByRole("button", { name: "Fermer l’avertissement" });
      const boite = await croix.boundingBox();
      expect(Math.min(boite.width, boite.height)).toBeGreaterThanOrEqual(44);
      await croix.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(croix).toBeFocused();
      expect(await croix.evaluate(e => getComputedStyle(e).outlineStyle)).not.toBe("none");
      await croix.click();
      await expect(bandeau).toHaveCount(0);
    });
  }

  test("au téléphone, le bandeau tient dans l'écran", async ({ page }) => {
    await seConnecter(page, srv.base, "admin-e2e", COURT, { largeur: 390 });
    await expect(page.locator("#bandeauMotDePasseCourt")).toBeVisible();
    const deborde = await page.evaluate(() => [...document.querySelectorAll("#bandeauMotDePasseCourt, #bandeauMotDePasseCourt *")]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 0.5; })
      .map(e => e.tagName));
    expect(deborde).toEqual([]);
  });

  test("témoin : un compte livreur ne le voit pas", async ({ browser }) => {
    const admin = await browser.newContext();
    const pageAdmin = await admin.newPage();
    await seConnecter(pageAdmin, srv.base, "admin-e2e", COURT);
    const creation = await pageAdmin.evaluate(async () => (await fetch("/api/comptes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiant: "livreur-e2e-mdp", motDePasse: "livreur-e2e-sans-valeur-2026", role: "livreur" })
    })).status);
    expect(creation).toBe(201);
    const livreur = await browser.newContext();
    const page = await livreur.newPage();
    await seConnecter(page, srv.base, "livreur-e2e-mdp", "livreur-e2e-sans-valeur-2026");
    await expect(page.locator("#tabNav, .sidebar").first()).toBeVisible();
    await expect(page.locator("#bandeauMotDePasseCourt")).toHaveCount(0);
    await admin.close();
    await livreur.close();
  });
});

test.describe("mot de passe d'environnement long (témoin)", () => {
  let srv;
  test.beforeAll(async () => { srv = await lancerAvecConnexion("mot-de-passe-long-sans-valeur-e2e"); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  test("l'administrateur n'a pas de bandeau", async ({ page }) => {
    await seConnecter(page, srv.base, "admin-e2e", "mot-de-passe-long-sans-valeur-e2e");
    await expect(page.locator("#parSauvegardes, .sidebar").first()).toBeAttached();
    await expect(page.locator("#bandeauMotDePasseCourt")).toHaveCount(0);
  });
});
