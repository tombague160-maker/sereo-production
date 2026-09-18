// E2E : parite des variables de theme entre les deux chemins vers le mode sombre.
//
// Le probleme que ce fichier resout est documente dans CLAUDE.md sous
// "Variables CSS dupliquees dans 3 blocs — garder les 3 synchronises". Le mode
// sombre s'obtient par DEUX chemins independants :
//
//   1. @media (prefers-color-scheme: dark) :root:not([data-color-scheme="light"])
//      -> l'OS est en sombre et l'utilisateur n'a pas force le clair
//   2. :root[data-color-scheme="dark"]
//      -> l'utilisateur a force le sombre dans l'app, quel que soit l'OS
//
// Les deux blocs sont ecrits a la main et doivent rester identiques. Rien ne
// l'imposait jusqu'ici : une variable ajoutee au premier et oubliee dans le
// second produit une couleur claire sur fond sombre, visible uniquement pour
// les utilisateurs dont l'OS est en clair mais qui forcent le sombre — une
// combinaison que personne ne teste a la main.
//
// Ce test n'a AUCUNE liste de variables codee en dur : il enumere les
// proprietes personnalisees reellement calculees sur :root. Toute variable
// ajoutee au theme est donc couverte automatiquement.

const { test, expect } = require("./tuiles");

/**
 * Charge l'app dans un etat de theme donne et retourne toutes les proprietes
 * personnalisees resolues sur :root.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {"light"|"dark"} osScheme      preference systeme emulee
 * @param {"light"|"dark"|"auto"} stored valeur de sereo:colorScheme
 */
async function readThemeVariables(browser, osScheme, stored) {
  const context = await browser.newContext({ colorScheme: osScheme });
  await context.addInitScript(value => {
    try {
      localStorage.setItem("sereo:colorScheme", value);
    } catch {
      /* localStorage indisponible : anti-fart.js retombera sur le mode clair */
    }
  }, stored);

  const page = await context.newPage();
  await page.goto("/", { waitUntil: "networkidle" });

  const result = await page.evaluate(() => {
    const computed = getComputedStyle(document.documentElement);
    const variables = {};
    for (const property of Array.from(computed)) {
      if (property.startsWith("--")) {
        variables[property] = computed.getPropertyValue(property).trim();
      }
    }
    return {
      attribute: document.documentElement.dataset.colorScheme || null,
      variables
    };
  });

  await context.close();
  return result;
}

/** Compare deux jeux de variables et retourne la liste lisible des ecarts. */
function diffVariables(left, right, leftLabel, rightLabel) {
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  const differences = [];

  for (const name of [...names].sort()) {
    const a = left[name];
    const b = right[name];
    if (a === b) continue;

    if (a === undefined) differences.push(`${name} : absente de ${leftLabel}, vaut "${b}" dans ${rightLabel}`);
    else if (b === undefined) differences.push(`${name} : vaut "${a}" dans ${leftLabel}, absente de ${rightLabel}`);
    else differences.push(`${name} :\n      ${leftLabel} -> ${a}\n      ${rightLabel} -> ${b}`);
  }

  return differences;
}

test.describe("Parite des variables de theme", () => {
  test("le sombre force et le sombre systeme produisent des variables identiques", async ({
    browser
  }) => {
    const forced = await readThemeVariables(browser, "light", "dark");
    const systemic = await readThemeVariables(browser, "dark", "auto");

    // Verification prealable : les deux etats sont bien ceux qu'on croit.
    // Sans cela, un test qui compare deux fois le mode clair passerait toujours.
    expect(forced.attribute, "le sombre force doit poser data-color-scheme=dark").toBe("dark");
    // 17/09 : l'attribut n'est plus EFFACE en mode auto, il est RESOLU. Ce test
    // continue pourtant de distinguer les deux blocs, et c'est ce qui compte :
    //   "sombre force"   = OS clair  + attribut dark -> SEUL :root[data-color-scheme="dark"]
    //   "sombre systeme" = OS sombre + attribut dark -> le @media s'applique EN PLUS
    // Les deux etats n'ont donc pas le meme contexte de media query, et une
    // divergence du bloc @media reste visible. Ce n'est pas une tautologie.
    expect(
      systemic.attribute,
      "en mode auto l'attribut doit etre resolu a dark"
    ).toBe("dark");
    expect(
      Object.keys(forced.variables).length,
      "aucune variable de theme lue : le CSS n'a pas charge"
    ).toBeGreaterThan(50);

    const differences = diffVariables(
      forced.variables,
      systemic.variables,
      "sombre force",
      "sombre systeme"
    );

    expect(
      differences,
      `Les deux blocs de mode sombre ont divergé.\n` +
        `Toute variable redefinie dans @media (prefers-color-scheme: dark) doit\n` +
        `l'etre a l'identique dans :root[data-color-scheme="dark"], et inversement.\n\n` +
        differences.join("\n")
    ).toEqual([]);
  });

  test("forcer le clair depuis un OS sombre redonne exactement le theme clair", async ({
    browser
  }) => {
    // Chemin symetrique : :root:not([data-color-scheme="light"]) dans le @media
    // doit neutraliser completement le sombre systeme.
    const forcedLight = await readThemeVariables(browser, "dark", "light");
    const nativeLight = await readThemeVariables(browser, "light", "light");

    expect(forcedLight.attribute).toBe("light");

    const differences = diffVariables(
      forcedLight.variables,
      nativeLight.variables,
      "clair force depuis OS sombre",
      "clair natif"
    );

    expect(
      differences,
      `Forcer le mode clair sur un OS sombre ne redonne pas le theme clair.\n` +
        `La garde :not([data-color-scheme="light"]) manque probablement sur une\n` +
        `regle du bloc @media.\n\n` +
        differences.join("\n")
    ).toEqual([]);
  });

  test("le mode sombre change reellement les couleurs de fond", async ({ browser }) => {
    // Garde-fou anti-test-creux : prouve que les deux tests ci-dessus comparent
    // bien deux themes distincts, et non deux fois le meme.
    const dark = await readThemeVariables(browser, "light", "dark");
    const light = await readThemeVariables(browser, "light", "light");

    expect(dark.variables["--bg"], "--bg doit differer entre clair et sombre").not.toBe(
      light.variables["--bg"]
    );
    expect(dark.variables["--text"], "--text doit differer entre clair et sombre").not.toBe(
      light.variables["--text"]
    );
  });

  // -------------------------------------------------------------------------
  // Le MIROIR CLAIR du test de parite ci-dessus.
  //
  // Son absence a laisse vivre un defaut mesurable : sur un OS CLAIR, choisir
  // "Auto" ne donnait PAS la meme chose que choisir "Clair".
  //
  //     "Auto"  -> --bg #fafaf8   --text #102a2f
  //     "Clair" -> --bg #eff3f1   --text #183233
  //
  // Parce que "auto" effacait data-color-scheme, et que sans cet attribut la
  // page retombe sur le bloc :root de base, plus ancien que le bloc
  // :root[data-color-scheme="light"]. En SOMBRE les deux blocs sont
  // identiques, donc le seul test qui existait ne pouvait pas le voir.
  // -------------------------------------------------------------------------

  test("le clair force et le clair systeme produisent des variables identiques", async ({
    browser
  }) => {
    const force = await readThemeVariables(browser, "dark", "light");
    const systeme = await readThemeVariables(browser, "light", "auto");

    // Prealable : les deux etats sont bien ceux qu'on croit. Sans cela, un test
    // qui compare deux fois le meme etat passerait toujours.
    expect(force.attribute, "le clair force doit poser data-color-scheme=light").toBe("light");
    expect(systeme.attribute, "le clair systeme doit RESOUDRE l'attribut a light").toBe("light");

    const ecarts = diffVariables(force.variables, systeme.variables, "clair force", "clair systeme");
    expect(ecarts, `variables divergentes : ${ecarts.join(" | ")}`).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Le defaut, quand PERSONNE n'a rien choisi.
  //
  // Decision de Tom, 17/09 : le mode sombre est une preference personnelle, et
  // le defaut suit le systeme. Avant cette date, anti-fart.js posait "light" en
  // dur des qu'aucune preference n'etait stockee -- un utilisateur dont l'OS
  // etait en sombre voyait quand meme du clair, sans jamais l'avoir demande.
  //
  // Ces deux tests se tiennent l'un l'autre : chacun est le contre-temoin de
  // l'autre. Un defaut cable en dur, dans un sens ou dans l'autre, en casse
  // exactement un des deux.
  // -------------------------------------------------------------------------

  /** Charge l'app SANS rien mettre dans localStorage : l'etat d'un premier acces. */
  async function lirePremierAcces(browser, osScheme) {
    const context = await browser.newContext({ colorScheme: osScheme });
    const page = await context.newPage();
    await page.goto("/", { waitUntil: "networkidle" });
    const resultat = await page.evaluate(() => ({
      attribut: document.documentElement.dataset.colorScheme || null,
      stocke: (() => {
        try { return localStorage.getItem("sereo:colorScheme"); } catch { return "indisponible"; }
      })(),
      bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()
    }));
    await context.close();
    return resultat;
  }

  test("premier acces depuis un OS SOMBRE : on suit le systeme", async ({ browser }) => {
    const vu = await lirePremierAcces(browser, "dark");
    const sombreForce = await readThemeVariables(browser, "light", "dark");

    expect(vu.stocke, "prerequis : rien ne doit etre stocke").toBeNull();
    expect(vu.attribut, "l'attribut doit etre RESOLU a dark").toBe("dark");
    expect(vu.bg, "le fond doit etre celui du mode sombre").toBe(sombreForce.variables["--bg"]);
  });

  test("premier acces depuis un OS CLAIR : on reste en clair", async ({ browser }) => {
    const vu = await lirePremierAcces(browser, "light");
    const clairForce = await readThemeVariables(browser, "light", "light");

    expect(vu.stocke, "prerequis : rien ne doit etre stocke").toBeNull();
    expect(vu.attribut, "l'attribut doit etre RESOLU a light").toBe("light");
    expect(vu.bg, "le fond doit etre celui du mode clair").toBe(clairForce.variables["--bg"]);
  });
});
