// Capture les six planches de canvas.json en PNG (echelle 2x), pour les joindre
// a Claude Design ou a une revue. Lancer depuis la racine du depot :
//   node design/maquettes-v8/capturer.js
// Les PNG sont des produits derives, non versionnes (voir .gitignore).
//
// Aucun antislash dans ce fichier : les heredocs Bash de Windows les mangent
// (piege note dans agents/REPRISE-V8.md, section 11). pathToFileURL gere les
// chemins Windows sans qu'on ait a les reecrire.
const { chromium } = require("playwright");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs");

(async () => {
  const root = path.resolve(__dirname);
  const canvas = JSON.parse(fs.readFileSync(path.join(root, "canvas.json"), "utf8"));
  const out = path.join(root, "captures");
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  for (const planche of canvas.artboards) {
    const page = await browser.newPage({
      viewport: { width: planche.w, height: planche.h },
      deviceScaleFactor: 2
    });
    await page.goto(pathToFileURL(path.join(root, planche.file)).href);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    // Animations d'entree des planches : .55 s plus des decalages jusqu'a .38 s.
    await page.waitForTimeout(1500);
    const nom = planche.file.replace(".dc.html", "") + ".png";
    await page.screenshot({
      path: path.join(out, nom),
      clip: { x: 0, y: 0, width: planche.w, height: planche.h }
    });
    console.log(`${nom}  ${planche.w}x${planche.h}  (${planche.title})`);
    await page.close();
  }
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
