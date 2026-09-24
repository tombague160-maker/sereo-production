// E2E : « Ce que l'app sait deja, enfin montre » (lot « donnees utiles », 24/09).
//
//   1. garde-fous de saisie (telephone a 10 chiffres, code postal a 5) : le
//      message sous le champ, a la frappe ; l'envoi bloque ; une fiche deja
//      fausse signalee, jamais reecrite ;
//   2. « Clients a relancer » se remplit des clients qui ont depasse leur
//      rythme (decision 5), sans que leur statut change ;
//   3. la carte « Journal » de Parametres : rien au chargement de l'app, une
//      page a l'ouverture de Parametres, l'auteur de chaque ligne ;
//   4. le bon de livraison imprimable, sans les prix (decision 8) ;
//   5. la recherche de la barre laterale trouve clients, commandes, produits.
//
// Serveur seme sur 3530 (ports reserves au lot : 3530, 3531).

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

const jourDecale = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
};

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  seed.clients.find(c => c.id === "c-tilleuls").telephone = "0381472215";
  // Un client qui ne commande plus : livre tous les 30 jours, la derniere fois
  // il y a 100 jours. Statut « client_actif » ecrit en dur (ce que fait « Confirmer »).
  const marche = { id: "c-marche", nom: "Pharmacie du Marché", rue: "4 place du Marché", ville: "Dole", codePostal: "39100", crmStatus: "client_actif", lat: 47.09, lng: 5.49 };
  // Une fiche enregistree AVANT les garde-fous : numero et code postal faux.
  const faux = { id: "c-faux", nom: "Cabinet Numéro Faux", rue: "2 rue Basse", ville: "Dole", codePostal: "ABCDE", telephone: "abc", crmStatus: "client_actif" };
  seed.clients.push(marche, faux);
  const modele = seed.commandes.find(o => o.id === "o-1");
  for (const [i, jours] of [[1, -190], [2, -160], [3, -130], [4, -100]]) {
    seed.commandes.push({
      ...modele, id: `o-marche-${i}`, clientId: marche.id, clientName: marche.nom, status: "livre",
      address: marche.rue, city: marche.ville, postalCode: marche.codePostal,
      dateCommande: jourDecale(jours), deliveryDate: jourDecale(jours), deliveredAt: `${jourDecale(jours)}T09:00:00Z`
    });
  }
  // Un journal d'avant le lot : 60 actions et un mouvement, sans auteur.
  seed.historique = Array.from({ length: 60 }, (_, i) => ({
    id: `h-ancien-${i}`, date: new Date(Date.now() - (i + 1) * 3600000).toISOString(), type: "Import", message: `ancienne action ${i}`
  }));
  seed.stockMovements = [{
    id: "m-ancien", productId: "st-CH-L", productName: "Changes taille L", sku: "CH-L", type: "sortie", quantity: 4,
    oldQuantity: 104, newQuantity: 100, reason: "Ajustement manuel", createdAt: new Date(Date.now() - 7200000).toISOString(), createdBy: "local"
  }];
  // Relecture adverse (24/09). Une fiche corrigee dans Clients (numero et code
  // postal justes) dont une commande ouverte garde les anciens, faux : la
  // fiche ne les fait pas suivre sur les commandes.
  const profil = { id: "c-profil", nom: "Cabinet Profil Corrigé", rue: "7 rue Proudhon", ville: "Besançon", codePostal: "25000", telephone: "0698765432", crmStatus: "client_actif", lat: 47.24, lng: 6.02 };
  seed.clients.push(profil);
  seed.commandes.push({
    ...modele, id: "o-profil", clientId: profil.id, clientName: profil.nom, status: "pret_livraison", deliveredAt: undefined,
    address: profil.rue, city: profil.ville, postalCode: "250", phone: "06 98 76 54", lat: profil.lat, lng: profil.lng
  });
  // Une consigne de commande : elle part sur le bon (temoin du renvoi interne).
  seed.commandes.find(o => o.id === "o-8").notes = "Code portail 1234";
  srv = await demarrer({ port: 3530, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

const BUREAU = { width: 1440, height: 900 };
const TELEPHONE = { width: 390, height: 844 };

async function ouvrir(page, ecran, { schema = "light", taille = BUREAU } = {}) {
  await page.emulateMedia({ colorScheme: schema });
  await page.setViewportSize(taille);
  await page.goto(`${srv.base}/#${ecran}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
}

/** Les requetes /api parties pendant `geste` (chemin et requete). */
async function requetesPendant(page, geste) {
  const vues = [];
  const noter = r => { if (r.url().includes("/api/")) vues.push(r.url().replace(srv.base, "")); };
  page.on("request", noter);
  try { await geste(); } finally { page.off("request", noter); }
  return vues;
}

// Contraste WCAG entre deux couleurs calculees « rgb(...) ».
function contraste(a, b) {
  const lum = c => {
    const [r, g, bl] = (/rgba?\(([^)]+)\)/.exec(c)[1].split(",").slice(0, 3)).map(v => {
      const s = Number(v) / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Chaque texte visible sous les `selecteurs`, sa couleur et le fond OPAQUE le plus proche. */
function textesEtFonds(page, selecteurs) {
  return page.evaluate(sels => {
    const fondDe = e => {
      for (let n = e; n; n = n.parentElement) {
        const f = getComputedStyle(n).backgroundColor;
        if (f && f !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(f)) return f;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const out = [];
    for (const sel of sels) {
      for (const racine of document.querySelectorAll(sel)) {
        const marcheur = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
        for (let t = marcheur.nextNode(); t; t = marcheur.nextNode()) {
          const e = t.parentElement;
          if (!t.textContent.trim() || !e.checkVisibility()) continue;
          const r = e.getBoundingClientRect();
          if (r.width <= 1 || r.height <= 1 || e.closest(".sr-only")) continue;
          out.push({ ou: sel, texte: t.textContent.trim().slice(0, 40), couleur: getComputedStyle(e).color, fond: fondDe(e) });
        }
      }
    }
    return out;
  }, selecteurs);
}

// --- 1. Garde-fous de saisie --------------------------------------------------

test("garde-fous — le message se dit sous le champ, à la frappe, et bloque l'envoi", async ({ page }) => {
  await ouvrir(page, "crm");
  await page.locator('#enteteActions [data-action="cli-nouveau"]').click();
  const dialogue = page.locator("#cliDialogue");
  await dialogue.locator('[name="nom"]').fill("Cabinet Garde");
  const tel = dialogue.locator('[name="telephone"]');
  const cp = dialogue.locator('[name="codePostal"]');

  // Une lettre : faux tout de suite, sans attendre la sortie du champ.
  await tel.pressSequentially("06 12 a");
  const message = dialogue.locator('label:has([name="telephone"]) .garde-message');
  await expect(message).toBeVisible();
  await expect(message).toHaveText(/10 chiffres attendus, par exemple 06 12 34 56 78/);
  await expect(message).toHaveClass(/garde-message--erreur/);
  await expect(message.locator("svg")).toHaveCount(1);
  await expect(tel).toHaveAttribute("aria-invalid", "true");
  expect(await tel.getAttribute("aria-describedby")).toContain(await message.getAttribute("id"));
  // Le message decrit le champ, il ne le renomme pas.
  await expect(dialogue.getByRole("textbox", { name: "Téléphone", exact: true })).toHaveCount(1);

  // Incomplet : rien a la frappe, le message a la sortie du champ.
  await tel.fill("");
  await tel.pressSequentially("06 12");
  await expect(message).toBeHidden();
  await tel.press("Tab");
  await expect(message).toBeVisible();

  await cp.fill("ABCDE");
  const messageCp = dialogue.locator('label:has([name="codePostal"]) .garde-message');
  await expect(messageCp).toHaveText(/5 chiffres attendus, par exemple 25000/);

  // L'envoi est bloque : aucune requete ne part, le dialogue reste ouvert.
  const bloquees = await requetesPendant(page, async () => {
    await dialogue.locator('button[type="submit"]').click();
    await page.waitForTimeout(400);
  });
  expect(bloquees.filter(u => u.startsWith("/api/crm/clients"))).toEqual([]);
  await expect(dialogue).toBeVisible();

  // Juste : les messages partent, la fiche est creee, le numero s'affiche par deux.
  await tel.fill("+33 6 12 34 56 78");
  await cp.fill("25 000");
  await expect(message).toBeHidden();
  await expect(messageCp).toBeHidden();
  const envoi = page.waitForRequest(r => r.method() === "POST" && r.url().endsWith("/api/crm/clients"));
  await dialogue.locator('button[type="submit"]').click();
  await envoi;
  await expect(page.locator("#cliFiche .cli-fiche-nom")).toHaveText("Cabinet Garde");
  await expect(page.locator("#cliFiche .cli-champs")).toContainText("06 12 34 56 78");
  await expect(page.locator("#cliFiche .cli-appeler")).toHaveAttribute("href", "tel:0612345678");
});

test("garde-fous — une fiche enregistrée fausse est signalée, sans bloquer ni réécrire", async ({ page }) => {
  await ouvrir(page, "crm");
  await expect(page.locator("#pageSubtitle")).toContainText("1 fiche à vérifier");
  await page.locator("#crmStatusFilter").selectOption("coordonnees_a_verifier");
  await expect(page.locator("#crmList .cli-nom")).toHaveText(["Cabinet Numéro Faux"]);
  await expect(page.locator("#crmList .cli-meta")).toHaveText(/Téléphone et code postal à vérifier/);

  await page.locator("#crmList .cli-ligne").click();
  const fiche = page.locator("#cliFiche");
  await expect(fiche.locator(".cli-a-verifier")).toHaveText([/Code postal à vérifier/, /Numéro à vérifier/]);
  // « abc » donnait un lien tel: vide : pas de bouton sans un chiffre.
  await expect(fiche.locator(".cli-appeler")).toHaveCount(0);

  // Modifier : la valeur enregistree est signalee, pas bloquee.
  await fiche.locator('[data-action="cli-modifier"]').click();
  const dialogue = page.locator("#cliDialogue");
  const message = dialogue.locator('label:has([name="telephone"]) .garde-message');
  await expect(message).toHaveText(/Numéro enregistré à vérifier/);
  await expect(message).toHaveClass(/garde-message--avertissement/);
  await expect(dialogue.locator('[name="telephone"]')).not.toHaveAttribute("aria-invalid", "true");
  await dialogue.locator('[name="notes"]').fill("Sonner deux fois");
  const envoi = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().includes("/api/crm/clients/c-faux"));
  await dialogue.locator('button[type="submit"]').click();
  expect((await envoi).status()).toBe(200);
  await expect(dialogue).toBeHidden();
  const lu = await (await page.request.get(`${srv.base}/api/crm/clients/c-faux`)).json();
  expect([lu.telephone, lu.codePostal, lu.notes]).toEqual(["abc", "ABCDE", "Sonner deux fois"]);
});

// --- 2. Clients qui ne commandent plus ---------------------------------------

// Integration du 24/09 : « un seul vocabulaire » (lot parcours) -- « Rappel »
// partout, le filtre s'appelle « Clients à rappeler ». Le signal de ce lot dit
// donc « À rappeler », et aucun « relance » ne reste a l'ecran : le banc du lot
// parcours ne peut pas le voir, son seme n'a aucun client signale.
test("relance — « Clients à rappeler » montre le client qui a dépassé son rythme ; son statut ne change pas", async ({ page }) => {
  await ouvrir(page, "crm");
  await expect(page.locator("#pageSubtitle")).toContainText("1 à rappeler");
  await page.locator("#crmStatusFilter").selectOption("client_a_relancer");
  const ligne = page.locator("#crmList .cli-ligne", { hasText: "Pharmacie du Marché" });
  await expect(ligne).toHaveCount(1);
  await expect(ligne.locator(".cli-badge")).toHaveText("À rappeler");
  await ligne.click();
  const fiche = page.locator("#cliFiche");
  await expect(fiche.locator(".cli-relance")).toHaveText("À rappeler · pas de livraison depuis 100 jours · d’habitude tous les 30 jours");
  const textes = await page.locator("#crm").evaluate(e => e.innerText + " " + [...e.querySelectorAll("option")].map(o => o.textContent).join(" "));
  expect(`${textes} ${await page.locator("#pageSubtitle").innerText()}`, "un « relance » reste a l'ecran").not.toMatch(/relance/i);
  await expect(fiche.locator("[data-cli-statut]")).toHaveValue("client_actif");
  // Les clients livres aujourd'hui n'y sont pas.
  await expect(page.locator("#crmList .cli-ligne", { hasText: "Bellevue" })).toHaveCount(0);
});

// --- 3. Le journal -------------------------------------------------------------

test("journal — rien au chargement de l'app ; Paramètres lit une page, avec l'auteur", async ({ page }) => {
  const auChargement = await requetesPendant(page, () => ouvrir(page, "journee"));
  expect(auChargement.filter(u => /\/api\/(historique|journal)/.test(u))).toEqual([]);
  expect(auChargement.length).toBeGreaterThan(5); // temoin : l'instrument voit les requetes

  const geste = await page.request.patch(`${srv.base}/api/stock/st-ALE`, { data: { quantite: 90, reason: "Inventaire" } });
  expect(geste.status()).toBe(200);

  const aLOuverture = await requetesPendant(page, async () => {
    await page.locator('.sidebar-compte').click();
    await expect(page.locator("#parJournal .par-journal-ligne").first()).toBeVisible();
  });
  expect(aLOuverture.filter(u => u.startsWith("/api/journal"))).toEqual(["/api/journal?genre=actions&limite=50"]);

  const lignes = page.locator("#parJournal .par-journal-ligne");
  await expect(lignes).toHaveCount(50);
  await expect(lignes.first().locator(".par-journal-qui")).toHaveText(/dev/);
  // Integration du 24/09 : « 24 sept. · 16 h 00 » (utils/dates.js, lot parcours).
  await expect(lignes.first().locator(".par-journal-quand")).toHaveText(/^\d{1,2}(er)? [a-zéû]+\.? · \d{1,2} h \d{2}$/);
  await expect(lignes.first().locator(".par-journal-quoi")).toContainText("Alèses : stock 100 -> 90");
  await expect(lignes.filter({ hasText: "ancienne action 0" }).locator(".par-journal-qui")).toHaveText(/—/);

  const suite = page.locator("#parJournalSuite");
  await expect(suite).toBeVisible();
  await suite.click();
  await expect(lignes).not.toHaveCount(50);
  expect(await lignes.count()).toBeGreaterThan(60);
  await expect(suite).toBeHidden();

  await page.locator('[data-journal-genre="stock"]').click();
  await expect(page.locator('[data-journal-genre="stock"]')).toHaveAttribute("aria-pressed", "true");
  await expect(lignes).toHaveCount(2);
  await expect(lignes.nth(0)).toContainText("Alèses : −10 · 100 → 90 · Inventaire");
  await expect(lignes.nth(0).locator(".par-journal-qui")).toHaveText(/dev/);
  await expect(lignes.nth(1).locator(".par-journal-qui")).toHaveText(/—/);

  // Les « Mouvements récents » du Stock, eux, ne nomment PERSONNE (relecture
  // adverse du 24/09) : /api/stock-movements part à tous les comptes, et reste
  // dans le cache du service worker. « Qui » se lit ici, au journal. (Le geste
  // est parti hors de la page : on la recharge -- un goto qui ne change que
  // l'ancre ne recharge rien.)
  await page.goto(`${srv.base}/#stock`);
  const reponse = page.waitForResponse(r => r.url().endsWith("/api/stock-movements") && r.status() === 200);
  await page.reload({ waitUntil: "networkidle" });
  const recus = await (await reponse).json();
  expect(recus.map(m => m.productName)).toEqual(["Alèses", "Changes taille L"]); // temoin : le geste y est
  expect(recus.filter(m => "createdBy" in m)).toEqual([]);
  const mouvements = page.locator("#stockMovementList .item");
  await expect(mouvements.first()).toContainText("Inventaire");
  await expect(mouvements.first()).not.toContainText(/par dev|local/);
});

test("journal — un compte qui n'administre pas ne voit pas la carte et ne la demande pas", async ({ page }) => {
  await page.route("**/api/me", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ identifiant: "julie", role: "livreur", roleLibelle: "Livreur", administration: false, onglets: "*", separationDesRoles: false, source: "compte" })
  }));
  const vues = await requetesPendant(page, () => ouvrir(page, "parametres"));
  await expect(page.locator("#parametres")).toHaveClass(/active/);
  // Temoin : la carte existe (cachee, pas absente) et /api/me a bien repondu.
  await expect(page.locator("#parJournal")).toHaveCount(1);
  await expect(page.locator("#sidebarIdentifiant")).toHaveText("julie");
  await expect(page.locator("#parJournal")).toBeHidden();
  expect(vues.filter(u => u.startsWith("/api/journal"))).toEqual([]);
});

// --- 4. Le bon de livraison ----------------------------------------------------

// window.print, remplace : on compte les appels, et on note si le logo du bon
// etait CHARGE a l'instant de l'impression (sinon le papier part sans lui).
async function espionnerImpression(page) {
  await page.addInitScript(() => {
    window.__impressions = 0;
    window.__logoALImpression = null;
    window.print = () => {
      window.__impressions += 1;
      const logo = document.querySelector("#bonLivraison .bon-logo");
      window.__logoALImpression = logo ? logo.naturalWidth : null;
    };
  });
}
const impressions = page => page.evaluate(() => window.__impressions);

test("bon de livraison — depuis le détail : sans les prix, A4, imprimé seul", async ({ page }) => {
  await espionnerImpression(page);
  await ouvrir(page, "commandes");
  await page.locator('#cmdPilules [data-cmd-filtre="toutes"]').click();
  await page.locator('[data-cmd-ouvrir="o-8"]').click();
  const detail = page.locator("#bdc-detail-modal");
  await expect(detail).toHaveAttribute("aria-hidden", "false");
  const numero = (await detail.locator("#bdc-detail-title").textContent()).replace("Bon ", "").trim();
  expect(numero).toMatch(/^CMD-/);

  await detail.locator('[data-action="imprimer-bon"]').click();
  await expect.poll(() => impressions(page)).toBe(1);
  expect(await page.evaluate(() => window.__logoALImpression)).toBeGreaterThan(0);

  const bon = page.locator("#bonLivraison");
  await expect(bon).toBeHidden(); // a l'ecran, jamais
  await page.emulateMedia({ media: "print" });
  await expect(bon).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(detail).toBeHidden();
  const texte = await bon.innerText();
  for (const attendu of ["Bon de livraison", `N° ${numero}`, "EHPAD Résidence Bellevue", "8 chemin des Vignes", "39100 Dole",
    "Changes taille L", "Alèses", "Reçu par (nom)", "Date et signature"]) {
    expect(texte).toContain(attendu);
  }
  // Decision 8 : aucun prix (le seme a 12 € et 5 € l'unite).
  expect(texte).not.toMatch(/€|prix|total|12,00|5,00/i);
  const quantites = await bon.locator(".bon-lignes tbody .bon-quantite").allTextContents();
  expect(quantites).toEqual(["3", "3"]);
  await expect(bon.locator(".bon-logo")).toHaveAttribute("src", /sereo-logo|data:image/);

  // A4, dans les couleurs claires quel que soit le theme.
  const page_ = await page.evaluate(() => {
    for (const feuille of document.styleSheets) {
      let regles;
      try { regles = feuille.cssRules; } catch { continue; }
      for (const r of regles) {
        if (r instanceof CSSMediaRule && /print/.test(r.media.mediaText)) {
          for (const s of r.cssRules) if (s instanceof CSSPageRule) return s.style.getPropertyValue("size");
        }
      }
    }
    return null;
  });
  expect(page_).toMatch(/a4/i);
  // Les couleurs du papier, quel que soit le theme : les regles generiques des
  // tableaux (« th » blanc en sombre) n'atteignent pas le bon.
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ media: "print", colorScheme });
    const couleurs = await bon.evaluate(e => ({
      texte: getComputedStyle(e).color, fond: getComputedStyle(e).backgroundColor,
      entete: getComputedStyle(e.querySelector(".bon-lignes th")).color,
      cellule: getComputedStyle(e.querySelector(".bon-lignes td")).color,
      quantite: getComputedStyle(e.querySelector(".bon-lignes td.bon-quantite")).textAlign
    }));
    expect(couleurs, colorScheme).toEqual({ texte: "rgb(13, 21, 24)", fond: "rgb(255, 255, 255)", entete: "rgb(42, 82, 84)", cellule: "rgb(13, 21, 24)", quantite: "right" });
  }

  // Apres l'impression, la page redevient la page.
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(bon).toBeHidden();
  await expect(page.locator(".sidebar")).toBeVisible();
});

for (const taille of [BUREAU, TELEPHONE]) {
  test(`bon de livraison — depuis l'arrêt de tournée, avec « remis à » (${taille.width} px)`, async ({ page }) => {
    await espionnerImpression(page);
    await ouvrir(page, "livreur", { taille });
    const nom = (await page.locator("#currentClient .arret-nom").textContent()).trim();
    await page.locator("#remisAInput").fill("Accueil");
    await page.locator(".gestes-plus summary").click();
    const bouton = page.locator("#bonLivraisonArretButton");
    await expect(bouton).toBeEnabled();
    if (taille === TELEPHONE) expect((await bouton.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await bouton.click();
    await expect.poll(() => impressions(page)).toBe(1);
    await page.emulateMedia({ media: "print" });
    const texte = await page.locator("#bonLivraison").innerText();
    expect(texte).toContain(nom);
    expect(texte).toContain("Remis à : Accueil");
    expect(texte).not.toMatch(/€/);
  });
}

// --- 5. La recherche de la barre laterale --------------------------------------

test("recherche — clients, commandes, produits ; sans requête ; un vide qui le dit", async ({ page }) => {
  await ouvrir(page, "journee");
  const champ = page.locator("#menuSearch");
  const zone = page.locator("#rechercheResultats");

  const pendant = await requetesPendant(page, async () => {
    await champ.pressSequentially("Pharmacie");
    await expect(zone).toBeVisible();
  });
  expect(pendant).toEqual([]);
  const clients = zone.locator('.recherche-groupe[aria-label="Clients"] .recherche-nom');
  await expect(clients).toHaveText(["Pharmacie Centrale de la Gare", "Pharmacie du Marché"]);
  await expect(zone.locator('.recherche-groupe[aria-label="Commandes"] .recherche-detail').first()).toContainText("Pharmacie");
  for (const bouton of await zone.locator(".recherche-resultat").all()) {
    expect((await bouton.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  // Au clavier : le premier resultat suit le champ, avec son anneau.
  await champ.press("Tab");
  const focus = await page.evaluate(() => ({ texte: document.activeElement.textContent, contour: getComputedStyle(document.activeElement).outlineStyle }));
  expect(focus.texte).toContain("Pharmacie Centrale de la Gare");
  expect(focus.contour).not.toBe("none");

  await zone.locator('.recherche-groupe[aria-label="Clients"] .recherche-resultat', { hasText: "Pharmacie du Marché" }).click();
  await expect(page.locator("#crm")).toHaveClass(/active/);
  await expect(page.locator("#cliFiche .cli-fiche-nom")).toHaveText("Pharmacie du Marché");
  await expect(champ).toHaveValue("");
  await expect(zone).toBeHidden();

  // Un numero de commande : Entree ouvre son detail (aucun ecran ne s'appelle ainsi).
  const commandes = await (await page.request.get(`${srv.base}/api/orders`)).json();
  const numero = commandes.find(o => o.id === "o-8").numero;
  await champ.fill(numero);
  await expect(zone.locator('.recherche-groupe[aria-label="Commandes"] .recherche-nom')).toHaveText([numero]);
  await champ.press("Enter");
  await expect(page.locator("#bdc-detail-modal")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#bdc-detail-title")).toHaveText(`Bon ${numero}`);
  await page.keyboard.press("Escape");

  // Un produit : le Stock, filtre dessus.
  await champ.fill("gants");
  await zone.locator('.recherche-groupe[aria-label="Produits"] .recherche-resultat').click();
  await expect(page.locator("#stock")).toHaveClass(/active/);
  await expect(page.locator("#stockSearch")).toHaveValue("GANTS");
  await expect(page.locator("#stock")).toContainText("Gants nitrile");

  // Rien : on le dit.
  await champ.fill("zzzz");
  await expect(zone.locator(".recherche-vide")).toHaveText("Aucun écran, client, commande ni produit ne correspond à « zzzz ».");
  // Les ecrans se filtrent toujours comme avant.
  await champ.fill("stock");
  await expect(page.locator(".sidebar .tab:not(.is-hidden-by-search)")).toHaveCount(1);
  await expect(zone.locator(".recherche-vide")).toHaveCount(0);
});

// --- 6. Contraste des textes neufs, clair et sombre -----------------------------

for (const schema of ["light", "dark"]) {
  test(`contraste — les textes neufs tiennent 4,5:1 (${schema})`, async ({ page }) => {
    await ouvrir(page, "crm", { schema });
    const mesures = [];
    // La fiche signalee et la fiche a verifier.
    await page.locator("#crmList .cli-ligne", { hasText: "Pharmacie du Marché" }).click();
    mesures.push(...await textesEtFonds(page, ["#cliFiche .cli-relance", "#crmList .cli-badge--relance"]));
    await page.locator("#crmList .cli-ligne", { hasText: "Cabinet Numéro Faux" }).click();
    mesures.push(...await textesEtFonds(page, ["#cliFiche .cli-a-verifier", "#crmList .cli-alerte"]));
    // Le dialogue : l'avertissement, puis l'erreur.
    await page.locator('#cliFiche [data-action="cli-modifier"]').click();
    mesures.push(...await textesEtFonds(page, ["#cliDialogue .garde-message"]));
    await page.locator('#cliDialogue [name="codePostal"]').fill("12a");
    mesures.push(...await textesEtFonds(page, ["#cliDialogue .garde-message--erreur"]));
    await page.locator('#cliDialogue [data-action="cli-fermer"]').last().click();
    // La recherche, sur le vert de la barre.
    await page.locator("#menuSearch").fill("Pharmacie");
    mesures.push(...await textesEtFonds(page, ["#rechercheResultats"]));
    await page.locator("#menuSearch").fill("zzzz");
    mesures.push(...await textesEtFonds(page, ["#rechercheResultats"]));
    await page.locator("#menuSearch").fill("");
    // Le journal.
    await page.locator(".sidebar-compte").click();
    await expect(page.locator("#parJournal .par-journal-ligne").first()).toBeVisible();
    mesures.push(...(await textesEtFonds(page, ["#parJournal"])).slice(0, 40));

    const lieux = new Set(mesures.map(m => m.ou));
    for (const attendu of ["#cliFiche .cli-relance", "#cliFiche .cli-a-verifier", "#cliDialogue .garde-message", "#cliDialogue .garde-message--erreur", "#rechercheResultats", "#parJournal"]) {
      expect(lieux.has(attendu), `rien de mesure dans ${attendu}`).toBe(true);
    }
    const faibles = mesures.map(m => ({ ...m, ratio: Math.round(contraste(m.couleur, m.fond) * 100) / 100 })).filter(m => m.ratio < 4.5);
    expect(faibles).toEqual([]);
  });
}

// --- 7. Relecture adverse (24/09) ----------------------------------------------

test("modifier le profil — un numéro « à vérifier » propre à la commande, revenu tel quel, n'empêche pas d'enregistrer", async ({ page }) => {
  await ouvrir(page, "commandes");
  await page.locator('#cmdPilules [data-cmd-filtre="toutes"]').click();
  await page.locator('[data-cmd-ouvrir="o-profil"]').click();
  const detail = page.locator("#bdc-detail-modal");
  await expect(detail).toHaveAttribute("aria-hidden", "false");
  await detail.locator('[data-action="bdc-edit-client"]').click();
  const formulaire = detail.locator("form.bdc-detail-client-form");
  // L'ecran les signale sans bloquer : c'est la promesse.
  await expect(formulaire.locator('label:has([name="telephone"]) .garde-message')).toHaveText(/Numéro enregistré à vérifier/);
  await expect(formulaire.locator('label:has([name="codePostal"]) .garde-message')).toHaveText(/Code postal enregistré à vérifier/);
  await formulaire.locator('[name="notes"]').fill("Entrée par la cour");
  const envoi = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().includes("/api/clients/c-profil"));
  await formulaire.locator('button[data-action="bdc-save-client"]').click();
  expect((await envoi).status()).toBe(200);
  // La fiche garde son numero et son code postal justes ; les notes partent.
  const lu = await (await page.request.get(`${srv.base}/api/crm/clients/c-profil`)).json();
  expect([lu.telephone, lu.codePostal, lu.notes]).toEqual(["0698765432", "25000", "Entrée par la cour"]);

  // Temoin : un numero TOUCHE part, et le serveur le juge.
  await expect(detail.locator('[data-action="bdc-edit-client"]')).toBeVisible();
  await detail.locator('[data-action="bdc-edit-client"]').click();
  await formulaire.locator('[name="telephone"]').fill("07 11 22 33 44");
  const envoi2 = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().includes("/api/clients/c-profil"));
  await formulaire.locator('button[data-action="bdc-save-client"]').click();
  expect((await envoi2).status()).toBe(200);
  expect((await (await page.request.get(`${srv.base}/api/crm/clients/c-profil`)).json()).telephone).toBe("0711223344");
});

test("bon de livraison — la consigne de la commande y est ; le renvoi « Replanification depuis … » n'y est pas", async ({ page }) => {
  // « Planifier la suite » d'une commande livree : la nouvelle porte d'office
  // la note « Replanification depuis CMD-… ».
  const cree = await page.request.post(`${srv.base}/api/orders/o-1/replan`, { data: { deliveryDate: jourDecale(7) } });
  expect(cree.status()).toBe(201);
  const commandes = await (await page.request.get(`${srv.base}/api/orders`)).json();
  const suite = commandes.find(o => o.parentOrderId === "o-1");
  expect(suite?.notes).toMatch(/^Replanification depuis CMD-/); // temoin : la note existe

  await espionnerImpression(page);
  await ouvrir(page, "commandes");
  const champ = page.locator("#menuSearch");
  const bon = page.locator("#bonLivraison");
  const imprimer = async (numero, fois) => {
    await champ.fill(numero);
    await champ.press("Enter");
    await expect(page.locator("#bdc-detail-title")).toHaveText(`Bon ${numero}`);
    await page.locator('#bdc-detail-modal [data-action="imprimer-bon"]').click();
    await expect.poll(() => impressions(page)).toBe(fois);
    await page.emulateMedia({ media: "print" });
    const texte = await bon.innerText();
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.keyboard.press("Escape");
    return texte;
  };

  // Temoin : une vraie consigne part sur le papier.
  const bonO8 = await imprimer(commandes.find(o => o.id === "o-8").numero, 1);
  expect(bonO8).toContain("Consignes");
  expect(bonO8).toContain("Code portail 1234");

  const bonSuite = await imprimer(suite.numero, 2);
  expect(bonSuite).toContain(`N° ${suite.numero}`);
  expect(bonSuite).not.toContain("Replanification depuis");
  expect(bonSuite).not.toContain("Consignes");
});

test("recherche — un seul caractère : elle ne dit pas avoir cherché les données", async ({ page }) => {
  await ouvrir(page, "journee");
  const champ = page.locator("#menuSearch");
  const zone = page.locator("#rechercheResultats");
  await champ.fill("7");
  // Temoin : aucun ecran ne s'appelle ainsi, et des commandes contiennent un 7.
  await expect(page.locator(".sidebar .tab:not(.is-hidden-by-search)")).toHaveCount(0);
  const commandes = await (await page.request.get(`${srv.base}/api/orders`)).json();
  expect(commandes.filter(o => String(o.numero).includes("7")).length).toBeGreaterThan(0);
  await expect(zone.locator(".recherche-vide")).toHaveText("Aucun écran ne correspond à « 7 ». Tape au moins 2 caractères pour chercher un client, une commande ou un produit.");
  // Deux caracteres : les donnees sont cherchees.
  await champ.fill("CMD");
  await expect(zone.locator('.recherche-groupe[aria-label="Commandes"]')).toBeVisible();
  await expect(zone.locator(".recherche-vide")).toHaveCount(0);
});
