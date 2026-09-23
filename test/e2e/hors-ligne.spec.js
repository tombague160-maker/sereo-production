// E2E : une ecriture faite hors ligne n'est pas perdue.
//
// CE QUE CE BANC MESURE, ET QUE test/file-attente.test.js NE PEUT PAS MESURER.
// Le banc unitaire remplace indexedDB par une doublure : il juge la LOGIQUE de
// rejeu, jamais le stockage. Ici tout est reel -- vrai navigateur, vrai
// indexedDB, vraie coupure par `context.setOffline(true)`, vrai serveur derriere.
// Un banc qui passerait la-bas et echouerait ici designerait un defaut de
// stockage ; l'inverse, un defaut de logique.
//
// LE DEFAUT QU'IL FERME, mesure le 18/09 sur le code publie en v1.30.0 :
//   32 ecritures reseau dans app.js
//    0 ecouteur "online" / "offline"
//    0 ecouteur "sync" dans le service worker
// La LECTURE hors ligne existait (network-first 3 s puis cache), l'ECRITURE
// etait perdue -- et c'est justement cet ecart qui rendait le defaut invisible :
// l'application AVAIT L'AIR de fonctionner hors ligne.
//
// POURQUOI LES REGLAGES DE TOURNEE. Ils sont la seule ecriture atteignable dans
// un environnement de test vide : les clients viennent d'imports Excel, et
// POST /api/clients rend 404. Un curseur, lui, ecrit toujours. Le choix n'est
// pas cosmetique -- un banc bati sur une liste vide ne mesurerait rien.

const { test, expect } = require("./tuiles");

const ONGLET_REGLAGES = "parametres";
const DEBOUNCE_MS = 500;

/** Ouvre l'application et va sur l'onglet des reglages de tournee. */
async function ouvrirReglages(page) {
  await page.goto("/", { waitUntil: "networkidle" });
  // La barre laterale n'a plus de section depliable : ses huit entrees
  // sont toujours visibles, il n'y a plus rien a ouvrir avant de mesurer.
  await page.evaluate(id => { location.hash = "#" + id; }, ONGLET_REGLAGES);
  await page.waitForTimeout(600);
  const curseur = page.locator("#tourneeSpeedSlider");
  await expect(curseur, "prealable : le curseur de vitesse doit exister").toHaveCount(1);
  return curseur;
}

/** Bouge le curseur et laisse passer le debounce de 500 ms. */
async function bouger(page, curseur, valeur) {
  await curseur.evaluate((el, v) => {
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, valeur);
  await page.waitForTimeout(DEBOUNCE_MS + 900);
}

/** Lit la file depuis le vrai indexedDB de la page. */
function lireFile(page) {
  return page.evaluate(() => new Promise(resolve => {
    const d = indexedDB.open("sereo-file-attente", 1);
    d.onerror = () => resolve([]);
    d.onsuccess = () => {
      const db = d.result;
      if (!db.objectStoreNames.contains("ecritures")) { db.close(); resolve([]); return; }
      const r = db.transaction("ecritures", "readonly").objectStore("ecritures").getAll();
      r.onsuccess = () => { const v = r.result; db.close(); resolve(v); };
      r.onerror = () => { db.close(); resolve([]); };
    };
  }));
}

test("hors ligne — une ecriture est CONSERVEE, pas perdue", async ({ browser }) => {
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const curseur = await ouvrirReglages(page);

  // Prealable : la file est vide. Sans lui, un residu d'un autre banc ferait
  // passer ce cas sans que la coupure ait rien produit.
  expect(await lireFile(page), "prealable : la file devait etre vide").toEqual([]);

  await ctx.setOffline(true);
  await bouger(page, curseur, 41);

  const file = await lireFile(page);
  expect(file.length, "l'ecriture faite hors ligne a ete PERDUE").toBe(1);
  expect(file[0].url).toContain("/api/settings/tournee");
  expect(file[0].methode).toBe("PATCH");
  expect(JSON.parse(file[0].corps).averageSpeedKmh,
    "le corps de l'ecriture n'a pas ete conserve fidelement").toBe(41);

  await ctx.close();
});

test("hors ligne — l'ecriture PART quand le reseau revient", async ({ browser }) => {
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const curseur = await ouvrirReglages(page);

  await ctx.setOffline(true);
  await bouger(page, curseur, 37);
  expect((await lireFile(page)).length, "prealable : rien n'a ete mis en file").toBe(1);

  // On note ce que le serveur recoit : `online` doit declencher le rejeu.
  //
  // NOTE. Une premiere redaction de ce commentaire affirmait que ce banc
  // attrapait aussi un rejeu qui repasserait par apiFetch. MESURE : il ne
  // l'attrape pas -- en ligne apiFetch reussit, donc rien ne se distingue. Ce
  // que le `fetch` nu protege reellement est mesure par le banc
  // "rejeu — un REFUS du serveur vide la file au lieu de la bloquer".
  const recues = [];
  page.on("response", async r => {
    const q = r.request();
    if (q.url().includes("/api/settings/tournee") && q.method() === "PATCH") {
      recues.push({ corps: q.postData(), statut: r.status() });
    }
  });

  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(2500);

  expect(await lireFile(page), "la file ne s'est pas videe a la reconnexion").toEqual([]);
  expect(recues.length, "aucun PATCH n'est parti apres la reconnexion").toBeGreaterThan(0);
  const dernier = recues[recues.length - 1];
  expect(JSON.parse(dernier.corps).averageSpeedKmh).toBe(37);

  // Et le SERVEUR l'a ACCEPTE -- c'est la preuve qui compte. On la lit sur la
  // reponse au rejeu, et non par un GET ensuite : les bancs de ce fichier
  // tournent en parallele et ecrivent tous le meme reglage, si bien qu'un GET
  // posterieur mesurerait l'ecriture d'un VOISIN. Un nombre du bon ordre de
  // grandeur, du mauvais objet.
  expect(dernier.statut, "le serveur a refuse l'ecriture rejouee").toBe(200);

  await ctx.close();
});

test("hors ligne — l'ecriture SURVIT au rechargement, et part APRES", async ({ browser }) => {
  // C'est la raison d'etre d'indexedDB plutot que d'une variable en memoire :
  // une file en memoire passerait tous les autres bancs de ce fichier et
  // perdrait tout au premier rechargement.
  //
  // POURQUOI ON NE RECHARGE PAS HORS LIGNE, alors que ce serait le scenario le
  // plus naturel. Mesure du 18/09 : `page.reload()` hors ligne rend
  // ERR_INTERNET_DISCONNECTED. Le service worker ne met PAS les navigations en
  // cache (l.126 : `if (request.mode === "navigate") return;`), c'est
  // deliberement ecrit "auth-sensible". L'application ne peut donc pas etre
  // ROUVERTE hors ligne -- "la lecture hors ligne fonctionne" n'est vrai que
  // pour un onglet DEJA OUVERT. C'est une dette reelle, notee dans la charte,
  // et non quelque chose que ce banc doit contourner en silence.
  //
  // On isole donc la propriete voulue autrement : le reseau revient, mais la
  // SEULE route du rejeu est coupee. Le rechargement passe (GET), le rejeu
  // echoue, et l'ecriture doit quand meme etre la de l'autre cote.
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const curseur = await ouvrirReglages(page);

  await ctx.setOffline(true);
  await bouger(page, curseur, 23);
  expect((await lireFile(page)).length, "prealable : rien n'a ete mis en file").toBe(1);

  // Le reseau revient, sauf pour l'ecriture elle-meme.
  let rejeuBloque = true;
  await page.route("**/api/settings/tournee", route => {
    if (route.request().method() === "PATCH" && rejeuBloque) return route.abort();
    return route.continue();
  });
  await ctx.setOffline(false);
  await page.waitForTimeout(1200);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const apres = await lireFile(page);
  expect(apres.length, "la file n'a pas survecu au rechargement : c'est de la memoire, pas du stockage").toBe(1);
  expect(JSON.parse(apres[0].corps).averageSpeedKmh).toBe(23);

  // Le temoin positif : sans lui, une file qui ne se viderait JAMAIS passerait
  // le cas ci-dessus sans rien avoir distingue.
  const recues = [];
  page.on("response", r => {
    const q = r.request();
    if (q.url().includes("/api/settings/tournee") && q.method() === "PATCH") {
      recues.push({ corps: q.postData(), statut: r.status() });
    }
  });
  rejeuBloque = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(2500);

  expect(await lireFile(page), "la file ne se vide plus apres un rechargement").toEqual([]);
  expect(recues.length, "rien n'est parti : le rejeu au demarrage ne marche pas").toBeGreaterThan(0);
  expect(JSON.parse(recues[recues.length - 1].corps).averageSpeedKmh).toBe(23);
  expect(recues[recues.length - 1].statut).toBe(200);

  await ctx.close();
});

test("hors ligne — l'ecriture en attente est VISIBLE a l'ecran", async ({ browser }) => {
  // Une file invisible est pire qu'une absence de file : elle promet en silence.
  // Et le compteur doit survivre a un rafraichissement des donnees, qui reecrit
  // la meme puce avec "À jour" -- sinon la seule trace disparaitrait au premier
  // chargement reussi.
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const curseur = await ouvrirReglages(page);

  await ctx.setOffline(true);
  await bouger(page, curseur, 44);

  const puce = page.locator("#syncStatus");
  await expect(puce, "rien a l'ecran n'annonce l'ecriture en attente").toContainText("en attente");

  await ctx.close();
});

test("hors ligne — l'utilisateur n'est PAS averti d'une perte qui n'a pas eu lieu", async ({ browser }) => {
  // Le message compte autant que le mecanisme. Avant ce lot, l'echec reseau
  // affichait "Erreur : Failed to fetch" -- l'utilisateur concluait que sa
  // saisie etait perdue, et la refaisait. Desormais la donnee est conservee, et
  // le dire en rouge annoncerait exactement le contraire de ce qui s'est passe.
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const curseur = await ouvrirReglages(page);

  await ctx.setOffline(true);
  await bouger(page, curseur, 33);

  const etat = await page.locator("#tourneeSettingsStatus").textContent();
  expect(etat, `la ligne d'etat annonce une erreur : « ${etat} »`).not.toMatch(/^Erreur/);
  expect(etat, "la ligne d'etat ne dit pas que la donnee est conservee").toMatch(/reconnexion/i);

  await ctx.close();
});

test("hors ligne — un envoi de FICHIER n'est jamais mis en file", async ({ browser }) => {
  // Le contre-temoin, et il est necessaire : sans lui, "tout mettre en file"
  // passerait tous les cas precedents. Rejouer un import Excel trois heures
  // plus tard, sur un stock qui a bouge, ferait plus de degats que de refuser.
  //
  // PREMIER JET, ET POURQUOI IL NE VALAIT RIEN. Il faisait un `fetch()` NU
  // depuis page.evaluate. Il mesurait donc LE NAVIGATEUR, pas mon code :
  // supprimer la garde `options.body instanceof FormData` ne le faisait pas
  // broncher. Un vert qui passe quoi qu'on fasse. Il faut passer par le vrai
  // formulaire, donc par apiFetch, ou la garde vit.
  //
  // CE QUE CE BANC NE DISTINGUE PAS, mesure au harnais de mutation. Retirer la
  // garde de apiFetch SEULE ne le fait pas broncher : mettreEnAttente() LEVE de
  // son cote sur un FormData, tenterMiseEnFile() l avale, et le comportement
  // observable est identique. Retirer LES DEUX, en revanche, le tue. La garde
  // cote apiFetch est donc REDONDANTE au sens strict -- elle est conservee
  // parce qu elle evite de piloter un cas ATTENDU par une exception, mais il
  // serait faux de dire que ce banc la protege.
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => { location.hash = "#journee"; });
  await page.waitForTimeout(500);

  const champ = page.locator("#stockFile");
  await expect(champ, "prealable : le champ d'import du stock doit exister").toHaveCount(1);
  await champ.setInputFiles({
    name: "stock.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("PK\u0003\u0004 pas un vrai classeur")
  });

  await ctx.setOffline(true);
  // Depuis la planche 10c, le bouton d'import est DESACTIVE hors ligne, avec
  // sa raison. On soumet donc le formulaire par programme : la requete passe
  // quand meme par apiFetch, ou vit la garde que ce banc protege.
  await expect(page.locator("#importStockButton")).toBeDisabled();
  await expect(page.locator("#importStockButton")).toHaveAttribute("title", "Import impossible hors ligne");
  await page.evaluate(() => document.getElementById("stockForm").requestSubmit());
  await page.waitForTimeout(2500);

  expect(await lireFile(page), "un envoi de fichier a ete mis en file").toEqual([]);
  await ctx.close();
});

test("en ligne — un echec reseau EST mis en file, avec sa cle de geste", async ({ browser }) => {
  // RENVERSE le 23/09 (lot 1 de l'audit geo, H1). Ce banc exigeait l'inverse :
  // `navigator.onLine` n'etant fiable que dans un sens, un echec « en ligne »
  // pouvait signifier que le serveur avait RECU et TRAITE la demande, et la
  // rejouer l'aurait DUPLIQUEE. Le prix mesure par l'audit : en 4G sans debit,
  // le telephone se croit en ligne, et un « Livre » etait perdu derriere le
  // livreur, sous un toast anglais « Failed to fetch ».
  //
  // Le risque de duplication est desormais tenu par le SERVEUR : chaque
  // ecriture porte une cle X-Sereo-Geste, gardee dans la file, et une cle deja
  // vue n'est pas reappliquee (test/livreur-ne-perd-rien.test.js). Ce banc
  // exige donc la mise en file, ET la cle -- sans elle, la mise en file serait
  // exactement le danger que l'ancien banc gardait.
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const curseur = await ouvrirReglages(page);

  await page.route("**/api/settings/tournee", route =>
    route.request().method() === "PATCH" ? route.abort() : route.continue());

  expect(await page.evaluate(() => navigator.onLine),
    "prealable : le navigateur doit se croire EN LIGNE").toBe(true);
  await bouger(page, curseur, 52);

  const file = await lireFile(page);
  expect(file.length, "un echec reseau « en ligne » a perdu l'ecriture").toBe(1);
  expect(JSON.parse(file[0].corps).averageSpeedKmh).toBe(52);
  expect(file[0].entetes["X-Sereo-Geste"], "l'ecriture en file n'a pas de cle : son renvoi pourrait s'appliquer deux fois")
    .toMatch(/^[A-Za-z0-9_-]{8,}$/);
  const etat = await page.locator("#tourneeSettingsStatus").textContent();
  expect(etat, `la ligne d'etat annonce une perte qui n'a pas eu lieu : « ${etat} »`).not.toMatch(/^Erreur|Failed to fetch/);

  await ctx.close();
});

test("rejeu — un REFUS du serveur vide la file au lieu de la bloquer", async ({ browser }) => {
  // Ce que le choix de `fetch` NU pour le rejeu protege VRAIMENT, et que mon
  // commentaire d'origine attribuait a tort a la boucle de re-mise-en-file.
  // apiFetch LEVE sur toute reponse non-ok : un refus du serveur lui arriverait
  // sous la forme d'une exception, donc serait pris pour une panne reseau, donc
  // conserve pour toujours. La file ne se viderait jamais. Avec `fetch` nu, le
  // rejeu VOIT le statut et distingue "le serveur a dit non" de "le reseau n'a
  // pas repondu" -- la distinction dont toute la file depend.
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const curseur = await ouvrirReglages(page);

  await ctx.setOffline(true);
  await bouger(page, curseur, 19);
  expect((await lireFile(page)).length, "prealable : rien n'a ete mis en file").toBe(1);

  // Le reseau revient, mais le serveur refuse cette ecriture-la.
  await page.route("**/api/settings/tournee", route =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 422, contentType: "application/json", body: '{"error":"refus"}' })
      : route.continue());

  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(2500);

  expect(await lireFile(page),
    "un refus 422 a ete pris pour une panne reseau : la file ne se videra jamais").toEqual([]);

  await ctx.close();
});
