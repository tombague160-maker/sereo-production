// Chaque banc e2e a serveur propre ecoute sur SON port.
//
// Playwright lance les fichiers en parallele. Deux bancs sur le meme port :
// le second serveur ne demarre pas, ou le banc parle au serveur de l'autre,
// seme d'autres donnees. Le rouge qui en sort accuse l'ecran, pas le port, et
// ne tombe qu'en suite complete -- lance seul, chaque banc est vert. C'est
// arrive le 22/09 : commandes.spec.js avait pris 3154, deja celui du repli des
// secteurs de preparation-lignes.spec.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DOSSIER = path.join(__dirname, "e2e");
// Les ports du serveur de playwright.config.js : ceux-la se partagent, c'est le
// serveur commun.
const COMMUNS = new Set(["3100", "3101"]);

function portsDemarres() {
  const vus = [];
  for (const fichier of fs.readdirSync(DOSSIER).filter(f => f.endsWith(".js"))) {
    const lignes = fs.readFileSync(path.join(DOSSIER, fichier), "utf8").split("\n");
    lignes.forEach((ligne, i) => {
      if (/^\s*(\/\/|\*)/.test(ligne)) return;
      // Un serveur seme (demarrer({ port: ... })) ou un serveur lance a la main (PORT: "...").
      if (!/demarrer\(\s*\{[^}]*port\s*:|\bPORT\s*:/.test(ligne)) return;
      for (const port of ligne.match(/\b3\d{3}\b/g) || []) {
        if (!COMMUNS.has(port)) vus.push({ port, ou: `${fichier}:${i + 1}` });
      }
    });
  }
  return vus;
}

test("ports e2e : l'instrument trouve les serveurs semes", () => {
  // Sans ce temoin, une regex qui ne trouve rien rendrait le banc suivant vert.
  const vus = portsDemarres();
  assert.ok(vus.length >= 10, `seulement ${vus.length} ports trouves`);
  assert.ok(vus.some(v => v.ou.startsWith("preparation-lignes.spec.js")), "le repli des secteurs n'est pas vu");
});

test("ports e2e : aucun port n'est demarre a deux endroits", () => {
  const parPort = new Map();
  for (const v of portsDemarres()) parPort.set(v.port, [...(parPort.get(v.port) || []), v.ou]);
  const doublons = [...parPort].filter(([, ou]) => ou.length > 1).map(([port, ou]) => `${port} : ${ou.join(", ")}`);
  assert.deepEqual(doublons, []);
});
