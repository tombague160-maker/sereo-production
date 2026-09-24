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
