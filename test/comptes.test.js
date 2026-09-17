// Tests des comptes utilisateurs — V8 phase 1.
//
// Couvre le hachage scrypt, la table `utilisateurs` du store SQLite et la
// table des roles. L'integration a la connexion est testee separement une fois
// le chemin d'auth cable.

const { after, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sereo-comptes-"));

// Aucun test ne doit appeler une API externe : lent, dependant du reseau, et
// impoli envers un service public gratuit. Le geocodage automatique declenche
// par les imports est donc coupe ici. geocodage.test.js teste le geocodage
// lui-meme, contre un faux serveur local.
process.env.SEREO_GEOCODAGE_AUTO = "0";
process.env.SEREO_STORAGE = "sqlite";
process.env.SEREO_DB_PATH = path.join(tmpRoot, "data", "db.json");
process.env.SEREO_SQLITE_PATH = path.join(tmpRoot, "data", "sereo.sqlite");
process.env.SEREO_UPLOAD_DIR = path.join(tmpRoot, "imports");
process.env.SEREO_BACKUP_DIR = path.join(tmpRoot, "data", "backups");
process.env.SEREO_AUTH_USER = "";
process.env.SEREO_AUTH_PASSWORD = "";

const {
  closeStorage,
  hashPassword,
  verifyPassword,
  generatePasswordSalt,
  ROLES,
  DEFAULT_ROLE,
  getRole,
  isKnownRole,
  roleAllowsTab,
  roleAllowsTabStrict,
  roleTabScope,
  SEPARATION_DES_ROLES
} = require("../server");

const { createSqliteStore } = require("../storage/sqliteStore");

after(() => {
  closeStorage();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function openTempStore(name) {
  const sqlitePath = path.join(tmpRoot, `${name}.sqlite`);
  return createSqliteStore({
    sqlitePath,
    seedJsonPath: path.join(tmpRoot, "absent.json"),
    defaultDb: () => ({ settings: {} }),
    normalizeDb: db => db,
    ensureDir: dir => fs.mkdirSync(dir, { recursive: true })
  });
}

// --- Hachage ---------------------------------------------------------------

test("comptes — un mot de passe correct se verifie", async () => {
  const sel = generatePasswordSalt();
  const hash = await hashPassword("Motdepasse-Sereo-2026", sel);
  assert.equal(await verifyPassword("Motdepasse-Sereo-2026", sel, hash), true);
});

test("comptes — un mot de passe faux est rejete", async () => {
  const sel = generatePasswordSalt();
  const hash = await hashPassword("Motdepasse-Sereo-2026", sel);
  assert.equal(await verifyPassword("Motdepasse-Sereo-2027", sel, hash), false);
  assert.equal(await verifyPassword("", sel, hash), false);
});

test("comptes — le sel est bien pris en compte", async () => {
  // Sans cela, deux comptes ayant le meme mot de passe partageraient le meme
  // hash, et une table arc-en-ciel les casserait tous les deux d'un coup.
  const hashA = await hashPassword("identique", generatePasswordSalt());
  const hashB = await hashPassword("identique", generatePasswordSalt());
  assert.notEqual(hashA, hashB);
});

test("comptes — un sel different ne valide pas le mot de passe", async () => {
  const sel = generatePasswordSalt();
  const hash = await hashPassword("Motdepasse-Sereo-2026", sel);
  assert.equal(
    await verifyPassword("Motdepasse-Sereo-2026", generatePasswordSalt(), hash),
    false
  );
});

test("comptes — le format stocke embarque les parametres scrypt", async () => {
  // Permet de durcir N/r/p plus tard sans invalider les mots de passe existants.
  const hash = await hashPassword("x", generatePasswordSalt());
  const parts = hash.split("$");
  assert.equal(parts.length, 5);
  assert.equal(parts[0], "scrypt");
  assert.ok(Number(parts[1]) >= 16384, "N doit rester au moins a 16384");
  assert.ok(Number(parts[2]) >= 8, "r doit rester au moins a 8");
});

test("comptes — un enregistrement illisible refuse la connexion sans lever", async () => {
  const sel = generatePasswordSalt();
  for (const corrompu of [
    "",
    null,
    undefined,
    "pas-un-hash",
    "scrypt$0$8$1$AAAA",
    "scrypt$abc$8$1$AAAA",
    "bcrypt$16384$8$1$AAAA",
    "scrypt$16384$8$1$"
  ]) {
    assert.equal(
      await verifyPassword("peu-importe", sel, corrompu),
      false,
      `le hash ${JSON.stringify(corrompu)} aurait du etre refuse`
    );
  }
});

test("comptes — un hash forge avec des parametres absurdes ne fait pas exploser la memoire", async () => {
  // Un enregistrement en base demandant N=2^30 tenterait d'allouer des Go.
  // maxmem plafonne scrypt, l'erreur est captee, et on refuse la connexion.
  const sel = generatePasswordSalt();
  const forge = `scrypt$1073741824$8$1$${Buffer.alloc(64).toString("base64")}`;
  assert.equal(await verifyPassword("peu-importe", sel, forge), false);
});

// --- Table utilisateurs ----------------------------------------------------

test("comptes — le store cree, lit et supprime un utilisateur", async () => {
  const store = openTempStore("crud");
  try {
    assert.equal(store.countUsers(), 0);

    const sel = generatePasswordSalt();
    store.saveUser({
      id: "u1",
      identifiant: "tom",
      hash: await hashPassword("secret", sel),
      sel,
      role: "admin",
      actif: true,
      creeLe: new Date().toISOString()
    });

    assert.equal(store.countUsers(), 1);
    assert.equal(store.getUser("u1").role, "admin");
    assert.equal(store.deleteUser("u1"), true);
    assert.equal(store.countUsers(), 0);
    assert.equal(store.deleteUser("inconnu"), false);
  } finally {
    store.close();
  }
});

test("comptes — listUsers n'expose JAMAIS le hash ni le sel", async () => {
  // Garde-fou central : ces enregistrements remontent jusqu'a une API. Si une
  // colonne sensible est ajoutee plus tard sans mettre a jour toPublicUser,
  // ce test doit echouer.
  const store = openTempStore("fuite");
  try {
    const sel = generatePasswordSalt();
    const hash = await hashPassword("secret-tres-reconnaissable", sel);
    store.saveUser({
      id: "u1",
      identifiant: "tom",
      hash,
      sel,
      role: "admin",
      actif: true,
      creeLe: new Date().toISOString()
    });

    const serialise = JSON.stringify(store.listUsers());
    assert.ok(!serialise.includes(hash), "listUsers a laisse fuiter le hash");
    assert.ok(!serialise.includes(sel), "listUsers a laisse fuiter le sel");
    assert.ok(!serialise.includes("scrypt"), "listUsers a laisse fuiter le format de hash");

    const parSonId = JSON.stringify(store.getUser("u1"));
    assert.ok(!parSonId.includes(hash), "getUser a laisse fuiter le hash");
    assert.ok(!parSonId.includes(sel), "getUser a laisse fuiter le sel");
  } finally {
    store.close();
  }
});

test("comptes — l'identifiant est insensible a la casse et unique", async () => {
  const store = openTempStore("casse");
  try {
    const sel = generatePasswordSalt();
    const hash = await hashPassword("secret", sel);
    const base = { hash, sel, role: "bureau", actif: true, creeLe: new Date().toISOString() };

    store.saveUser({ ...base, id: "u1", identifiant: "Tom" });
    assert.equal(store.findUserForAuth("TOM").id, "u1");
    assert.equal(store.findUserForAuth("tom").id, "u1");

    // Un second compte au meme identifiant a la casse pres doit etre refuse :
    // sinon deux acces distincts repondraient au meme login.
    assert.throws(
      () => store.saveUser({ ...base, id: "u2", identifiant: "TOM" }),
      /UNIQUE|constraint/i
    );
  } finally {
    store.close();
  }
});

test("comptes — findUserForAuth remonte les comptes desactives", async () => {
  // C'est a la couche auth de refuser, pas au store : on veut pouvoir
  // journaliser "compte desactive" sans le reveler a l'utilisateur.
  const store = openTempStore("desactive");
  try {
    const sel = generatePasswordSalt();
    store.saveUser({
      id: "u1",
      identifiant: "ancien",
      hash: await hashPassword("secret", sel),
      sel,
      role: "livreur",
      actif: false,
      creeLe: new Date().toISOString()
    });

    const trouve = store.findUserForAuth("ancien");
    assert.ok(trouve, "le compte desactive doit etre trouvable");
    assert.equal(trouve.actif, false);
  } finally {
    store.close();
  }
});

test("comptes — touchUserLogin horodate la derniere connexion", async () => {
  const store = openTempStore("connexion");
  try {
    const sel = generatePasswordSalt();
    store.saveUser({
      id: "u1",
      identifiant: "tom",
      hash: await hashPassword("secret", sel),
      sel,
      role: "admin",
      actif: true,
      creeLe: new Date().toISOString()
    });

    assert.equal(store.getUser("u1").derniereConnexion, null);
    store.touchUserLogin("u1", "2026-08-26T12:00:00.000Z");
    assert.equal(store.getUser("u1").derniereConnexion, "2026-08-26T12:00:00.000Z");
  } finally {
    store.close();
  }
});

test("comptes — modifier un utilisateur ne cree pas de doublon", async () => {
  const store = openTempStore("maj");
  try {
    const sel = generatePasswordSalt();
    const commun = { id: "u1", identifiant: "tom", sel, creeLe: new Date().toISOString() };

    store.saveUser({ ...commun, hash: await hashPassword("v1", sel), role: "livreur", actif: true });
    store.saveUser({ ...commun, hash: await hashPassword("v2", sel), role: "admin", actif: false });

    assert.equal(store.countUsers(), 1);
    const apres = store.getUser("u1");
    assert.equal(apres.role, "admin");
    assert.equal(apres.actif, false);
    assert.equal(await verifyPassword("v2", sel, store.findUserForAuth("tom").hash), true);
    assert.equal(await verifyPassword("v1", sel, store.findUserForAuth("tom").hash), false);
  } finally {
    store.close();
  }
});

// --- Roles -----------------------------------------------------------------

test("comptes — chaque role declare un libelle et une portee d'onglets", () => {
  for (const [nom, definition] of Object.entries(ROLES)) {
    assert.ok(definition.libelle, `le role ${nom} n'a pas de libelle`);
    assert.ok(
      definition.onglets === "*" || Array.isArray(definition.onglets),
      `le role ${nom} a une portee d'onglets invalide`
    );
    assert.equal(typeof definition.administration, "boolean");
  }
});

test("comptes — le role par defaut est le moins privilegie", () => {
  // Un role inconnu, ou un compte dont le role a ete supprime de la table, ne
  // doit jamais retomber sur admin.
  assert.equal(getRole("role-inexistant").administration, false);
  assert.equal(getRole(undefined).administration, false);
  assert.equal(getRole(null).administration, false);
  assert.notEqual(ROLES[DEFAULT_ROLE].onglets, "*");
});

test("comptes — seul admin porte le drapeau administration", () => {
  const administrateurs = Object.entries(ROLES)
    .filter(([, definition]) => definition.administration)
    .map(([nom]) => nom);
  assert.deepEqual(administrateurs, ["admin"]);
});

// --- Portee effective : separation DESACTIVEE ------------------------------

test("comptes — aujourd'hui, tout le monde voit tous les onglets", () => {
  // Decision de Tom, 26/08/2026 : l'equipe fait tout de bout en bout. La
  // separation existe dans le code mais reste eteinte tant que
  // SEREO_SEPARATION_ROLES n'est pas pose.
  assert.equal(SEPARATION_DES_ROLES, false, "la separation devrait etre eteinte par defaut");

  for (const role of Object.keys(ROLES)) {
    for (const onglet of ["journee", "parametres", "exports", "stock", "crm", "livreur"]) {
      assert.equal(
        roleAllowsTab(role, onglet),
        true,
        `${role} devrait voir ${onglet} tant que la separation est eteinte`
      );
    }
  }

  assert.equal(roleTabScope("livreur"), "*");
});

// --- Portee stricte : ce qui s'appliquerait si on l'activait ----------------
//
// Ces tests tournent meme quand la separation est eteinte. Sans eux, la
// repartition pourrait deriver en silence pendant des mois et l'activation
// deviendrait un chantier au lieu d'un interrupteur.

test("comptes — portee stricte : un livreur n'aurait pas les onglets sensibles", () => {
  for (const onglet of ["parametres", "exports", "stock", "crm", "statistiques"]) {
    assert.equal(
      roleAllowsTabStrict("livreur", onglet),
      false,
      `le livreur ne devrait pas acceder a ${onglet}`
    );
  }
  assert.equal(roleAllowsTabStrict("livreur", "livreur"), true);
  assert.equal(roleAllowsTabStrict("livreur", "journee"), true);
});

test("comptes — portee stricte : un preparateur aurait la preparation, pas les parametres", () => {
  assert.equal(roleAllowsTabStrict("preparateur", "preparation"), true);
  assert.equal(roleAllowsTabStrict("preparateur", "stock"), true);
  assert.equal(roleAllowsTabStrict("preparateur", "parametres"), false);
  assert.equal(roleAllowsTabStrict("preparateur", "exports"), false);
});

test("comptes — portee stricte : admin et bureau voient tout", () => {
  for (const onglet of ["journee", "parametres", "exports", "livreur", "preparation"]) {
    assert.equal(roleAllowsTabStrict("admin", onglet), true);
    assert.equal(roleAllowsTabStrict("bureau", onglet), true);
  }
});

test("comptes — portee stricte : chaque onglet reste atteignable par au moins un role", () => {
  // Garde-fou contre une portee qui rendrait un ecran inaccessible a tous.
  const tousLesOnglets = [
    "journee", "commande-client", "commandes-jour", "commandes-planifiees",
    "bons-commande", "commandes-livrees", "preparation", "livreur", "stock",
    "recommande", "crm", "relances", "statistiques", "exports", "parametres"
  ];

  for (const onglet of tousLesOnglets) {
    const roles = Object.keys(ROLES).filter(role => roleAllowsTabStrict(role, onglet));
    assert.ok(roles.length > 0, `aucun role ne peut atteindre l'onglet ${onglet}`);
  }
});

test("comptes — isKnownRole distingue les roles declares", () => {
  assert.equal(isKnownRole("admin"), true);
  assert.equal(isKnownRole("livreur"), true);
  assert.equal(isKnownRole("root"), false);
  assert.equal(isKnownRole(""), false);
  // Garde-fou prototype : "constructor" ne doit pas passer pour un role.
  assert.equal(isKnownRole("constructor"), false);
  assert.equal(isKnownRole("toString"), false);
});
