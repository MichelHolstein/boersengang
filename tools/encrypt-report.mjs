// Verschlüsselt einen Marktbericht (Klartext-JSON) für die Website und aktualisiert data/index.json.
// Braucht nur den öffentlichen Schlüssel aus data/keyring.json, kein Passwort.
// Aufruf: node tools/encrypt-report.mjs /pfad/zum/bericht.json
// Die Klartextdatei gehört NICHT ins Repository.
import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_REPORTS = 60;
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
  for (const src of p.sources || []) {
    if (!/^https:\/\//.test(src.url || "")) errors.push(`${p.ticker}: Quelle ohne https-URL (${src.name}).`);
  }
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
