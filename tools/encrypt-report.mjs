// Verschlüsselt einen Marktbericht (Klartext-JSON) für die Website und aktualisiert data/index.json.
// Braucht nur den öffentlichen Schlüssel aus data/keyring.json, kein Passwort.
// Aufruf: node tools/encrypt-report.mjs /pfad/zum/bericht.json
// Die Klartextdatei gehört NICHT ins Repository.
import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Alle Berichte bleiben erhalten, weil die Website daraus die Bilanz der Signale berechnet.
const MAX_REPORTS = 1500;
const CATS = ["ereignisse", "analysten", "trend", "positionierung", "qualitaet", "bewertung"];

const file = process.argv[2];
if (!file) {
  console.error("Aufruf: node tools/encrypt-report.mjs <bericht.json>");
  process.exit(1);
}
if (path.resolve(file).startsWith(root + path.sep)) {
  console.error("Die Klartextdatei darf nicht im Repository liegen. Lege sie z. B. unter /tmp ab.");
  process.exit(1);
}

const text = await readFile(file, "utf8");
const report = JSON.parse(text);

// Prüfungen, damit die Website den Bericht sicher anzeigen kann
const errors = [];
const warnings = [];
if (!/^\d{4}-\d{2}-\d{2}$/.test(report.date || "")) errors.push("Feld date fehlt oder ist nicht JJJJ-MM-TT.");
if (!Array.isArray(report.picks) || report.picks.length === 0) errors.push("picks fehlt oder ist leer.");
const light = report.light && report.light.status;
// Schlusskurse der Indizes vom letzten Handelstag, Grundlage der Bilanz
const bm = report.benchmarks;
if (!bm || !(typeof bm.DAX === "number" && bm.DAX > 0) || !(typeof bm.SPX === "number" && bm.SPX > 0)) {
  errors.push("benchmarks.DAX und benchmarks.SPX müssen Zahlen größer 0 sein (Schlussstände von DAX und S&P 500 vom letzten Handelstag).");
}
if (!["rot", "gelb", "gruen"].includes(light)) errors.push("light.status muss rot, gelb oder gruen sein.");
for (const p of report.picks || []) {
  const s = p.scores || {};
  let total = 0;
  for (const c of CATS) {
    const v = s[c];
    if (!Number.isInteger(v) || v < -2 || v > 2) errors.push(`${p.ticker}: scores.${c} muss eine ganze Zahl von -2 bis 2 sein.`);
    total += c === "ereignisse" ? 2 * (v || 0) : (v || 0);
  }
  const longMin = light === "rot" ? 5 : 4;
  const shortMax = light === "gruen" ? -5 : -4;
  const expected = total >= longMin ? "long" : total <= shortMax ? "short" : "neutral";
  if (p.signal !== expected) errors.push(`${p.ticker}: signal ist "${p.signal}", nach Punkten (${total}) wäre es "${expected}".`);
  if (String(p.ticker || "").match(/[^A-Za-z0-9-]/)) errors.push(`${p.ticker}: ticker nur aus Buchstaben, Ziffern und Bindestrich.`);
  if (p.tvSymbol !== undefined && !/^[A-Z_]{2,12}:[A-Z0-9._]{1,15}$/.test(p.tvSymbol)) errors.push(`${p.ticker}: tvSymbol muss wie XETR:SIE aussehen.`);
  if (p.tvSymbol === undefined) warnings.push(`${p.ticker}: tvSymbol fehlt, Live-Chart wird aus market abgeleitet.`);
  // Schlusskurs für die Bilanz: bei Long und Short Pflicht, sonst empfohlen
  const hasPrice = typeof p.price === "number" && p.price > 0;
  if (p.price !== undefined && p.price !== null && !hasPrice) errors.push(`${p.ticker}: price muss eine Zahl größer 0 oder null sein.`);
  if ((p.signal === "long" || p.signal === "short") && !hasPrice) errors.push(`${p.ticker}: Bei Long und Short ist price (Schlusskurs vom letzten Handelstag als Zahl) Pflicht.`);
  else if (!hasPrice) warnings.push(`${p.ticker}: price fehlt; die Bilanz kann den Wert nicht verfolgen.`);
  if (hasPrice && !["EUR", "USD"].includes(p.currency)) errors.push(`${p.ticker}: currency muss EUR oder USD sein.`);
  for (const src of p.sources || []) {
    if (!/^https:\/\//.test(src.url || "")) errors.push(`${p.ticker}: Quelle ohne https-URL (${src.name}).`);
  }
}
const pf = report.portfolio;
if (pf !== undefined) {
  if (!Array.isArray(pf.positions) || pf.positions.length === 0) errors.push("portfolio.positions fehlt oder ist leer.");
  const ids = new Set();
  for (const p of (pf && pf.positions) || []) {
    const n = p.id || "?";
    if (!/^[a-z0-9-]{1,30}$/.test(p.id || "")) errors.push(`Depot ${n}: id nur aus Kleinbuchstaben, Ziffern und Bindestrich.`);
    if (ids.has(p.id)) errors.push(`Depot ${n}: id doppelt.`);
    ids.add(p.id);
    if (!(typeof p.buyPrice === "number" && p.buyPrice > 0)) errors.push(`Depot ${n}: buyPrice muss eine Zahl größer 0 sein.`);
    if (p.price !== null && p.price !== undefined && !(typeof p.price === "number" && p.price > 0)) errors.push(`Depot ${n}: price muss eine Zahl größer 0 oder null sein.`);
    const uq = p.underlyingQuote;
    if (uq !== undefined && uq !== null && !(typeof uq.level === "number" && uq.level > 0)) errors.push(`Depot ${n}: underlyingQuote.level muss eine Zahl größer 0 sein.`);
    if (uq && uq.source && !/^https:\/\//.test(uq.source.url || "")) errors.push(`Depot ${n}: underlyingQuote.source ohne https-URL.`);
    if (!["rueckenwind", "neutral", "gegenwind"].includes(p.stance)) errors.push(`Depot ${n}: stance muss rueckenwind, neutral oder gegenwind sein.`);
    if (p.tvSymbol !== undefined && !/^[A-Z_]{2,12}:[A-Z0-9._]{1,15}$/.test(p.tvSymbol)) errors.push(`Depot ${n}: tvSymbol muss wie XETR:EUNL aussehen.`);
    for (const src of [...(p.sources || []), ...(p.priceSource ? [p.priceSource] : [])]) {
      if (!/^https:\/\//.test(src.url || "")) errors.push(`Depot ${n}: Quelle ohne https-URL (${src.name}).`);
    }
  }
}
// DAX-Liste für die Live-Ansicht prüfen, falls sie geändert wurde
try {
  const dax = JSON.parse(await readFile(path.join(root, "data", "dax.json"), "utf8"));
  const tickers = new Set();
  if (!Array.isArray(dax.groups) || !dax.groups.length) errors.push("data/dax.json: groups fehlt.");
  for (const g of dax.groups || []) {
    if (typeof g.sector !== "string" || !Array.isArray(g.members)) { errors.push("data/dax.json: jede Gruppe braucht sector und members."); continue; }
    for (const m of g.members) {
      if (!/^[A-Z0-9]{1,6}$/.test(String(m.ticker)) || typeof m.name !== "string") errors.push(`data/dax.json: ungültiger Eintrag ${JSON.stringify(m)}.`);
      if (tickers.has(m.ticker)) errors.push(`data/dax.json: ${m.ticker} doppelt.`);
      tickers.add(m.ticker);
    }
  }
  if (tickers.size !== 40) errors.push(`data/dax.json enthält ${tickers.size} statt 40 Werte.`);
} catch (e) {
  errors.push("data/dax.json fehlt oder ist kein gültiges JSON.");
}
if (/\s[–—]\s/.test(text)) warnings.push("Text enthält Gedankenstriche (– oder —).");
if (/\bANT\b/.test(JSON.stringify((report.picks || []).map((p) => p.ticker)))) errors.push("Anthropic (ANT) darf nicht bewertet werden.");
for (const w of warnings) console.warn("Warnung: " + w);
if (errors.length) {
  for (const e of errors) console.error("Fehler: " + e);
  process.exit(2);
}

const b64 = (buf) => Buffer.from(buf).toString("base64");
const keyring = JSON.parse(await readFile(path.join(root, "data", "keyring.json"), "utf8"));
const publicKey = await crypto.subtle.importKey(
  "spki",
  Buffer.from(keyring.publicKey, "base64"),
  { name: "RSA-OAEP", hash: "SHA-256" },
  false,
  ["encrypt"]
);
const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
const iv = crypto.getRandomValues(new Uint8Array(12));
const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new TextEncoder().encode(JSON.stringify(report)));
const rawKey = await crypto.subtle.exportKey("raw", aesKey);
const key = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawKey);

const reportsDir = path.join(root, "data", "reports");
const outName = `${report.date}.json.enc`;
await writeFile(
  path.join(reportsDir, outName),
  JSON.stringify({ version: 1, date: report.date, iv: b64(iv), key: b64(key), data: b64(data) }) + "\n"
);

// Index aktualisieren, alte Berichte über MAX_REPORTS löschen
const indexPath = path.join(root, "data", "index.json");
let index = { reports: [] };
try { index = JSON.parse(await readFile(indexPath, "utf8")); } catch {}
const dates = new Set((index.reports || []).map((r) => r.date));
dates.add(report.date);
const sorted = [...dates].sort().reverse();
const keep = sorted.slice(0, MAX_REPORTS);
for (const old of sorted.slice(MAX_REPORTS)) {
  try { await unlink(path.join(reportsDir, `${old}.json.enc`)); } catch {}
}
// Dateien ohne Indexeintrag entfernen
for (const f of await readdir(reportsDir)) {
  const d = f.replace(".json.enc", "");
  if (f.endsWith(".json.enc") && !keep.includes(d)) await unlink(path.join(reportsDir, f));
}
await writeFile(
  indexPath,
  JSON.stringify({ updated: new Date().toISOString(), reports: keep.map((d) => ({ date: d })) }, null, 2) + "\n"
);
console.log(`Verschlüsselt: data/reports/${outName}. Index enthält ${keep.length} Bericht(e).`);
