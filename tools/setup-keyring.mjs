// Einmalig: erzeugt das Schlüsselpaar für Börsenradar.
// Der öffentliche Schlüssel verschlüsselt neue Berichte (dafür braucht niemand das Passwort).
// Der private Schlüssel wird mit dem Passwort verschlüsselt in data/keyring.json abgelegt.
// Aufruf: BOERSENRADAR_PASSWORD='...' node tools/setup-keyring.mjs
// Achtung: Ein neues Schlüsselpaar macht alle alten Berichte unlesbar.
import { writeFile } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const password = process.env.BOERSENRADAR_PASSWORD;
if (!password) {
  console.error("Bitte BOERSENRADAR_PASSWORD setzen.");
  process.exit(1);
}
const b64 = (buf) => Buffer.from(buf).toString("base64");
const ITERATIONS = 600000;

const pair = await crypto.subtle.generateKey(
  { name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["encrypt", "decrypt"]
);
const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);

const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
const wrapKey = await crypto.subtle.deriveKey(
  { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
  base,
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt"]
);
const encryptedPrivateKey = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, pkcs8);

const keyring = {
  version: 1,
  algorithm: { name: "RSA-OAEP", hash: "SHA-256", modulusLength: 3072 },
  publicKey: b64(spki),
  kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: b64(salt) },
  wrap: { name: "AES-GCM", iv: b64(iv) },
  encryptedPrivateKey: b64(encryptedPrivateKey)
};
await writeFile(path.join(root, "data", "keyring.json"), JSON.stringify(keyring, null, 2) + "\n");
console.log("data/keyring.json geschrieben.");
