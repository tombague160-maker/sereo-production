// UNE LIGNE PAR ABONNEMENT -- la derniere des trois lignes de liste de la
// charte (§4 : « commande, abonnement, arret »), mesuree sur des DONNEES.
//
// Mesure du 19/09, avant : des cartes a ~9 informations (avatar, nom, ville,
// chip, panier, quatre faits, deux boutons), en colonnes de 330 px.
// Apres : une ligne (disque d'etat, nom, « ville · frequence », badge) ; les
// faits, le panier et les actions dans le sheet que la ligne ouvre.
// 23/09 (planche 3a, decision de Thomas) : au telephone, la ligne passe a
// 96 px et trois rangees (client et etat, echeance et frequence, panier et
// rappel) ; le disque se retire, le badge porte l'etat.
const { test, expect } = require("./tuiles");
const { demarrer } = require("./serveur-seme");

const VUES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const TOL = 1;

test.describe.configure({ mode: "serial" });

let srv;
test.beforeAll(async () => { srv = await demarrer({ port: 3147 }); });
test.afterAll(async () => { if (srv) await srv.arreter(); });

async function ouvrir(browser, vue) {
  const ctx = await browser.newContext({ viewport: VUES[vue] });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  await page.goto(srv.base + "/#abonnements", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  return { ctx, page, erreurs };
}

function hex(chaine) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(chaine || "");
  return m ? "#" + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, "0")).join("").toUpperCase() : null;
}

for (const vue of ["mobile", "desktop"]) {
  test(`charte §4 — une LIGNE par abonnement, quatre informations, en ${vue}`, async ({ browser }) => {
    test.setTimeout(180000);
    const { ctx, page, erreurs } = await ouvrir(browser, vue);
    const r = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const token = n => cs.getPropertyValue(n).trim().toUpperCase();
      const lignes = [...document.querySelectorAll("#subscriptionList .abonnement-ligne")].map(l => {
        const main = l.querySelector(".commande-ligne-main");
        const corps = l.querySelector(".commande-ligne-corps");
        const titre = corps.querySelector("strong");
        const etat = l.querySelector(".etat-commande");
        return {
          nom: titre.textContent.trim().slice(0, 22),
          h: Math.round(l.getBoundingClientRect().height),
          lignesDeTitre: Math.round(titre.getBoundingClientRect().height / parseFloat(getComputedStyle(titre).lineHeight)),
          // Les informations VISIBLES : au bureau (planche 13a) le disque et
          // « ville · frequence » se retirent, le panier, la frequence et la
          // prochaine livraison apparaissent.
          infos: [...main.children].filter(e => e.checkVisibility()).length - 1
            + [...corps.children].filter(e => e.checkVisibility()).length,
          etatFond: getComputedStyle(etat).backgroundColor,
          detail: [...corps.querySelectorAll("span")].find(e => e.checkVisibility())?.textContent.trim(),
          frequence: l.querySelector(".abo-frequence")?.checkVisibility() ? l.querySelector(".abo-frequence").textContent.trim() : null,
          mot: l.querySelector(".pill").textContent.trim(),
          // Au telephone : les rangees visibles de la ligne (nom, badge,
          // echeance, panier), le disque, et le texte des deux rangees.
          rangees: [titre, l.querySelector(".pill"), l.querySelector(".abo-rythme"), l.querySelector(".abo-panier-rappel"),
            ...[...corps.children].filter(e => !e.matches("strong, .abo-rythme, .abo-panier-rappel"))]
            .filter(e => e && e.checkVisibility()).length,
          disque: etat.checkVisibility(),
          rythme: l.querySelector(".abo-rythme")?.textContent.replace(/\s+/g, " ").trim(),
          panierRappel: l.querySelector(".abo-panier-rappel")?.textContent.trim(),
          x: Math.round(l.getBoundingClientRect().left)
        };
      });
      return {
        tokens: { vertClair: token("--v8-vert-clair"), pecheClaire: token("--v8-peche-claire"), surfaceBasse: token("--v8-surface-basse") },
        lignes,
        cartes: document.querySelectorAll("#subscriptionList .subscription-card").length
      };
    });
    expect(erreurs).toEqual([]);
    console.log(`[abonnements/${vue}] ${r.lignes.length} lignes ${r.lignes.map(l => l.h).join("/")} · ${r.lignes.map(l => l.mot).join(" / ")}`);

    expect(r.lignes.length).toBe(3);
    expect(r.cartes, "plus aucune carte dans la liste").toBe(0);
    // Empilees : toutes a la meme abscisse (avant : colonnes de 330 px).
    expect(new Set(r.lignes.map(l => l.x)).size, "les lignes doivent etre empilees, pas en colonnes").toBe(1);
    const parMot = Object.fromEntries(r.lignes.map(l => [l.mot, l]));
    expect(Object.keys(parMot).sort()).toEqual(["Actif", "Arrêté", "En pause"]);
    if (vue === "mobile") {
      // Decision du 23/09 (planche 3a) : la ligne fait 96 px, trois rangees --
      // client et etat, echeance et frequence, panier et rappel. Un nom sur
      // deux lignes l'allonge d'une ligne de nom (20 px), pas plus.
      expect(r.lignes.filter(l => l.lignesDeTitre <= 1 && Math.abs(l.h - 96) > TOL).map(l => `${l.nom} : ${l.h}px`)).toEqual([]);
      expect(r.lignes.filter(l => l.lignesDeTitre > 1 && l.h > 116 + TOL).map(l => `${l.nom} : ${l.h}px`)).toEqual([]);
      // Nom, badge, echeance, panier : quatre informations VISIBLES, sans disque.
      expect(r.lignes.map(l => l.rangees)).toEqual([4, 4, 4]);
      expect(r.lignes.map(l => l.disque)).toEqual([false, false, false]);
      expect(parMot["Actif"].rythme).toMatch(/^[A-Z][a-z]+ (1er|\d+) [a-zéû]+( \d{4})? · tous les 14 j$/);
      expect(parMot["Actif"].panierRappel).toBe("4 Changes taille L · rappel 2 j");
      expect(parMot["En pause"].rythme).toBe("Livraisons suspendues");
      expect(parMot["En pause"].panierRappel).toBe("10 Alèses · mensuel");
      expect(parMot["Arrêté"].rythme).toBe("Plus de livraison");
    } else {
      expect(r.lignes.filter(l => l.lignesDeTitre <= 1 && (l.h < 64 - TOL || l.h > 72 + TOL)).map(l => `${l.nom} : ${l.h}px`)).toEqual([]);
      expect(r.lignes.filter(l => l.lignesDeTitre > 1 && l.h > 96)).toEqual([]);
      // La ligne de la planche 13a : nom et panier, frequence, prochaine, etat.
      expect(r.lignes.map(l => l.infos)).toEqual([5, 5, 5]);
      expect(parMot["Actif"].detail).toBe("4 Changes taille L");
      expect(parMot["En pause"].detail).toBe("10 Alèses");
      expect(parMot["Actif"].frequence).toBe("Toutes les 2 semaines");
      expect(parMot["En pause"].frequence).toBe("Tous les mois");
    }
    await ctx.close();
  });
}

test("la ligne ouvre un SHEET avec les faits et les actions ; « Mettre en pause » le ferme et change le mot", async ({ browser }) => {
  test.setTimeout(180000);
  const { ctx, page, erreurs } = await ouvrir(browser, "mobile");
  const ligne = page.locator("#subscriptionList .abonnement-ligne", { hasText: "Actif" }).first();
  const nom = (await ligne.locator("strong").textContent()).trim();
  await ligne.locator(".commande-ligne-main").click();
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const d = document.getElementById("abonnementDetailDialog");
    return {
      ouvert: d.open, titre: document.getElementById("abonnementDetailTitre").textContent.trim(),
      faits: [...d.querySelectorAll(".sub-facts small")].map(s => s.textContent.trim()),
      actions: [...d.querySelectorAll(".card-actions .button")].map(b => b.textContent.trim()),
      rayon: getComputedStyle(d).borderTopLeftRadius
    };
  });
  expect(erreurs).toEqual([]);
  console.log(`[abonnements/sheet] ${r.titre} · ${r.faits.join(" / ")} · ${r.actions.join(" / ")}`);
  expect(r.ouvert).toBe(true);
  expect(r.titre).toBe(nom);
  expect(r.faits).toEqual(["Fréquence", "Prochaine échéance", "Rappel", "Panier prévu"]);
  expect(r.actions).toEqual(["Modifier", "Mettre en pause"]);
  expect(r.rayon).toBe("28px");

  await page.locator("#abonnementDetailDialog [data-op=\"toggle-sub\"]").click();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.getElementById("abonnementDetailDialog").open), "le sheet doit se fermer apres l'action").toBe(false);
  const mot = (await page.locator("#subscriptionList .abonnement-ligne", { hasText: nom }).first().locator(".pill").textContent()).trim();
  expect(mot).toBe("En pause");

  // « Modifier » ferme le sheet et ouvre l'editeur : jamais deux dialogues empiles.
  await page.locator("#subscriptionList .abonnement-ligne .commande-ligne-main").first().click();
  await page.waitForTimeout(300);
  await page.locator("#abonnementDetailDialog [data-op=\"edit-sub\"]").click();
  await page.waitForTimeout(300);
  const etat = await page.evaluate(() => ({ sheet: document.getElementById("abonnementDetailDialog").open, editeur: document.getElementById("subscriptionDialog").open }));
  expect(etat).toEqual({ sheet: false, editeur: true });
  await ctx.close();
});
