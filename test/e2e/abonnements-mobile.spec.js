// E2E : l'ecran Abonnements AU TELEPHONE -- planches 3a (liste), 3c (les 90
// jours), 5a (sombre). Decisions du 23/09 : la ligne fait 96 px ; « Nouvel
// abonnement » est fixe au-dessus de la barre basse sans recouvrir le dernier
// abonnement ; le calendrier de l'en-tete ouvre l'agenda.
//
// Chaque cas echoue sans le lot : mesure faite en remettant le CSS et le JS de
// main (DESIGN.md, section du 23/09).

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
  const modele = seed.subscriptions[0];
  // Un retard (deux echeances passees sans commande), et assez de lignes pour
  // que la liste defile sous le bouton fixe.
  seed.subscriptions.push(
    { ...modele, id: "sub-retard", clientId: "c-ssiad", startDate: jourDecale(-10), frequency: { unit: "days", interval: 7 } },
    { ...modele, id: "sub-veto", clientId: "c-veto", startDate: jourDecale(2), frequency: { unit: "days", interval: 28 }, reminderDays: 5 },
    { ...modele, id: "sub-dupont", clientId: "c-dupont", startDate: jourDecale(5), frequency: { unit: "days", interval: 15 }, reminderDays: 3 }
  );
  srv = await demarrer({ port: 3177, seed });
});
test.afterAll(async () => { if (srv) await srv.arreter(); });

const TELEPHONE = { width: 390, height: 844 };

async function ouvrir(page, schema = "light") {
  await page.emulateMedia({ colorScheme: schema });
  await page.setViewportSize(TELEPHONE);
  await page.goto(srv.base + "/#abonnements", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
}
const lignes = page => page.locator("#subscriptionList .abonnement-ligne");

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

test("la ligne fait 96 px : client et état, échéance et fréquence, panier et rappel", async ({ page }) => {
  await ouvrir(page);
  const r = await lignes(page).evaluateAll(ls => ls.map(l => {
    const nom = l.querySelector("strong");
    return {
      h: Math.round(l.getBoundingClientRect().height),
      lignesDeNom: Math.round(nom.getBoundingClientRect().height / parseFloat(getComputedStyle(nom).lineHeight)),
      rythme: l.querySelector(".abo-rythme").checkVisibility(),
      panier: l.querySelector(".abo-panier-rappel").checkVisibility(),
      disque: l.querySelector(".etat-commande").checkVisibility(),
      // Le badge sur la rangee du nom, a droite.
      badgeEnHaut: Math.abs(l.querySelector(".pill").getBoundingClientRect().top - nom.getBoundingClientRect().top) <= 2
    };
  }));
  expect(r.length).toBe(6);
  // Temoin : des noms tiennent sur une ligne (sinon le cas suivant ne jugerait rien).
  const simples = r.filter(l => l.lignesDeNom === 1);
  expect(simples.length).toBeGreaterThanOrEqual(3);
  expect(simples.map(l => l.h)).toEqual(simples.map(() => 96));
  expect(r.filter(l => l.lignesDeNom > 1 && l.h > 117)).toEqual([]);
  expect(r.every(l => l.rythme && l.panier && !l.disque && l.badgeEnHaut)).toBe(true);
  // Le retard : « Echeance du ... » en couleur d'alerte.
  const retard = lignes(page).filter({ has: page.locator(".abo-badge--retard") }).first();
  await expect(retard.locator(".abo-rythme-date")).toHaveText(/^Échéance du (1er|\d{1,2}) /);
  const couleurs = await retard.locator(".abo-rythme-date").evaluate(e => ({
    date: getComputedStyle(e).color,
    alerte: getComputedStyle(document.documentElement).getPropertyValue("--v8-alerte").trim()
  }));
  expect(couleurs.date).toBe(await page.evaluate(c => { const d = document.createElement("i"); d.style.color = c; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, couleurs.alerte));
  await expect(retard.locator(".abo-panier-rappel")).toHaveText("4 Changes taille L · rappel 2 j");
  await expect(retard.locator(".abo-rythme-frequence")).toHaveText("· tous les 7 j");
});

test("« Nouvel abonnement » est fixé au-dessus de la barre basse, et ne recouvre jamais le dernier abonnement", async ({ page }) => {
  await ouvrir(page);
  const bouton = page.locator(".ecran-entete .abo-nouveau");
  await expect(bouton).toBeVisible();
  const mesure = () => page.evaluate(() => {
    const b = document.querySelector(".ecran-entete .abo-nouveau").getBoundingClientRect();
    const barre = document.querySelector("nav.mobile-tabbar").getBoundingClientRect();
    const toutes = [...document.querySelectorAll("#subscriptionList .abonnement-ligne")];
    const derniere = toutes[toutes.length - 1].getBoundingClientRect();
    return { haut: b.top, bas: b.bottom, gauche: b.left, droite: b.right, h: b.height, barreHaut: barre.top, derniereBas: derniere.bottom };
  });
  const avant = await mesure();
  expect(avant.h).toBeGreaterThanOrEqual(48);
  expect(avant.gauche).toBe(16);
  expect(avant.droite).toBe(TELEPHONE.width - 16);
  // Au-dessus de la barre basse, a 14 px d'elle (la planche) -- jamais dessus.
  expect(avant.barreHaut - avant.bas).toBeGreaterThanOrEqual(8);
  expect(avant.barreHaut - avant.bas).toBeLessThanOrEqual(20);
  // Il reste en place quand la liste defile.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(200);
  const apres = await mesure();
  expect(apres.haut).toBe(avant.haut);
  // Tout en bas, le dernier abonnement est ENTIEREMENT au-dessus du bouton.
  expect(apres.derniereBas).toBeLessThanOrEqual(apres.haut);
  // Et il ouvre l'editeur.
  await bouton.click();
  await expect(page.locator("#subscriptionDialog")).toHaveAttribute("open", "");
});

for (const schema of ["light", "dark"]) {
  test(`les filtres sur le vert de l'en-tête, lisibles (${schema})`, async ({ page }) => {
    await ouvrir(page, schema);
    const r = await page.evaluate(() => {
      const entete = document.querySelector("main.content > .ecran-entete");
      const bloc = document.querySelector("#abonnements .abo-filtres");
      const vert = getComputedStyle(entete).backgroundColor;
      const pilules = [...bloc.querySelectorAll(".abo-pilule")].map(p => ({
        fond: getComputedStyle(p).backgroundColor, texte: getComputedStyle(p).color, h: p.getBoundingClientRect().height
      }));
      return {
        vert, blocFond: getComputedStyle(bloc).backgroundColor,
        rayonEntete: getComputedStyle(entete).borderBottomLeftRadius,
        rayonBloc: getComputedStyle(bloc).borderBottomLeftRadius,
        // Collés : le bloc commence la ou l'en-tete finit.
        ecart: Math.round(bloc.getBoundingClientRect().top - entete.getBoundingClientRect().bottom),
        blocLargeur: Math.round(bloc.getBoundingClientRect().width),
        pilules
      };
    });
    expect(r.blocFond).toBe(r.vert);
    expect(r.rayonEntete).toBe("0px");
    expect(r.rayonBloc).toBe("28px");
    expect(r.ecart).toBe(0);
    expect(r.blocLargeur).toBe(TELEPHONE.width);
    expect(r.pilules).toHaveLength(3);
    for (const p of r.pilules) {
      expect(p.h).toBeGreaterThanOrEqual(44);
      expect(contraste(p.texte, p.fond)).toBeGreaterThanOrEqual(4.5);
    }
    // L'active se distingue des autres.
    expect(r.pilules[0].fond).not.toBe(r.pilules[1].fond);
  });

  test(`les rangées de la ligne sont lisibles (${schema})`, async ({ page }) => {
    await ouvrir(page, schema);
    const paires = await lignes(page).evaluateAll(ls => ls.flatMap(l => {
      const fond = getComputedStyle(l).backgroundColor;
      return [...l.querySelectorAll("strong, .abo-rythme-date, .abo-rythme-frequence, .abo-panier-rappel")]
        .filter(e => e.checkVisibility()).map(e => ({ texte: getComputedStyle(e).color, fond, quoi: e.className || e.tagName }));
    }));
    expect(paires.length).toBeGreaterThan(12);
    expect(paires.filter(p => contraste(p.texte, p.fond) < 4.5)).toEqual([]);
  });
}

test("le calendrier ouvre « Les 90 jours » ; la flèche et le retour du téléphone ramènent la liste", async ({ page }) => {
  await ouvrir(page);
  const calendrier = page.getByRole("button", { name: "Les 90 jours" });
  const boite = await calendrier.boundingBox();
  expect(boite.width).toBeGreaterThanOrEqual(44);
  expect(boite.height).toBeGreaterThanOrEqual(44);
  // Dans la liste, l'agenda n'est pas rendu (planche 3a).
  await expect(page.locator("#abonnements .abo-agenda")).toBeHidden();

  await calendrier.click();
  await expect(page.locator("#pageTitle")).toHaveText("Les 90 jours");
  await expect(page.locator("#pageSubtitle")).toHaveText(/^\d+ livraisons? prévues?$/);
  await expect(page.locator("#abonnements .abo-agenda")).toBeVisible();
  await expect(page.locator("#abonnements .abo-colonne")).toBeHidden();
  await expect(page.locator(".ecran-entete .abo-nouveau")).toBeHidden();
  await expect(page.locator(".ecran-entete .abo-recherche")).toBeHidden();
  const retour = page.getByRole("button", { name: "Retour aux abonnements" });
  await expect(retour).toBeFocused();

  // L'echeance de 3c : le jour de la semaine au-dessus du numero, le « + » rond.
  const echeance = page.locator("#subscriptionAgenda .abo-echeance").first();
  await expect(echeance.locator(".abo-jour-semaine")).toBeVisible();
  await expect(echeance.locator(".abo-jour-semaine")).toHaveText(/^[A-Z][a-z]{2,3}$/);
  const plus = echeance.getByRole("button", { name: /^Créer la commande du / });
  const b = await plus.boundingBox();
  expect([Math.round(b.width), Math.round(b.height)]).toEqual([44, 44]);
  // Chaque semaine est une carte (la surface), pas une rangee sur le fond.
  const carte = await page.locator("#subscriptionAgenda .abo-semaine-lignes").first().evaluate(e => ({
    fond: getComputedStyle(e).backgroundColor, rayon: getComputedStyle(e).borderTopLeftRadius
  }));
  expect(carte.rayon).toBe("24px");
  expect(carte.fond).not.toBe("rgba(0, 0, 0, 0)");

  await retour.click();
  await expect(page.locator("#pageTitle")).toHaveText("Abonnements");
  await expect(page.locator("#pageSubtitle")).toHaveText(/actifs? · \d+ en pause/);
  await expect(page.locator("#abonnements .abo-colonne")).toBeVisible();
  await expect(calendrier).toBeFocused();

  // Le retour du telephone fait la meme chose.
  await calendrier.click();
  await expect(page.locator("#pageTitle")).toHaveText("Les 90 jours");
  await page.goBack();
  await expect(page.locator("#pageTitle")).toHaveText("Abonnements");
  await expect(page.locator("#abonnements .abo-colonne")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#abonnements");

  // Quitter l'ecran depuis l'agenda : on revient sur la liste.
  await calendrier.click();
  await page.locator('nav.mobile-tabbar [data-tab="journee"]').click();
  await page.locator('nav.mobile-tabbar [data-tab="abonnements"]').click();
  await expect(page.locator("#pageTitle")).toHaveText("Abonnements");
  await expect(page.locator("#abonnements .abo-colonne")).toBeVisible();
});

test("au bureau, rien du téléphone : ni calendrier, ni rangées, ni « + » rond", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(srv.base + "/#abonnements", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await expect(page.locator(".abo-agenda-ouvrir")).toBeHidden();
  await expect(page.locator(".abo-agenda-retour")).toBeHidden();
  await expect(page.locator("#subscriptionList .abo-rythme").first()).toBeHidden();
  await expect(page.locator("#subscriptionList .abo-panier-rappel").first()).toBeHidden();
  await expect(page.locator("#subscriptionAgenda .abo-jour-semaine").first()).toBeHidden();
  await expect(page.locator("#subscriptionAgenda .abo-creer svg").first()).toBeHidden();
  await expect(page.locator("#subscriptionAgenda .abo-creer").first()).toHaveText("Créer la commande");
  // L'agenda et la liste, cote a cote comme avant ; le bouton dans l'en-tete.
  await expect(page.locator("#abonnements .abo-agenda")).toBeVisible();
  const pos = await page.locator(".ecran-entete .abo-nouveau").evaluate(e => getComputedStyle(e).position);
  expect(pos).not.toBe("fixed");
});
