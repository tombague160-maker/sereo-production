// E2E : la police de la charte est-elle REELLEMENT chargee ?
//
// LE DEFAUT, MESURE LE 18/09. La charte §3 dit : « Famille : **Poppins** 400 /
// 500 / 600 / 700 [...] en production la police est auto-hebergee
// (`font-src 'self'`) : pas de Google Fonts. »
//
// Le code declarait `font-family: Inter, "Segoe UI", Arial` et ne chargeait
// AUCUNE police : zero fichier .woff/.ttf dans le depot, zero @font-face, zero
// lien vers Google Fonts. Ni Poppins ni Inter n'etant installees sur une
// machine ordinaire, TOUT s'affichait dans la police systeme.
//
// ⛔ CE N'EST PAS UN DETAIL COSMETIQUE. Les hauteurs de ligne, les hauteurs de
//    rangee (64-72 px), les troncatures et la couverture des glyphes avaient
//    TOUTES ete mesurees dans une police qui n'etait pas la bonne.
//
// DEUX TEMOINS EVIDENTS QUI NE VALENT RIEN, ET MESURE A L'APPUI.
//
// ⛔ `document.fonts.check("400 16px Poppins")` rend **true** sur cette machine
//    ALORS QUE ZERO face Poppins n'est enregistree. Mesure du 18/09, avant tout
//    ajout de police. Il ne repond donc pas a la question posee.
//
// ⛔ Comparer la largeur de `"Poppins"` a celle du REPLI DECLARE ne vaut rien
//    non plus : sans Poppins, le navigateur resout « Poppins » vers sa police
//    par defaut, qui n'est PAS `"Segoe UI", system-ui`. Les largeurs different
//    donc deja -- 863,8 contre 915,61 -- et ce temoin passait au vert sur une
//    page sans la moindre police chargee.
//
// ⭐ LE TEMOIN SAIN : comparer a une famille GARANTIE ABSENTE. Les deux
//    retombent alors sur exactement la meme police par defaut, donc :
//      largeurs EGALES     -> Poppins n'est pas chargee
//      largeurs DIFFERENTES -> elle rend vraiment
//    C'est la seule construction ou le vert ne peut pas venir d'ailleurs.

const { test, expect } = require("./tuiles");

const GRAISSES = [400, 500, 600, 700];
const ECHANTILLON = "Séréo — livraison 25000 · ŒUF àéèêëîïôûùç";

test("typographie — Poppins est chargee, et ce n'est pas un repli", async ({ browser }) => {
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  const r = await page.evaluate(async ([graisses, echantillon]) => {
    await document.fonts.ready;
    const mesurer = famille => {
      const s = document.createElement("span");
      s.style.cssText = "position:fixed;left:-9999px;top:0;white-space:pre;font-size:48px";
      s.textContent = echantillon;
      document.body.appendChild(s);
      const out = {};
      for (const g of graisses) {
        s.style.fontWeight = String(g);
        s.style.fontFamily = famille;
        out[g] = +s.getBoundingClientRect().width.toFixed(2);
      }
      s.remove();
      return out;
    };
    return {
      poppins: mesurer('"Poppins"'),
      // La famille garantie absente. Le nom est deliberement improbable : s'il
      // existait sur une machine, le temoin mesurerait cette police-la.
      absente: mesurer('"PoliceQuiNExistePasSereo7Q2"'),
      // Le repli de la charte, garde pour le JOURNAL seulement. Il est
      // instructif a lire et il ne decide RIEN -- voir l'en-tete.
      repli: mesurer('"Segoe UI", system-ui, sans-serif'),
      declaree: getComputedStyle(document.body).fontFamily,
      // `check()` seul ne suffit pas, mais son desaccord avec la mesure est
      // une information : on le releve pour pouvoir le confronter.
      check: Object.fromEntries(graisses.map(g => [g, document.fonts.check(`${g} 16px Poppins`)])),
      chargees: [...document.fonts].filter(f => /poppins/i.test(f.family))
        .map(f => `${f.family} ${f.weight} ${f.status}`)
    };
  }, [GRAISSES, ECHANTILLON]);

  console.log("\n[typo] famille declaree sur body : " + r.declaree);
  console.log("[typo] faces Poppins enregistrees : " + r.chargees.length);
  for (const g of GRAISSES) {
    console.log(`   ${g} : poppins ${r.poppins[g]} px | ABSENTE ${r.absente[g]} px `
      + `| repli ${r.repli[g]} px | check=${r.check[g]}`);
  }

  // Prealable : la famille du corps doit NOMMER Poppins. Sans cela, meme une
  // police chargee ne servirait a rien -- c'est le cas du « mecanisme soigne et
  // branche sur personne ».
  expect(r.declaree, "le corps ne demande pas Poppins").toMatch(/Poppins/i);

  // Les quatre graisses doivent etre ENREGISTREES.
  expect(r.chargees.length, `faces Poppins enregistrees : ${r.chargees.join(", ")}`)
    .toBeGreaterThanOrEqual(4);

  // LE temoin qui decide : compare a une famille GARANTIE ABSENTE. Egales, les
  // deux retombent sur la police par defaut -- donc Poppins ne rend rien.
  const identiques = GRAISSES.filter(g => Math.abs(r.poppins[g] - r.absente[g]) < 1);
  expect(identiques,
    "ces graisses rendent comme une famille INEXISTANTE : Poppins n'est pas chargee")
    .toEqual([]);

  // Et les quatre graisses doivent se distinguer ENTRE ELLES : declarer 400 a
  // 700 sans que rien ne change signifie qu'une seule face est reellement la.
  const largeurs = new Set(GRAISSES.map(g => r.poppins[g]));
  expect(largeurs.size,
    `les 4 graisses rendent ${largeurs.size} largeur(s) distincte(s) : `
    + "une seule face est chargee, les autres sont synthetisees").toBeGreaterThan(2);

  await ctx.close();
});

test("typographie — la police vient de NOTRE serveur, pas de Google", async ({ browser }) => {
  // La charte l'exige explicitement, et la CSP `font-src 'self'` la fait
  // respecter. Ce banc echoue si quelqu'un remet un lien distant : la regle
  // serait alors muette (la CSP refuserait) et le texte retomberait au repli
  // SANS que rien ne le dise.
  test.setTimeout(120000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const externes = [];
  page.on("request", q => {
    const u = q.url();
    if (/\.(woff2?|ttf|otf)(\?|$)/i.test(u) || /fonts\.(googleapis|gstatic)\.com/i.test(u)) {
      externes.push(u);
    }
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  expect(externes.length, "aucune police demandee : rien n'a ete juge").toBeGreaterThan(0);
  const distantes = externes.filter(u => !u.includes("127.0.0.1") && !u.includes("localhost"));
  expect(distantes, "des polices sont chargees depuis un tiers").toEqual([]);

  console.log(`\n[typo] ${externes.length} police(s) demandee(s), toutes locales`);
  await ctx.close();
});
