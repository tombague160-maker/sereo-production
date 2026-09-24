// E2E : la carte « Sauvegardes » de Parametres (decision de Thomas du 24/09).
//
// Le serveur sauvegardait seul et savait quand ca echouait ; l'ecran ne le
// disait nulle part. La carte montre la derniere (date, taille), une alerte en
// mots et en couleur d'alerte, et -- pour l'administration -- « Sauvegarder
// maintenant » et « Telecharger la derniere ».
//
// Trois serveurs semes, l'un apres l'autre, sur le MEME port (3522) :
//   1. telechargement ouvert (SEREO_ENABLE_DB_EXPORT=1 : ces serveurs tournent
//      sans connexion, ou tout visiteur est administrateur) ;
//   2. sauvegardes en echec (le dossier des sauvegardes est sous un FICHIER) ;
//   3. telechargement ferme (la variable absente, comme en production).
// Les regles (403 pour un non-administrateur, retention, « perimee ») sont
// tenues par test/sauvegardes.test.js ; ici, ce que l'ecran en montre.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

// Un seul port pour les trois (test/ports-e2e.test.js).
const lancer = (env = {}) => demarrer({ port: 3522, env });

async function ouvrir(page, { largeur = 1440, schema = "light", base } = {}) {
  await page.addInitScript(s => { try { localStorage.setItem("sereo:colorScheme", s); } catch { /* sans stockage */ } }, schema);
  await page.setViewportSize({ width: largeur, height: largeur < 800 ? 844 : 900 });
  await page.goto(base + "/#parametres", { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", schema);
  await expect(page.locator("#parSauvegardeDerniere")).not.toHaveText("Chargement…");
}

// Le contraste de chaque texte visible (fond opaque le plus proche).
function contrastes(page, selecteur) {
  return page.evaluate(sel => {
    const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fond = e => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] === 1)) return c.slice(0, 3); } return [255, 255, 255]; };
    return [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length && e.textContent.trim()).map(e => {
      const [a, b] = [lum(rgb(getComputedStyle(e).color).slice(0, 3)), lum(fond(e))].sort((x, y) => y - x);
      return { quoi: `${e.id || e.tagName} « ${e.textContent.trim().slice(0, 24)} »`, ratio: Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100 };
    });
  }, selecteur);
}

const TEXTES = "#parSauvegardes h3, #parSauvegardes dt, #parSauvegardes dd, #parSauvegardes .par-aide, #parSauvegardes .button, #parSauvegardesAlerte";

test.describe("téléchargement ouvert", () => {
  let srv;
  test.beforeAll(async () => { srv = await lancer({ SEREO_ENABLE_DB_EXPORT: "1" }); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  test("aucune sauvegarde : la carte le dit, « Sauvegarder maintenant » la fait, « Télécharger » la rend", async ({ page }) => {
    await ouvrir(page, { base: srv.base });
    const carte = page.locator("#parSauvegardes");
    await expect(carte.getByRole("heading", { name: "Sauvegardes" })).toBeVisible();
    // Le serveur seme n'a encore rien sauvegarde : c'est une alerte, en mots.
    const alerte = page.locator("#parSauvegardesAlerte");
    await expect(alerte).toBeVisible();
    await expect(alerte).toHaveAttribute("role", "alert");
    await expect(alerte).toHaveText("Aucune sauvegarde pour l’instant.");
    await expect(page.locator("#parSauvegardeDerniere")).toHaveText("Aucune");
    await expect(page.locator("#parSauvegardeTelecharger")).toBeHidden();

    const reponse = page.waitForResponse(r => r.url().endsWith("/api/backup/now") && r.request().method() === "POST");
    await carte.getByRole("button", { name: "Sauvegarder maintenant" }).click();
    expect((await reponse).status()).toBe(200);
    await expect(alerte).toBeHidden();
    await expect(page.locator("#parSauvegardeDerniere")).toHaveText(/^\d{1,2} \S+ à \d{1,2} h \d{2} · [\d,]+ (o|ko|Mo)$/);
    await expect(page.locator("#parSauvegardesGardees")).toHaveText(/^1 sauvegarde sur 1 jour, depuis le \d{1,2}(er)? \S+$/);

    // Le lien rend bien la base, compressee.
    const lien = page.locator("#parSauvegardeTelecharger");
    await expect(lien).toBeVisible();
    await expect(lien).toHaveAttribute("download", "");
    const fichier = await page.request.get(srv.base + await lien.getAttribute("href"));
    expect(fichier.status()).toBe(200);
    expect(fichier.headers()["content-disposition"]).toMatch(/^attachment; filename="db-.*-manuelle\.sqlite\.gz"$/);
    const octets = await fichier.body();
    expect([octets[0], octets[1]]).toEqual([0x1f, 0x8b]);
  });

  for (const schema of ["light", "dark"]) {
    test(`au téléphone en ${schema === "light" ? "clair" : "sombre"} : 44 px, rien ne déborde, textes à 4,5:1`, async ({ page }) => {
      await ouvrir(page, { base: srv.base, largeur: 390, schema });
      const carte = page.locator("#parSauvegardes");
      await carte.scrollIntoViewIfNeeded();
      const gestes = await page.locator("#parSauvegardesGestes .button").evaluateAll(els => els
        .filter(e => e.getClientRects().length)
        .map(e => ({ quoi: e.textContent.trim(), h: Math.round(e.getBoundingClientRect().height * 10) / 10 })));
      expect(gestes.map(g => g.quoi)).toEqual(["Sauvegarder maintenant", "Télécharger la dernière"]);
      expect(gestes.filter(g => g.h < 44)).toEqual([]);
      const deborde = await page.evaluate(() => [...document.querySelectorAll("#parSauvegardes, #parSauvegardes *")]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 0.5; })
        .map(e => e.id || e.className || e.tagName));
      expect(deborde).toEqual([]);
      const releve = await contrastes(page, TEXTES);
      expect(releve.length).toBeGreaterThanOrEqual(7);
      expect(releve.filter(r => r.ratio < 4.5)).toEqual([]);
    });
  }

  test("au clavier, « Télécharger la dernière » montre son anneau de focus", async ({ page }) => {
    await ouvrir(page, { base: srv.base });
    const lien = page.locator("#parSauvegardeTelecharger");
    await expect(lien).toBeVisible();
    await page.locator('[data-action="sauvegarder-maintenant"]').focus();
    await page.keyboard.press("Tab");
    await expect(lien).toBeFocused();
    expect(await lien.evaluate(e => getComputedStyle(e).boxShadow)).not.toBe("none");
  });

  test("hors ligne, « Sauvegarder maintenant » refuse tout de suite, sans se mettre en file", async ({ page, context }) => {
    // Une sauvegarde rejouee des heures plus tard ne garderait pas l'etat voulu :
    // elle n'entre pas dans la file des ecritures (JAMAIS_EN_FILE).
    await ouvrir(page, { base: srv.base });
    const avant = await page.locator("#parSauvegardeDerniere").textContent();
    const envois = [];
    page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/api/backup/now")) envois.push(r.url()); });
    await context.setOffline(true);
    await page.locator('[data-action="sauvegarder-maintenant"]').click();
    const toast = page.getByText(/^Sauvegarde impossible : /);
    await expect(toast).toBeVisible();
    await expect(toast).not.toContainText("sera envoyé");
    await context.setOffline(false);
    // Le reseau revenu, rien ne part (la file n'avait rien) : la derniere n'a pas bouge.
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("#parSauvegardeDerniere")).toHaveText(avant);
    expect(envois.length).toBeLessThanOrEqual(1);
  });

  test("un compte non administrateur lit la carte, sans ses gestes, et sait pourquoi", async ({ page }) => {
    // Ce serveur tourne sans connexion (tout le monde est administrateur) : la
    // reponse est rendue telle que le serveur la donne a un livreur -- le
    // refus lui-meme (403) est tenu par test/sauvegardes.test.js.
    await page.route("**/api/storage/status", async route => {
      const vraie = await (await route.fetch()).json();
      vraie.sauvegardes.administration = false;
      vraie.sauvegardes.telechargement = { permis: false, raison: "Reserve aux administrateurs." };
      await route.fulfill({ json: vraie });
    });
    await ouvrir(page, { base: srv.base });
    await expect(page.locator("#parSauvegardeDerniere")).toHaveText(/ · /);
    await expect(page.locator("#parSauvegardesGestes")).toBeHidden();
    await expect(page.locator("#parSauvegardesNote")).toHaveText("Sauvegarder et télécharger : réservé aux administrateurs.");
  });
});

test.describe("sauvegardes en échec", () => {
  let srv;
  let dossier;
  test.beforeAll(async () => {
    // Le dossier des sauvegardes est SOUS un fichier : il ne peut pas etre
    // cree, chaque sauvegarde echoue (un montage perdu, un disque en panne).
    dossier = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-sauv-echec-"));
    fs.writeFileSync(path.join(dossier, "pas-un-dossier"), "");
    srv = await lancer({ SEREO_BACKUP_DIR: path.join(dossier, "pas-un-dossier", "backups") });
  });
  test.afterAll(async () => {
    if (srv) await srv.arreter();
    fs.rmSync(dossier, { recursive: true, force: true });
  });

  for (const schema of ["light", "dark"]) {
    test(`en ${schema === "light" ? "clair" : "sombre"}, l'échec se lit : en mots, dans la couleur d'alerte, à 4,5:1`, async ({ page }) => {
      // Une saisie : sa sauvegarde automatique part, et echoue.
      const saisie = await page.request.patch(srv.base + "/api/settings/tournee", { data: { averageSpeedKmh: 30 + (schema === "dark" ? 1 : 0) } });
      expect(saisie.status()).toBe(200);
      await ouvrir(page, { base: srv.base, schema });
      const alerte = page.locator("#parSauvegardesAlerte");
      await expect(alerte).toBeVisible();
      await expect(alerte).toHaveText(/^La dernière sauvegarde a échoué \(\d{1,2} \S+ à \d{1,2} h \d{2}\) : .+\. Les données sont enregistrées, mais pas sauvegardées\.$/);
      const couleurs = await alerte.evaluate(e => ({
        texte: getComputedStyle(e).color,
        alerte: getComputedStyle(document.documentElement).getPropertyValue("--v8-alerte").trim()
      }));
      const hex = couleurs.alerte.replace("#", "");
      const attendu = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
      expect(couleurs.texte).toBe(attendu);
      const releve = await contrastes(page, TEXTES);
      expect(releve.some(r => r.quoi.startsWith("parSauvegardesAlerte"))).toBe(true);
      expect(releve.filter(r => r.ratio < 4.5)).toEqual([]);
    });
  }

  test("« Sauvegarder maintenant » échoue à voix haute, et l'alerte reste", async ({ page }) => {
    await ouvrir(page, { base: srv.base });
    await page.locator('[data-action="sauvegarder-maintenant"]').click();
    await expect(page.getByText(/^Sauvegarde impossible : /)).toBeVisible();
    await expect(page.locator("#parSauvegardesAlerte")).toHaveText(/^La dernière sauvegarde a échoué/);
    await expect(page.locator("#parSauvegardeDerniere")).toHaveText("Aucune");
  });
});

test.describe("téléchargement fermé (sans connexion, sans SEREO_ENABLE_DB_EXPORT)", () => {
  let srv;
  test.beforeAll(async () => { srv = await lancer(); });
  test.afterAll(async () => { if (srv) await srv.arreter(); });

  test("pas de lien, la raison dite, et la route refuse", async ({ page }) => {
    await ouvrir(page, { base: srv.base });
    await page.locator('[data-action="sauvegarder-maintenant"]').click();
    await expect(page.locator("#parSauvegardesAlerte")).toBeHidden();
    await expect(page.locator("#parSauvegardeDerniere")).toHaveText(/ · /);
    await expect(page.locator("#parSauvegardeTelecharger")).toBeHidden();
    await expect(page.locator("#parSauvegardesNote")).toHaveText(/^Téléchargement fermé : sans connexion, tout visiteur est administrateur/);
    const refus = await page.request.get(srv.base + "/api/sauvegardes/derniere");
    expect(refus.status()).toBe(403);
    expect((await refus.body())[0]).not.toBe(0x1f);
  });
});
