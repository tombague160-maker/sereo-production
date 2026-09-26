// Aide des bancs de l'import des ventes (25/09) : un classeur .xlsx minimal
// (une feuille, texte en ligne), le meme que celui de pieges-import.test.js et
// d'api.test.js. Pas un banc : `npm test` ne lit que test/*.test.js.

const { zipSync, strToU8 } = require("fflate");

function colonne(i) {
  let n = i + 1;
  let nom = "";
  while (n > 0) {
    const reste = (n - 1) % 26;
    nom = String.fromCharCode(65 + reste) + nom;
    n = Math.floor((n - reste) / 26);
  }
  return nom;
}

/** Un classeur d'une feuille ; `lignes` : un tableau de tableaux de textes. */
function classeur(lignes) {
  const echapper = v => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const feuille = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lignes.map((l, r) => `<row r="${r + 1}">${l.map((c, i) => `<c r="${colonne(i)}${r + 1}" t="inlineStr"><is><t>${echapper(c)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const fichiers = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Feuille1" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(feuille)
  };
  return Buffer.from(zipSync(fichiers));
}

/** Importe `lignes` par POST /api/import/ventes sur `base` ; rend { status, body }. */
async function importerVentes(base, lignes, { entetes = {} } = {}) {
  const form = new FormData();
  form.append("file", new Blob([classeur(lignes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "ventes.xlsx");
  const res = await fetch(`${base}/api/import/ventes`, { method: "POST", body: form, headers: entetes });
  const texte = await res.text();
  let body = null;
  try { body = JSON.parse(texte); } catch { body = texte; }
  return { status: res.status, body };
}

module.exports = { classeur, importerVentes };
