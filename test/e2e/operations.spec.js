const { test, expect } = require("./tuiles");
const { spawn } = require("node:child_process");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
// Données fictives et serveur isolé : aucune écriture dans l'application réelle.
test.describe("Abonnements et pilotage", () => {
  test.describe.configure({ mode: "serial" });
  let root,
    child,
    routingServer,
    routingUrl,
    base = "http://127.0.0.1:3118";
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  test.beforeAll(async () => {
    routingServer = require("node:http").createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url.includes("/table/")
            ? {
                code: "Ok",
                durations: [
                  [0, 10, 1, 30],
                  [10, 0, 8, 1],
                  [1, 1, 0, 20],
                  [30, 1, 20, 0],
                ],
              }
            : {
                code: "Ok",
                routes: [
                  {
                    distance: 12000,
                    duration: 1200,
                    geometry: {
                      type: "LineString",
                      coordinates: [
                        [5.9, 47],
                        [6.1, 47.1],
                        [6.2, 47.2],
                        [6.3, 47.3],
                      ],
                    },
                  },
                ],
              },
        ),
      );
    });
    routingServer.listen(0, "127.0.0.1");
    await require("node:events").once(routingServer, "listening");
    routingUrl = `http://127.0.0.1:${routingServer.address().port}`;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-ui-"));
    fs.writeFileSync(
      path.join(root, "seed.json"),
      JSON.stringify({
        clients: [
          {
            id: "test-client",
            nom: "Martin",
            prenom: "Alice",
            rue: "1 rue de la République",
            ville: "Besançon",
            codePostal: "25000",
            crmStatus: "client_actif",
          },
        ],
        stock: [
          {
            id: "test-changes",
            code: "CH-L",
            nom: "Changes taille L",
            quantite: 100,
            tarif: 12,
          },
          {
            id: "test-aleses",
            code: "ALE",
            nom: "Alèses",
            quantite: 100,
            tarif: 5,
          },
        ],
        commandes: [
          {
            id: "test-ready-1",
            clientId: "test-client",
            clientName: "Alice Martin",
            status: "pret_livraison",
            deliveryDate: today,
            lat: 47.1,
            lng: 6.1,
            products: [],
          },
          {
            id: "test-ready-2",
            clientId: "test-client",
            clientName: "Alice Martin",
            status: "pret_livraison",
            deliveryDate: today,
            lat: 47.2,
            lng: 6.2,
            products: [],
          },
          {
            id: "test-delivered",
            clientId: "test-client",
            clientName: "Alice Martin",
            status: "livre",
            dateCommande: today,
            deliveredAt: `${today}T10:00:00Z`,
            total: 46,
            products: [
              {
                code: "CH-L",
                nom: "Changes taille L",
                quantite: 3,
                prixUnitaire: 12,
              },
              { code: "ALE", nom: "Alèses", quantite: 2, prixUnitaire: 5 },
            ],
          },
        ],
      }),
    );
    child = spawn(process.execPath, ["server.js"], {
      cwd: path.join(__dirname, "../.."),
      env: {
        ...process.env,
        PORT: "3118",
        SEREO_ROUTING_URL: routingUrl,
        SEREO_HOST: "127.0.0.1",
        SEREO_AUTH_USER: "",
        SEREO_AUTH_PASSWORD: "",
        SEREO_STORAGE: "sqlite",
        SEREO_SQLITE_PATH: path.join(root, "db.sqlite"),
        SEREO_DB_PATH: path.join(root, "seed.json"),
        SEREO_UPLOAD_DIR: path.join(root, "uploads"),
        SEREO_BACKUP_DIR: path.join(root, "backups"),
        SEREO_SKIP_RELEASE_FETCH: "1",
      },
      stdio: "ignore",
    });
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(base + "/healthz")).status;
          } catch {
            return 0;
          }
        },
        { timeout: 15000 },
      )
      .toBe(200);
  });
  test.afterAll(async () => {
    if (child) {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    }
    if (routingServer) await new Promise((r) => routingServer.close(r));
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });
  test("créer, modifier, mettre en pause et générer une échéance sans doublon", async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/#abonnements");
    await expect(page.locator("#subscriptionList")).toContainText(
      "Crée ton premier abonnement",
    );
    await page.getByRole("button", { name: "Nouvel abonnement", exact: true }).click();
    // Depuis le 23/09 (planches 3b / 5b) : le client en carte, le panier depuis
    // le catalogue, la frequence en pilule.
    await page.getByRole("searchbox", { name: "Chercher un client" }).fill("Alice");
    await page.locator('#subClientResults [data-op="sub-client"][data-id="test-client"]').click();
    await page.getByRole("button", { name: "Ajouter Changes taille L au panier" }).click();
    await page.getByRole("button", { name: "Ajouter Alèses au panier" }).click();
    await page.locator("#subProducts .sub-product-line").filter({ hasText: "Changes taille L" }).locator(".sub-quantity").fill("3");
    await page.locator("#subProducts .sub-product-line").filter({ hasText: "Alèses" }).locator(".sub-quantity").fill("2");
    await page.getByRole("radio", { name: "Tous les 14 jours" }).check({ force: true });
    await page
      .getByRole("button", { name: "Créer l’abonnement" })
      .click();
    await expect(page.locator("#subscriptionDialog")).not.toBeVisible();
    // Depuis le 19/09 (planche Preparation) l'abonnement est une LIGNE ; le
    // panier, les faits et les actions sont dans le sheet qu'elle ouvre.
    const ligne = page.locator("#subscriptionList .abonnement-ligne").first();
    const ouvrirLeSheet = async () => {
      await ligne.locator(".commande-ligne-main").click();
      await expect(page.locator("#abonnementDetailDialog")).toBeVisible();
    };
    await ouvrirLeSheet();
    await expect(page.locator("#abonnementDetailDialog .subscription-card")).toContainText(
      "3 × Changes taille L · 2 × Alèses",
    );
    await expect(page.locator("#abonnementDetailDialog .subscription-card")).toContainText("46,00");
    await page.reload();
    await expect(ligne).toContainText("Toutes les 2 semaines");
    await ouvrirLeSheet();
    await page.getByRole("button", { name: "Mettre en pause" }).click();
    await expect(page.locator("#abonnementDetailDialog")).not.toBeVisible();
    await expect(ligne).toContainText("En pause");
    // Planche 13a : « Rappels a traiter » fusionne dans « Les 90 jours ». Un
    // abonnement en pause n'a plus d'echeance.
    await expect(page.locator("#subscriptionAgenda")).toContainText(
      "Aucune livraison prévue dans les 90 jours.",
    );
    await ouvrirLeSheet();
    await page.getByRole("button", { name: "Réactiver" }).click();
    await expect(ligne).toContainText("Actif");
    await ouvrirLeSheet();
    await page.getByRole("button", { name: "Modifier", exact: true }).click();
    await expect(page.locator("#abonnementDetailDialog")).not.toBeVisible();
    await page.getByRole("radio", { name: "Tous les 10 jours" }).check({ force: true });
    await page
      .getByRole("button", { name: "Enregistrer les modifications" })
      .click();
    await expect(ligne).toContainText("Tous les 10 jours");
    // Chaque echeance des 90 jours porte son geste. Creer la premiere : son
    // bouton laisse la place au statut de la commande, et une seule commande
    // existe, meme apres rechargement.
    const agenda = page.locator("#subscriptionAgenda");
    const creer = agenda.getByRole("button", { name: /^Créer la commande/ });
    const avant = await creer.count();
    expect(avant).toBeGreaterThan(0);
    await creer.first().click();
    await expect(creer).toHaveCount(avant - 1);
    await page.reload();
    await expect(page.locator("#subscriptionAgenda").getByRole("button", { name: /^Créer la commande/ })).toHaveCount(avant - 1);
    const orders = await (await page.request.get(base + "/api/orders")).json();
    expect(orders.filter((o) => o.subscriptionId)).toHaveLength(1);
    expect(errors).toEqual([]);
  });
  test("le tableau de bord montre le CA livré et le panier moyen, même après création de commandes futures", async ({
    page,
  }) => {
    await page.goto(base);
    await expect(page.locator("#opRevenue")).toContainText("46,00");
    await expect(page.locator("#opBasket")).toContainText("46,00");
    await expect(page.locator("#opSubscriptions")).toHaveText("1");
    await expect(page.locator("#dashboardSubscriptions")).toContainText(
      "Alice Martin",
    );
    await page.locator("#revenueMonth").selectOption({ index: 1 });
    await expect(page.locator("#opRevenue")).toContainText("0,00");
  });
  test("mobile : accueil, calendrier et formulaire restent dans la largeur de l’écran", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    await expect(page.locator("#opRevenue")).toContainText("46,00");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    // Au telephone le lien porte le mot de la planche 1b, « Abonnements ».
    await page.getByRole("link", { name: "Abonnements", exact: true }).click();
    await expect(page.locator("#abonnements")).toHaveClass(/active/);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Nouvel abonnement", exact: true }).click();
    await expect(page.locator("#subSave")).toBeVisible();
    expect(
      await page
        .locator("#subscriptionDialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  });
  test("localisation refusée : retour explicite et départ manuel disponible", async ({
    page,
    context,
  }) => {
    await context.clearPermissions();
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, fail) =>
        fail({ code: 1 });
    });
    await page.goto(base + "/#livreur");
    await page.getByRole("button", { name: "Me localiser" }).click();
    await expect(
      page.getByText("Localisation refusée ou indisponible.", { exact: false }),
    ).toBeVisible();
    await expect(page.locator("#departureQuery")).toBeEnabled();
    await expect(page.locator("#arrivalQuery")).toBeEnabled();
  });
  test("départ et arrivée, calcul routier, démarrage et validation du premier client", async ({
    page,
  }) => {
    await page.route("**/api/geocode?*", (route) => {
      const arrival =
        new URL(route.request().url()).searchParams.get("q") === "Arrivée";
      return route.fulfill({
        json: [
          {
            label: arrival ? "Arrivée confirmée" : "Départ confirmé",
            lat: arrival ? 47.3 : 47,
            lng: arrival ? 6.3 : 5.9,
          },
        ],
      });
    });
    // Le STIMULUS du rouge intermittent, commite pour qu'il se rejoue : la
    // PREMIERE reponse des commandes arrive 2,5 s apres les autres, comme sous
    // la charge d'une suite complete. Sans lui, ce cas ne passait par la course
    // qu'une fois sur soixante ; avec lui, a chaque fois. Les rechargements
    // suivants (apres creation, depart, livraison) ne sont pas ralentis.
    let premieresCommandes = true;
    await page.route("**/api/orders", async (route) => {
      if (premieresCommandes) {
        premieresCommandes = false;
        await new Promise((r) => setTimeout(r, 2500));
      }
      await route.continue();
    });
    await page.goto(base + "/#livreur");
    await page.locator("#departureQuery").fill("Départ");
    await page.locator('[data-op="search-departure"]').click();
    await page.locator("#departureResults").selectOption("0");
    await page.locator("#arrivalQuery").fill("Arrivée");
    await page.locator('[data-op="search-arrival"]').click();
    await page.locator("#arrivalResults").selectOption("0");
    // « Tout sélectionner » prend les commandes DEJA CHARGEES. loadData() part
    // au DOMContentLoaded sans etre attendu par goto(), et interroge dix-sept
    // routes : sous la charge d'une suite complete, il peut finir APRES ce clic.
    // La selection etait alors vide, « Créer une tournée » restait desactive,
    // et le banc mourait d'un timeout. Ce n'etait PAS qu'un defaut de banc : un
    // livreur sur reseau lent perdait le meme geste. Le produit est corrige
    // (boutons de selection desactives jusqu'aux commandes, squelette au lieu
    // du faux etat vide ; banc : livraison-chargement.spec.js). On garde ici
    // l'attente de l'etat reel : les deux commandes pretes affichees.
    await expect(
      page.locator("#deliveryCandidates [data-delivery-order]"),
    ).toHaveCount(2);
    await page
      .getByRole("button", { name: "Tout sélectionner", exact: true })
      .click();
    await expect(page.locator("#createRouteButton")).toBeEnabled();
    await page.locator("#createRouteButton").click();
    await expect(page.locator("#routeMetrics")).toContainText("trajet routier");
    await expect(page.locator("#routeMetrics")).toContainText("12 km");
    await page.locator("#startRouteButton").click();
    await expect(page.locator("#markDeliveredButton")).toBeEnabled();
    await page.locator("#markDeliveredButton").click();
    await expect
      .poll(async () => {
        const routes = await (
          await page.request.get(base + "/api/routes")
        ).json();
        return routes[0].stops.filter((s) => s.status === "livre").length;
      }, {
        // Depuis le 23/09 (planche 4b), « Livre » n'est ENVOYE qu'au terme
        // des 4 s d'Annuler : le delai par defaut de 5 s ne laissait qu'une
        // seconde de marge.
        timeout: 10000,
      })
      .toBe(1);
    const routes = await (await page.request.get(base + "/api/routes")).json();
    expect(routes[0].departure.label).toBe("Départ confirmé");
    expect(routes[0].arrival.label).toBe("Arrivée confirmée");
    expect(routes[0].stops[0].orderId).toBe("test-ready-2");
  });
});
