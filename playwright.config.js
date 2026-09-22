// Playwright config Sereo - v1.13.2 (Sprint 3 audit)
// E2E tests pour les golden paths : login, dashboard, import, modal detail.
// Lancer : npm run test:e2e (headless) ou npm run test:e2e:ui (mode interactif).

const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.SEREO_E2E_BASE_URL || "http://127.0.0.1:3100",
    // Le serveur et les donnees semees comptent les jours a PARIS ; le
    // navigateur de la CI est en UTC. Entre 22 h et minuit UTC, « aujourd'hui »
    // n'etait pas le meme jour des deux cotes, et le filtre du jour des
    // Commandes cachait la commande semee. Les utilisateurs sont a Paris.
    timezoneId: "Europe/Paris",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
    // Ajouter firefox/webkit/mobile selon besoin
  ],

  // DEUX serveurs, et le second n'est pas un luxe.
  //
  // Le premier tourne SANS authentification, parce que les quinze onglets ne
  // sont accessibles qu'ainsi. Mais cela rend `/login` INATTEIGNABLE : mesure du
  // 18/09, `GET /login` y repond 200 et sert l'APPLICATION. Une sonde pointee
  // dessus mesurait donc l'app en croyant mesurer la page de connexion -- un
  // controle negatif de la deuxieme cause, « je ne vois pas », et il ne se
  // signalait que parce qu'on imprimait l'URL finale.
  //
  // La page de connexion est le PREMIER ecran, elle porte ~300 lignes de CSS
  // inline dans server.js, hors du systeme de jetons v8, et elle echappait a
  // TOUS les balayages. Le second serveur, avec l'authentification activee,
  // existe pour elle seule.
  webServer: [{
    command: "node server.js",
    port: 3100,
    timeout: 30 * 1000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: "3100",
      SEREO_HOST: "127.0.0.1",
      // Auth desactivee pour les tests E2E (vars vides)
      SEREO_AUTH_USER: "",
      SEREO_AUTH_PASSWORD: "",
      // SQLite dans un fichier dedie pour ne pas polluer le dev
      SEREO_SQLITE_PATH: "./data/sereo-e2e.sqlite",
      SEREO_SKIP_RELEASE_FETCH: "1"
    }
  }, {
    // Le serveur AUTHENTIFIE, reserve a `contraste-login.spec.js`.
    command: "node server.js",
    port: 3101,
    timeout: 30 * 1000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: "3101",
      SEREO_HOST: "127.0.0.1",
      // Un identifiant jetable, local, et qui n'ouvre rien : la base de ce
      // serveur est un fichier dedie, vide, detruit avec le reste.
      SEREO_AUTH_USER: "banc",
      SEREO_AUTH_PASSWORD: "banc-e2e-local-sans-valeur",
      SEREO_SQLITE_PATH: "./data/sereo-e2e-login.sqlite",
      SEREO_SKIP_RELEASE_FETCH: "1"
    }
  }]
});
