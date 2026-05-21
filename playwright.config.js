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
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
    // Ajouter firefox/webkit/mobile selon besoin
  ],

  // Lance un serveur Sereo dedie pendant les tests
  webServer: {
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
  }
});
