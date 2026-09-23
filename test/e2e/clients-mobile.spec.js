// E2E : l'ecran Clients AU TELEPHONE -- planches 9a (liste), 8c (fiche, clair),
// 12c (fiche, sombre). La liste : les filtres dans le vert de l'en-tete, la
// ligne « N clients / tri », « Nouveau client » fixe au-dessus de la barre
// basse. La fiche : le nom, les puces, Appeler et Itineraire dans un bloc vert
// avec la fleche de retour ; le reste en cartes. Au bureau, rien ne change
// (clients.spec.js, et le dernier cas de ce banc).
//
// Chaque cas echoue sans le lot : mesure faite en remettant le CSS, le JS et
// le HTML de main (DESIGN.md, section du 23/09 « Clients au telephone »).

const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees } = require("./serveur-seme");

test.describe.configure({ mode: "serial" });

const jourDecale = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
};

// L'ordre attendu du tri « Derniere livraison » : Bellevue et SSIAD livres
// aujourd'hui (le jeu commun), puis les livraisons semees ci-dessous.
const ORDRE_LIVRAISON = [
  "EHPAD Résidence Bellevue", "SSIAD de la Haute Vallée", "EHPAD Les Tilleuls du Val de Loue",
  "Cabinet Infirmier Dupont-Lefebvre", "Clinique Vétérinaire du Doubs"
];

let srv;
test.beforeAll(async () => {
  const seed = jeuDeDonnees();
  const tilleuls = seed.clients.find(c => c.id === "c-tilleuls");
  tilleuls.telephone = "03 81 47 22 15";
  tilleuls.notes = "Livraison par l'entrée de service, côté parking";
  // Assez de clients pour que la liste defile sous le bouton fixe.
  for (const [i, ville, cp] of [[1, "Dole", "39100"], [2, "Besançon", "25000"], [3, "Champagnole", "39300"],
    [4, "Dole", "39100"], [5, "Besançon", "25000"], [6, "Champagnole", "39300"]]) {
    seed.clients.push({ id: `c-foyer-${i}`, nom: `Foyer Logement ${i}`, rue: `${i} rue des Écoles`, ville, codePostal: cp, crmStatus: "client_actif" });
  }
  // Des livraisons passees : Tilleuls il y a 2 jours (et trois plus
  // anciennes -- la fiche en montre quatre, puis « Les N autres »), Dupont il
  // y a 5 jours, la clinique il y a 20 jours.
  const commandes = seed.commandes;
  const modele = commandes.find(o => o.clientId === "c-tilleuls");
  const livree = (id, client, jours) => ({
    ...modele, id, numero: `CMD-2026-${id.slice(2)}`, clientId: client.id, clientName: client.nom, status: "livre",
    address: client.rue, city: client.ville, postalCode: client.codePostal,
    dateCommande: jourDecale(jours - 1), deliveryDate: jourDecale(jours), deliveredAt: `${jourDecale(jours)}T09:00:00Z`
  });
  const dupont = seed.clients.find(c => c.id === "c-dupont");
  const veto = seed.clients.find(c => c.id === "c-veto");
  commandes.push(
    livree("o-910", tilleuls, -2), livree("o-911", tilleuls, -16), livree("o-912", tilleuls, -30), livree("o-913", tilleuls, -44),
    livree("o-920", dupont, -5), livree("o-930", veto, -20)
  );
  srv = await demarrer({ port: 3302, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

const TELEPHONE = { width: 390, height: 844 };

async function ouvrir(page, schema = "light", taille = TELEPHONE) {
  await page.emulateMedia({ colorScheme: schema });
  await page.setViewportSize(taille);
  await page.goto(srv.base + "/#crm", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
}
const ligne = (page, nom) => page.locator("#crmList .cli-ligne", { hasText: nom });
const noms = page => page.locator("#crmList .cli-nom").allTextContents();

async function ouvrirFiche(page, schema = "light") {
  await ouvrir(page, schema);
  await ligne(page, "Tilleuls").click();
  await expect(page.locator("#cliFiche")).toBeVisible();
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

// Chaque texte visible sous `racine`, avec la couleur de son texte et le fond
// OPAQUE le plus proche (le sien ou celui d'un ancetre).
function textesEtFonds(racine) {
  const fondDe = e => {
    for (let n = e; n; n = n.parentElement) {
      const f = getComputedStyle(n).backgroundColor;
      if (f && f !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(f)) return f;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const out = [];
  const marcheur = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT);
  for (let t = marcheur.nextNode(); t; t = marcheur.nextNode()) {
    const e = t.parentElement;
    if (!t.textContent.trim() || !e.checkVisibility()) continue;
    const r = e.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) continue;
    out.push({ texte: t.textContent.trim().slice(0, 40), couleur: getComputedStyle(e).color, fond: fondDe(e) });
  }
  return out;
}

for (const schema of ["light", "dark"]) {
  test(`liste (9a) : les filtres dans le vert de l'en-tête, lisibles (${schema})`, async ({ page }) => {
    await ouvrir(page, schema);
    const r = await page.evaluate(() => {
      const entete = document.querySelector("main.content > .ecran-entete");
      const bloc = document.querySelector("#crm .cli-filtres");
      return {
        vert: getComputedStyle(entete).backgroundColor,
        blocFond: getComputedStyle(bloc).backgroundColor,
        rayonEntete: getComputedStyle(entete).borderBottomLeftRadius,
        rayonBloc: getComputedStyle(bloc).borderBottomLeftRadius,
        ecart: Math.round(bloc.getBoundingClientRect().top - entete.getBoundingClientRect().bottom),
        gauche: Math.round(bloc.getBoundingClientRect().left),
        largeur: Math.round(bloc.getBoundingClientRect().width),
        pilules: [...bloc.querySelectorAll(".cli-pilule, .cli-statut-filtre")].map(p => ({
          quoi: p.textContent.trim().slice(0, 20), fond: getComputedStyle(p).backgroundColor,
          texte: getComputedStyle(p.querySelector("select") || p).color, h: p.getBoundingClientRect().height
        }))
      };
    });
    expect(r.blocFond).toBe(r.vert);
    expect(r.rayonEntete).toBe("0px");
    expect(r.rayonBloc).toBe("28px");
    expect(r.ecart).toBe(0);
    expect([r.gauche, r.largeur]).toEqual([0, TELEPHONE.width]);
    // Tous, Besancon, Champagnole, Dole, Abonnes, et le statut (garde).
    expect(r.pilules.length).toBe(6);
    for (const p of r.pilules) {
      expect(p.h, p.quoi).toBeGreaterThanOrEqual(44);
      expect(contraste(p.texte, p.fond), p.quoi).toBeGreaterThanOrEqual(4.5);
    }
    // L'active (Tous) se distingue des autres.
    expect(r.pilules[0].fond).not.toBe(r.pilules[1].fond);
    // « Rappels » (garde) partage sa rangee avec la pastille de synchro et
    // « Actualiser » : l'en-tete n'a pas une rangee de plus pour eux.
    const rangee = await page.evaluate(() => ["#crm-rappels", "#syncStatus", "#refreshButton"].map(s => {
      const e = s === "#crm-rappels" ? document.querySelector(".ecran-entete .cli-rappels") : document.querySelector(s);
      const b = e.getBoundingClientRect();
      return Math.round((b.top + b.bottom) / 2);
    }));
    expect(Math.max(...rangee) - Math.min(...rangee)).toBeLessThanOrEqual(2);
  });

  test(`fiche (${schema === "light" ? "8c" : "12c"}) : le nom, les puces, Appeler et Itinéraire dans le vert, avec la flèche (${schema})`, async ({ page }) => {
    await ouvrirFiche(page, schema);
    // Le titre generique « Clients » n'est plus dit : le nom l'est.
    await expect(page.locator("#pageTitle")).toBeHidden();
    const r = await page.evaluate(() => {
      const entete = document.querySelector("main.content > .ecran-entete");
      const tete = document.querySelector("#cliFiche .cli-fiche-tete");
      const boite = e => e.getBoundingClientRect();
      const dans = e => e && tete.contains(e);
      const retour = document.querySelector("#cliFiche .cli-retour");
      const nom = document.querySelector("#cliFiche .cli-fiche-nom");
      const racine = getComputedStyle(document.documentElement);
      return {
        vertEntete: getComputedStyle(entete).backgroundColor,
        vertTete: getComputedStyle(tete).backgroundColor,
        rayonEntete: getComputedStyle(entete).borderBottomLeftRadius,
        rayonTete: getComputedStyle(tete).borderBottomLeftRadius,
        ecart: Math.round(boite(tete).top - boite(entete).bottom),
        bords: [Math.round(boite(tete).left), Math.round(boite(tete).right)],
        retourDans: dans(retour), retour: [Math.round(boite(retour).width), Math.round(boite(retour).height)],
        retourAGauche: boite(retour).right <= boite(nom).left && Math.abs(boite(retour).top - boite(nom).top) <= 12,
        nomDans: dans(nom), pucesDans: [...document.querySelectorAll("#cliFiche .cli-puce")].map(dans),
        appeler: dans(document.querySelector("#cliFiche .cli-appeler")),
        itineraire: dans(document.querySelector("#cliFiche .cli-itineraire")),
        gestesH: [...tete.querySelectorAll(".cli-appeler, .cli-itineraire, .cli-modifier")].map(e => Math.round(boite(e).height)),
        // Appeler et Itineraire cote a cote, sous le nom.
        memeRangee: Math.abs(boite(tete.querySelector(".cli-appeler")).top - boite(tete.querySelector(".cli-itineraire")).top) <= 1
          && boite(tete.querySelector(".cli-appeler")).top > boite(nom).bottom,
        fondAppeler: getComputedStyle(tete.querySelector(".cli-appeler")).backgroundColor,
        principal: racine.getPropertyValue("--v8-principal").trim(),
        surface: racine.getPropertyValue("--v8-surface").trim()
      };
    });
    expect(r.vertTete).toBe(r.vertEntete);
    expect(r.rayonEntete).toBe("0px");
    expect(r.rayonTete).toBe("28px");
    expect(r.ecart).toBe(0);
    expect(r.bords).toEqual([0, TELEPHONE.width]);
    expect(r.retourDans).toBe(true);
    expect(r.retour).toEqual([44, 44]);
    expect(r.retourAGauche).toBe(true);
    expect(r.nomDans).toBe(true);
    expect(r.pucesDans).toEqual([true, true]);
    expect(r.appeler && r.itineraire && r.memeRangee).toBe(true);
    expect(r.gestesH.every(h => h >= 48)).toBe(true);
    // Appeler : blanc sur le vert en clair, plein clair en sombre (12c).
    const couleur = v => page.evaluate(c => { const d = document.createElement("i"); d.style.color = c; document.body.append(d); const x = getComputedStyle(d).color; d.remove(); return x; }, v);
    expect(r.fondAppeler).toBe(await couleur(schema === "light" ? r.surface : r.principal));
    // Tout le texte de l'en-tete de fiche se lit (>= 4,5:1).
    const paires = await page.locator("#cliFiche .cli-fiche-tete").evaluate(textesEtFonds);
    expect(paires.length).toBeGreaterThanOrEqual(5);
    expect(paires.filter(p => contraste(p.couleur, p.fond) < 4.5)).toEqual([]);
  });

  test(`fiche : le reste en cartes V8, lisibles (${schema})`, async ({ page }) => {
    await ouvrirFiche(page, schema);
    const r = await page.evaluate(() => {
      const fiche = document.getElementById("cliFiche");
      const carte = s => { const e = fiche.querySelector(s); return { fond: getComputedStyle(e).backgroundColor, rayon: getComputedStyle(e).borderTopLeftRadius }; };
      return {
        fiche: getComputedStyle(fiche).backgroundColor,
        surface: getComputedStyle(document.documentElement).getPropertyValue("--v8-surface").trim(),
        cartes: [".cli-champs", ".cli-notes", ".cli-statut", ".cli-abonnement", ".cli-commandes"].map(carte),
        icones: [...fiche.querySelectorAll(".cli-champ-icone")].map(e => e.checkVisibility())
      };
    });
    // La fiche n'est plus une grande carte blanche : ce sont ses blocs.
    expect(r.fiche).toBe("rgba(0, 0, 0, 0)");
    const surface = await page.evaluate(c => { const d = document.createElement("i"); d.style.color = c; document.body.append(d); const x = getComputedStyle(d).color; d.remove(); return x; }, r.surface);
    expect(r.cartes).toEqual(r.cartes.map(() => ({ fond: surface, rayon: "24px" })));
    expect(r.icones).toEqual([true, true]);
    const paires = await page.locator("#cliFiche").evaluate(textesEtFonds);
    expect(paires.length).toBeGreaterThan(15);
    expect(paires.filter(p => contraste(p.couleur, p.fond) < 4.5)).toEqual([]);
  });
}

test("liste (9a) : la ligne « N clients », et le tri « Dernière livraison »", async ({ page }) => {
  await ouvrir(page);
  const compte = page.locator("#cliCompte");
  await expect(compte).toBeVisible();
  const n = await page.locator("#crmList .cli-ligne").count();
  expect(n).toBe(12);
  await expect(compte).toHaveText("12 clients");
  // Le compte a gauche, le tri a droite, sur une meme rangee sous le vert.
  const r = await page.evaluate(() => {
    const c = document.getElementById("cliCompte").getBoundingClientRect();
    const t = document.querySelector("#crm .cli-tri").getBoundingClientRect();
    const f = document.querySelector("#crm .cli-filtres").getBoundingClientRect();
    return { rangee: Math.abs((c.top + c.bottom) / 2 - (t.top + t.bottom) / 2) <= 2, ordre: c.right < t.left, sous: c.top > f.bottom, h: t.height, droite: t.right };
  });
  expect(r.rangee && r.ordre && r.sous).toBe(true);
  expect(r.h).toBeGreaterThanOrEqual(44);
  // Par defaut, la derniere livraison d'abord (planche 9a) ; puis les clients
  // jamais livres, par nom.
  await expect(page.locator("#cliTri")).toHaveValue("livraison");
  const parLivraison = await noms(page);
  expect(parLivraison.slice(0, 5)).toEqual(ORDRE_LIVRAISON);
  const reste = parLivraison.slice(5);
  expect(reste).toEqual([...reste].sort((a, b) => a.localeCompare(b, "fr")));
  // Par nom, sur demande.
  await page.selectOption("#cliTri", "nom");
  const parNom = await noms(page);
  expect(parNom).toEqual([...parNom].sort((a, b) => a.localeCompare(b, "fr")));
  expect(parNom).not.toEqual(parLivraison);
  // Le compte suit le filtre.
  await page.locator('#cliPilules [data-cli-secteur="__abonnes"]').click();
  await expect(compte).toHaveText("1 client");
});

test("liste (9a) : « Nouveau client » fixé au-dessus de la barre basse, sans recouvrir le dernier client", async ({ page }) => {
  await ouvrir(page);
  const bouton = page.locator(".ecran-entete .cli-nouveau");
  await expect(bouton).toBeVisible();
  const mesure = () => page.evaluate(() => {
    const b = document.querySelector(".ecran-entete .cli-nouveau").getBoundingClientRect();
    const barre = document.querySelector("nav.mobile-tabbar").getBoundingClientRect();
    const toutes = [...document.querySelectorAll("#crmList .cli-ligne")];
    const derniere = toutes[toutes.length - 1].getBoundingClientRect();
    return { haut: b.top, bas: b.bottom, gauche: b.left, droite: b.right, h: b.height, barreHaut: barre.top, derniereBas: derniere.bottom };
  });
  const avant = await mesure();
  expect(avant.h).toBeGreaterThanOrEqual(48);
  expect([avant.gauche, avant.droite]).toEqual([16, TELEPHONE.width - 16]);
  expect(avant.barreHaut - avant.bas).toBeGreaterThanOrEqual(8);
  expect(avant.barreHaut - avant.bas).toBeLessThanOrEqual(20);
  // Temoin : la liste depasse l'ecran (sinon « dessous » ne jugerait rien).
  expect(avant.derniereBas).toBeGreaterThan(avant.haut);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  const apres = await mesure();
  expect(apres.haut).toBe(avant.haut);
  expect(apres.derniereBas).toBeLessThanOrEqual(apres.haut);
  await bouton.click();
  await expect(page.locator("#cliDialogue")).toHaveAttribute("open", "");
  await expect(page.locator("#cliDialogueTitre")).toHaveText("Nouveau client");
});

test("fiche : « Itinéraire » ouvre la navigation vers l'adresse du client, comme « Y aller »", async ({ page }) => {
  await ouvrirFiche(page);
  const lien = page.locator("#cliFiche .cli-itineraire");
  await expect(lien).toBeVisible();
  await expect(lien).toHaveAccessibleName("Itinéraire");
  // L'adresse que la fiche AFFICHE (le serveur ecrit la ville sans cedille),
  // encodee : rue, code postal, ville.
  const affichee = (await page.locator("#cliFiche .cli-champs .cli-valeur").first().innerText()).replace(/\s+/g, " ").trim();
  expect(affichee).toMatch(/^12 avenue du Général de Gaulle 25000 Besan(c|ç)on$/);
  await expect(lien).toHaveAttribute("href", `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(affichee)}`);
  await expect(lien).toHaveAttribute("target", "_blank");
  await expect(lien).toHaveAttribute("rel", /noopener/);
  // Appeler : le numero, sans espaces.
  await expect(page.locator("#cliFiche .cli-appeler")).toHaveAttribute("href", "tel:0381472215");
});

test("fiche : ce qui existait reste -- Modifier, les notes, le statut, les commandes et « Les N autres »", async ({ page }) => {
  await ouvrirFiche(page);
  const modifier = page.locator("#cliFiche").getByRole("button", { name: "Modifier" });
  await expect(modifier).toBeVisible();
  const b = await modifier.boundingBox();
  expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  await expect(page.locator("#cliFiche .cli-notes")).toContainText("entrée de service");
  await expect(page.locator("#cliFiche .cli-statut select")).toBeVisible();
  // Le statut : son libelle au-dessus d'une selection pleine largeur (cote a
  // cote, « Statut commercial » passait sur deux lignes).
  const statut = await page.locator("#cliFiche .cli-statut").evaluate(e => {
    const lib = e.querySelector(".cli-libelle");
    return {
      dessous: e.querySelector("select").getBoundingClientRect().top >= lib.getBoundingClientRect().bottom - 1,
      largeur: Math.round(e.querySelector("select").getBoundingClientRect().width)
    };
  });
  expect(statut.dessous).toBe(true);
  expect(statut.largeur).toBeGreaterThanOrEqual(300);
  await expect(page.locator("#cliFiche .cli-abonnement")).toContainText("Abonnement");
  await expect(page.locator("#cliFiche .cli-commande")).toHaveCount(4);
  await expect(page.locator("#cliFiche .cli-autres")).toBeVisible();
  // Une ligne de commande : le numero, puis « date · articles », le badge a droite.
  const l = await page.locator("#cliFiche .cli-commande").first().evaluate(e => {
    const r = s => e.querySelector(s).getBoundingClientRect();
    return { num: r(".cli-commande-num"), date: r(".cli-commande-date"), art: r(".cli-commande-articles"), statut: r(".cli-commande-statut"), h: e.getBoundingClientRect().height };
  });
  expect(l.date.top).toBeGreaterThanOrEqual(l.num.bottom - 1);
  expect(Math.abs(l.date.top - l.art.top)).toBeLessThanOrEqual(1);
  expect(l.art.left).toBeGreaterThan(l.date.left);
  expect(l.statut.left).toBeGreaterThan(l.art.right - 1);
  expect(l.h).toBeGreaterThanOrEqual(44);
  // Modifier ouvre le dialogue pre-rempli.
  await modifier.click();
  await expect(page.locator("#cliDialogue")).toHaveAttribute("open", "");
  await expect(page.locator('#crmForm [name="nom"]')).toHaveValue("EHPAD Les Tilleuls du Val de Loue");
});

test("fiche : la flèche, puis le retour du téléphone, ramènent la liste ; le focus se voit sur le vert", async ({ page }) => {
  await ouvrir(page);
  // Au clavier : la ligne, Entree, et le focus arrive sur la fleche.
  await ligne(page, "Tilleuls").focus();
  await page.keyboard.press("Enter");
  const retour = page.locator("#cliFiche .cli-retour");
  await expect(retour).toBeFocused();
  await expect(retour).toHaveAccessibleName("Retour à la liste des clients");
  // Au clavier : l'anneau se voit sur chaque geste du vert.
  const anneaux = [];
  for (let i = 0; i < 4; i++) {
    anneaux.push(await page.evaluate(() => {
      const e = document.activeElement;
      return { quoi: e.className, ombre: getComputedStyle(e).boxShadow, contour: getComputedStyle(e).outlineStyle, dansTete: Boolean(e.closest(".cli-fiche-tete")) };
    }));
    await page.keyboard.press("Tab");
  }
  expect(anneaux.every(a => a.dansTete)).toBe(true);
  expect(anneaux.filter(a => a.ombre === "none" && a.contour === "none")).toEqual([]);
  // La fleche : la liste, le focus sur la ligne ouverte.
  await retour.click();
  await expect(page.locator("#crmList")).toBeVisible();
  await expect(page.locator("#cliFiche")).toBeHidden();
  await expect(page.locator("#pageTitle")).toBeVisible();
  await expect(page.locator(".ecran-entete .cli-nouveau")).toBeVisible();
  // Le retour du telephone : pareil, depuis une autre fiche.
  await ligne(page, "Bellevue").click();
  await expect(page.locator("#cliFiche .cli-fiche-nom")).toHaveText("EHPAD Résidence Bellevue");
  await expect(page.locator(".ecran-entete .cli-nouveau")).toBeHidden();
  await page.goBack();
  await expect(page.locator("#crmList")).toBeVisible();
  await expect(page.locator("#cliFiche")).toBeHidden();
  await expect(page.locator("#crm")).toHaveClass(/active/);
  // Rouvrir une fiche apres le retour : une seule fleche suffit encore.
  await ligne(page, "Tilleuls").click();
  await retour.click();
  await expect(page.locator("#crmList")).toBeVisible();
  // Garde : un rechargement depuis une fiche repart sur la liste, et la fiche
  // rouverte se referme d'une seule fleche (l'entree { cliVue } restee dans
  // l'historique ne la piege pas).
  await ligne(page, "Tilleuls").click();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("#crmList")).toBeVisible();
  await expect(page.locator("#cliFiche")).toBeHidden();
  await ligne(page, "Bellevue").click();
  await expect(page.locator("#cliFiche")).toBeVisible();
  await retour.click();
  await expect(page.locator("#crmList")).toBeVisible();
  await expect(page.locator("#cliFiche")).toBeHidden();
  // ... et la fleche s'arrete a la liste : ni un second recul dans
  // l'historique, ni un autre ecran ; le focus revient sur la ligne ouverte.
  await expect(ligne(page, "Bellevue")).toBeFocused();
  await expect(page.locator("#crm")).toHaveClass(/active/);
  expect(await page.evaluate(() => [location.hash, history.state?.cliVue ?? null])).toEqual(["#crm", "fiche"]);
});

// L'anneau clavier HORS du vert : le tri, « Nouveau client » fixe, une
// commande de la fiche et « Les N autres ». `--focus-ring` n'est defini que
// sous le theme clair : en sombre, une regle qui ne compte que sur lui ne
// dessine rien (la declaration box-shadow devient invalide).
for (const schema of ["light", "dark"]) {
  test(`au clavier, l'anneau se voit hors du vert : tri, Nouveau client, commandes (${schema})`, async ({ page }) => {
    await ouvrir(page, schema);
    await page.keyboard.press("Tab");
    // `porteur` dessine l'anneau : le select du tri le dessine sur son
    // etiquette (.cli-tri), les autres sur eux-memes.
    const anneau = porteur => page.evaluate(p => {
      const e = document.activeElement, cs = getComputedStyle(document.querySelector(p)), csE = getComputedStyle(e);
      return {
        focus: e.matches(":focus-visible"),
        ombre: cs.boxShadow, contour: csE.outlineStyle === "none" ? "none" : `${csE.outlineStyle} ${csE.outlineWidth}`
      };
    }, porteur);
    const vus = {};
    await page.locator("#cliTri").focus();
    vus.tri = await anneau("#crm .cli-tri");
    await page.locator(".ecran-entete .cli-nouveau").focus();
    vus.nouveau = await anneau(".ecran-entete .cli-nouveau");
    await ligne(page, "Tilleuls").click();
    await expect(page.locator("#cliFiche")).toBeVisible();
    await page.keyboard.press("Tab");
    await page.locator("#cliFiche .cli-commande").first().focus();
    vus.commande = await anneau("#cliFiche .cli-commande");
    await page.locator("#cliFiche .cli-autres").focus();
    vus.autres = await anneau("#cliFiche .cli-autres");
    // Un anneau : un contour, ou une ombre pleine autour (0 0 0 n) -- pas la
    // seule ombre portee du bouton fixe (0 8px 24px).
    const sansAnneau = Object.entries(vus)
      .filter(([, v]) => !v.focus || (!/0px 0px 0px/.test(v.ombre) && v.contour === "none"))
      .map(([quoi, v]) => ({ quoi, ...v }));
    expect(sansAnneau).toEqual([]);
  });
}

test("hors ligne, le bandeau ne coupe pas le vert : l'en-tête, les filtres et la fiche se ferment chacun", async ({ page }) => {
  await ouvrir(page);
  await page.context().setOffline(true);
  await expect(page.locator("#bandeauHorsLigne")).toBeVisible();
  const rayons = sel => page.evaluate(s => {
    const entete = document.querySelector("main.content > .ecran-entete");
    const bloc = document.querySelector(s);
    const bandeau = document.getElementById("bandeauHorsLigne").getBoundingClientRect();
    return {
      enteteBas: getComputedStyle(entete).borderBottomLeftRadius,
      blocHaut: getComputedStyle(bloc).borderTopLeftRadius,
      blocBas: getComputedStyle(bloc).borderBottomLeftRadius,
      entre: entete.getBoundingClientRect().bottom <= bandeau.top && bandeau.bottom <= bloc.getBoundingClientRect().top
    };
  }, sel);
  const liste = await rayons("#crm .cli-filtres");
  await ligne(page, "Tilleuls").click();
  const fiche = await rayons("#cliFiche .cli-fiche-tete");
  await page.context().setOffline(false);
  for (const r of [liste, fiche]) {
    expect(r.entre).toBe(true);
    expect([r.enteteBas, r.blocHaut, r.blocBas]).toEqual(["28px", "28px", "28px"]);
  }
});

test("au bureau, rien ne change : pas de ligne de tri, pas de bouton fixe, la fiche reste une carte, la liste par nom", async ({ page }) => {
  await ouvrir(page, "light", { width: 1440, height: 900 });
  await expect(page.locator("#crm .cli-resume-ligne")).toBeHidden();
  const r = await page.evaluate(() => ({
    nouveau: getComputedStyle(document.querySelector(".ecran-entete .cli-nouveau")).position,
    filtres: getComputedStyle(document.querySelector("#crm .cli-filtres")).backgroundColor,
    tete: getComputedStyle(document.querySelector("#cliFiche .cli-fiche-tete")).backgroundColor,
    fiche: getComputedStyle(document.getElementById("cliFiche")).backgroundColor,
    icones: [...document.querySelectorAll("#cliFiche .cli-champ-icone, #cliFiche .cli-modifier svg")].map(e => e.checkVisibility()),
    libelles: [...document.querySelectorAll("#cliFiche .cli-libelle")].map(e => e.getBoundingClientRect().width > 1)
  }));
  expect(r.nouveau).toBe("static");
  expect(r.filtres).toBe("rgba(0, 0, 0, 0)");
  expect(r.tete).toBe("rgba(0, 0, 0, 0)");
  expect(r.fiche).not.toBe("rgba(0, 0, 0, 0)");
  expect(r.icones).toEqual([false, false, false]);
  expect(r.libelles.every(Boolean)).toBe(true);
  await expect(page.locator("#cliFiche").getByRole("button", { name: "Modifier" })).toHaveText("Modifier");
  const parNom = await noms(page);
  expect(parNom).toEqual([...parNom].sort((a, b) => a.localeCompare(b, "fr")));
  // Passer au telephone (une tablette qu'on tourne) applique le tri ; revenir
  // au bureau rend l'ordre par nom.
  await page.setViewportSize(TELEPHONE);
  await expect.poll(async () => (await noms(page)).slice(0, 5)).toEqual(ORDRE_LIVRAISON);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => noms(page)).toEqual(parNom);
});
