// E2E : lot 7 de l'audit geo (23/09), l'ecran de preparation de la tournee.
//
// 1. « À livrer en premier » : une case sous chaque commande CHOISIE (cachee
//    sinon), et la tournee creee ouvre sur cette commande.
// 2. Au-dela de 50 commandes : l'ecran propose un decoupage par direction, cree
//    la premiere tournee (50 au plus, avec les commandes « en premier ») et garde
//    les autres selectionnees pour la suivante ; la notification dit aussi un
//    arret retire. Hors ligne, rien n'est mis en file (revue du 23/09).
//
// Serveur seme, sans tournee en cours ; routage simule en local (serveur-seme.js :
// sa table de durees fait 6 x 6, d'ou QUATRE commandes pretes + depart + arrivee).
const { test, expect } = require("./tuiles");
const { demarrer, jeuDeDonnees, CLIENTS, AUJOURDHUI } = require("./serveur-seme");

function commandePrete(id, client, extra = {}) {
  return {
    id, clientId: client.id, clientName: client.nom, status: "pret_livraison",
    address: client.rue, city: client.ville, postalCode: client.codePostal,
    lat: client.lat, lng: client.lng, deliveryDate: AUJOURDHUI, dateCommande: AUJOURDHUI,
    products: [{ code: "CH-L", nom: "Changes taille L", prixUnitaire: 12, quantite: 1 }], ...extra
  };
}

async function choisirDepart(page) {
  await page.route("**/api/geocode?*", route => route.fulfill({ json: [{ label: "Dépôt confirmé", lat: 47.2378, lng: 6.0241 }] }));
  await page.locator("#departureQuery").fill("Dépôt");
  await page.locator('[data-op="search-departure"]').click();
  await page.locator("#departureResults").selectOption("0");
  await page.locator("#returnToStart").check();
}

test.describe("Tournée — « À livrer en premier »", () => {
  test.describe.configure({ mode: "serial" });
  let serveur;
  // L'ordre de la base est l'ordre naturel du routage simule : p-1, p-2, p-3, p-4.
  const [tilleuls, , bellevue, ssiad, veto] = CLIENTS;
  test.beforeAll(async () => {
    serveur = await demarrer({ port: 3198, seed: { ...jeuDeDonnees(), routes: [], commandes: [
      commandePrete("p-1", tilleuls), commandePrete("p-2", bellevue),
      commandePrete("p-3", ssiad), commandePrete("p-4", veto)
    ] } });
  });
  test.afterAll(async () => { await serveur?.arreter(); });

  test("la case suit la selection, et la tournee s'ouvre sur la commande epinglee", async ({ page }) => {
    await page.goto(serveur.base + "/#livreur");
    const cases = page.locator("#deliveryCandidates [data-delivery-order]");
    await expect(cases).toHaveCount(4);
    const premier = page.locator('.delivery-premier:has([data-delivery-first="p-4"])');
    // Non choisie : la case existe, mais cachee (« cachee » seul serait vrai
    // d'une case absente).
    await expect(premier).toHaveCount(1);
    await expect(premier).toBeHidden();
    await page.locator('[data-delivery-order="p-4"]').check();
    await expect(premier).toBeVisible();
    // Cible tactile : 44 px de haut au moins.
    const boite = await premier.boundingBox();
    expect(boite.height).toBeGreaterThanOrEqual(44);
    await expect(premier.getByRole("checkbox", { name: /À livrer en premier : Clinique Vétérinaire du Doubs/ })).toBeVisible();
    await premier.locator("input").check();
    // Decocher la commande retire la case et l'epingle.
    await page.locator('[data-delivery-order="p-4"]').uncheck();
    await expect(premier).toBeHidden();
    await page.locator('[data-delivery-order="p-4"]').check();
    await expect(premier.locator("input")).not.toBeChecked();
    await premier.locator("input").check();
    // « Tout sélectionner » redessine la liste : l'epingle survit.
    await page.getByRole("button", { name: "Tout sélectionner", exact: true }).click();
    await expect(premier.locator("input")).toBeChecked();

    await choisirDepart(page);
    await page.locator("#createRouteButton").click();
    await expect.poll(async () => (await (await page.request.get(serveur.base + "/api/routes")).json()).length).toBe(1);
    const [tournee] = await (await page.request.get(serveur.base + "/api/routes")).json();
    expect(tournee.stops[0].orderId).toBe("p-4");
    expect(tournee.stops.map(s => s.livrerEnPremier)).toEqual([true, false, false, false]);
  });
});

test.describe("Tournée — plus de 50 commandes", () => {
  test.describe.configure({ mode: "serial" });
  let serveur;
  // 55 commandes, qui alternent : les paires (28) a l'ouest de Besancon (Dole),
  // les impaires (27) a l'est (Pontarlier). Rangees par cote dans l'entree, un
  // decoupage dans l'ordre recu passerait aussi (revue du 23/09).
  const commandes = Array.from({ length: 55 }, (_, i) => {
    const ouest = i % 2 === 0;
    const client = { ...CLIENTS[0], id: `c-${i}`, nom: `Client ${String(i).padStart(2, "0")}` };
    return commandePrete(`m-${i}`, client, { lat: (ouest ? 47.09 : 46.9) + i * 0.0005, lng: ouest ? 5.49 : 6.35 });
  });
  test.beforeAll(async () => {
    serveur = await demarrer({ port: 3199, seed: { ...jeuDeDonnees(), routes: [], commandes,
      clients: commandes.map(c => ({ ...CLIENTS[0], id: c.clientId, nom: c.clientName })) } });
  });
  test.afterAll(async () => { await serveur?.arreter(); });

  test("l'ecran propose le decoupage, cree la premiere tournee et garde le reste choisi", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(serveur.base + "/#livreur");
    await expect(page.locator("#deliveryCandidates [data-delivery-order]")).toHaveCount(55);
    await page.getByRole("button", { name: "Tout sélectionner", exact: true }).click();
    await expect(page.locator("#selectedDeliveryCount")).toHaveText("55 sélection");
    await choisirDepart(page);

    // La creation elle-meme est simulee : le routage seme ne sait faire que
    // 6 points. Ce banc juge l'ECRAN : ce qu'il envoie, ce qu'il garde.
    let envoye = null;
    await page.route("**/api/routes", async route => {
      if (route.request().method() !== "POST") return route.continue();
      envoye = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { id: "r-simulee", status: "prete", stops: [], selectedOrderIds: envoye.orderIds } });
    });
    let question = "";
    page.once("dialog", dialogue => { question = dialogue.message(); dialogue.accept(); });
    await page.locator("#createRouteButton").click();

    await expect.poll(() => envoye).not.toBeNull();
    expect(question).toContain("55 commandes");
    expect(question).toMatch(/2 tournées \(28 \+ 27\)/);
    expect(envoye.orderIds.length).toBe(28);
    expect(envoye.retirerInjoignables).toBe(true);
    // Une direction par tournee : la premiere est l'ouest entier (28), sans
    // une commande de l'est.
    const ouest = envoye.orderIds.filter(id => Number(id.slice(2)) % 2 === 0).length;
    expect(ouest).toBe(28);
    await expect(page.locator("#selectedDeliveryCount")).toHaveText("27 sélection");
  });

  // Revue du 23/09 : (1) le decoupage ignorait « À livrer en premier » -- une
  // commande epinglee de l'est partait avec la seconde tournee ; (2) quand un
  // arret injoignable etait retire, la notification taisait la tournee suivante.
  test("une commande « À livrer en premier » part dans la premiere tournee, et la notification dit aussi la suite", async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(serveur.base + "/#livreur");
    await expect(page.locator("#deliveryCandidates [data-delivery-order]")).toHaveCount(55);
    await page.getByRole("button", { name: "Tout sélectionner", exact: true }).click();
    await expect(page.locator("#selectedDeliveryCount")).toHaveText("55 sélection");
    // m-1 est a l'est : sans epingle, elle irait dans la seconde tournee.
    await page.locator('.delivery-premier:has([data-delivery-first="m-1"]) input').check();
    await choisirDepart(page);

    let envoye = null;
    await page.route("**/api/routes", async route => {
      if (route.request().method() !== "POST") return route.continue();
      envoye = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { id: "r-simulee", status: "prete", stops: [], selectedOrderIds: envoye.orderIds,
        injoignablesRetires: [{ id: "m-0", clientName: "Client 00" }] } });
    });
    page.once("dialog", dialogue => dialogue.accept());
    await page.locator("#createRouteButton").click();

    await expect.poll(() => envoye).not.toBeNull();
    expect(envoye.orderIds).toContain("m-1");
    expect(envoye.premiers).toEqual(["m-1"]);
    // La seule epingle est a l'est : c'est l'est entier (27) qui part d'abord.
    expect(envoye.orderIds.length).toBe(27);
    expect(envoye.orderIds.every(id => Number(id.slice(2)) % 2 === 1)).toBe(true);
    const toast = page.locator("#toastRegion .toast-message").last();
    await expect(toast).toContainText("sans Client 00");
    // Le pluriel juste (parcours simplifies, 24/09) : plus de « commande(s) ».
    await expect(toast).toContainText("28 commandes restent sélectionnées pour la tournée suivante");
  });

  // Revue du 23/09 : hors ligne, la proposition de decoupage (qui n'ecrit rien)
  // etait mise en file, et l'ecran annoncait « enregistré, sera envoyé ».
  test("hors ligne, au-dela de 50 commandes : l'ecran dit que rien n'est enregistre", async ({ page, context }) => {
    test.setTimeout(60000);
    await page.goto(serveur.base + "/#livreur");
    await expect(page.locator("#deliveryCandidates [data-delivery-order]")).toHaveCount(55);
    await page.getByRole("button", { name: "Tout sélectionner", exact: true }).click();
    await expect(page.locator("#selectedDeliveryCount")).toHaveText("55 sélection");
    await choisirDepart(page);
    let dialogue = false;
    page.on("dialog", d => { dialogue = true; d.dismiss(); });

    await context.setOffline(true);
    await page.locator("#createRouteButton").click();
    const toast = page.locator("#toastRegion .toast-message").last();
    await expect(toast).toContainText("le découpage en tournées demande le réseau");
    await expect(page.locator("#toastRegion")).not.toContainText("sera envoyé à la reconnexion");
    expect(dialogue).toBe(false);
    await context.setOffline(false);
    // Rien en file : la selection est intacte, aucune tournee ne sera creee.
    await expect(page.locator("#selectedDeliveryCount")).toHaveText("55 sélection");
  });
});
