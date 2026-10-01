#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, linkSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const baseArg = process.argv.find((arg) => arg.startsWith("--base-url="));
const baseUrl = baseArg?.slice("--base-url=".length).replace(/\/$/u, "");

function convert(content) {
  if (!Array.isArray(content)) throw new Error("Home content is not a Portable Text array; refusing conversion.");
  const layout = [];
  let pendingText = [];
  const flushText = () => {
    if (!pendingText.length) return;
    layout.push({ _type: "rich_text", _version: 1, _key: `legacy-rich-${layout.length}`, content: pendingText });
    pendingText = [];
  };
  for (let i = 0; i < content.length; i += 1) {
    const node = content[i];
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      pendingText.push(node);
      continue;
    }
    if (node._type === "dinkus.page-hero") {
      flushText();
      const next = content[i + 1];
      const facts = next?._type === "dinkus.fact-rail" ? next.facts : [];
      if (next?._type === "dinkus.fact-rail") i += 1;
      layout.push({
        _type: "home_opener", _version: 1, _key: node._key || `legacy-opener-${layout.length}`,
        eyebrow: node.eyebrow, headline: node.headline, deck: node.deck,
        primary_label: node.primary_label ?? node.primaryLabel, primary_href: node.primary_href ?? node.primaryHref,
        secondary_label: node.secondary_label ?? node.secondaryLabel, secondary_href: node.secondary_href ?? node.secondaryHref,
        facts: Array.isArray(facts) ? facts.map(({ label, value }) => ({ label, value })) : [],
      });
    } else if (node._type === "dinkus.fact-rail") {
      pendingText.push(node);
    } else if (node._type === "dinkus.query-card") {
      flushText();
      const parsed = Number(node.limit);
      layout.push({ _type: "query_card", _version: 1, _key: node._key || `legacy-query-${layout.length}`, source: node.source, limit: Number.isInteger(parsed) && parsed >= 1 && parsed <= 24 ? parsed : 6 });
    } else {
      pendingText.push(node);
    }
  }
  flushText();
  return layout;
}

function extractItem(body) {
  const item = body?.data?.item ?? body?.item ?? body?.data;
  if (!item || typeof item.id !== "string" || !item.data || typeof item.data !== "object") {
    throw new Error("Could not identify Pages home from the EmDash content API response.");
  }
  return item;
}

if (!apply) {
  const raw = readFileSync(0, "utf8");
  if (!raw.trim()) throw new Error("Pipe the JSON response from /_emdash/api/content/pages/home into this preview-only mode.");
  const item = extractItem(JSON.parse(raw));
  if (Array.isArray(item.data.layout) && item.data.layout.length) {
    console.log(JSON.stringify({ action: "skip", reason: "layout already has content; existing layout will not be overwritten", id: item.id }, null, 2));
  } else {
    console.log(JSON.stringify({ action: "preview only", id: item.id, layout: convert(item.data.content) }, null, 2));
  }
  process.exit(0);
}

if (!baseUrl) throw new Error("Use --base-url=http://127.0.0.1:<port> with --apply.");
let parsedBaseUrl;
try {
  parsedBaseUrl = new URL(baseUrl);
} catch {
  throw new Error("Apply mode requires a valid loopback HTTP base URL.");
}
if (
  parsedBaseUrl.protocol !== "http:" ||
  !["127.0.0.1", "[::1]"].includes(parsedBaseUrl.hostname) ||
  !parsedBaseUrl.port ||
  parsedBaseUrl.pathname !== "/" ||
  parsedBaseUrl.username ||
  parsedBaseUrl.password ||
  parsedBaseUrl.search ||
  parsedBaseUrl.hash
) {
  throw new Error("Apply mode only accepts explicit http://127.0.0.1:<port> or http://[::1]:<port> loopback URLs.");
}
const localBaseUrl = parsedBaseUrl.origin;
const databasePath = process.env.DINKUS_EMDASH_DB_PATH;
const backupPath = process.env.DINKUS_EMDASH_BACKUP_PATH;
if (!databasePath || !backupPath) {
  throw new Error("Apply mode requires DINKUS_EMDASH_DB_PATH and DINKUS_EMDASH_BACKUP_PATH for a verified SQLite backup.");
}
function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
const cookie = process.env.DINKUS_EMDASH_SESSION_COOKIE;
if (!cookie) throw new Error("Set DINKUS_EMDASH_SESSION_COOKIE to an authenticated session cookie; it is never printed.");
const headers = { cookie, "X-EmDash-Request": "1", "content-type": "application/json" };
const endpoint = `${localBaseUrl}/_emdash/api/content/pages/home?locale=en`;
const response = await fetch(endpoint, { headers, redirect: "error" });
if (!response.ok) throw new Error(`Home read failed (${response.status}); no changes made.`);
const item = extractItem(await response.json());
if (Array.isArray(item.data.layout) && item.data.layout.length) {
  console.log(JSON.stringify({ action: "skip", reason: "layout already has content; existing layout will not be overwritten", id: item.id }, null, 2));
  process.exit(0);
}
const layout = convert(item.data.content);
if (!layout.length) throw new Error("Conversion produced an empty layout; no changes made.");
console.error(JSON.stringify({ action: "ready to apply", id: item.id, legacyPortableTextBlocks: item.data.content.length, newLayoutBlocks: layout.length, preservesLegacyContent: true }, null, 2));
const confirmation = process.env.DINKUS_EMDASH_MIGRATION_CONFIRM;
if (confirmation !== `apply:${item.id}`) throw new Error(`Apply stopped. Set DINKUS_EMDASH_MIGRATION_CONFIRM=apply:${item.id} after taking a verified database backup.`);
try {
  const databaseStat = statSync(databasePath);
  if (!databaseStat.isFile() || databaseStat.size === 0) throw new Error("database is empty or not a regular file");
} catch (error) {
  throw new Error(`Apply mode database path is not a verified initialized local target (${error.message}); no changes made.`);
}
if (existsSync(backupPath)) {
  throw new Error(`Refusing to overwrite existing backup snapshot at ${backupPath}; no changes made.`);
}
const temporaryBackupPath = `${backupPath}.tmp-${process.pid}`;
try {
  execFileSync("sqlite3", [databasePath, `.backup '${temporaryBackupPath.replaceAll("'", "''")}'`], { stdio: "pipe" });
  const backupStat = statSync(temporaryBackupPath);
  if (!backupStat.isFile() || backupStat.size === 0) throw new Error("SQLite backup is empty");
  const integrity = execFileSync("sqlite3", [temporaryBackupPath, "PRAGMA integrity_check;"], { encoding: "utf8" }).trim();
  if (integrity !== "ok") throw new Error("SQLite backup failed integrity_check");
  try {
    linkSync(temporaryBackupPath, backupPath);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Refusing to overwrite existing backup snapshot at ${backupPath}`);
    throw error;
  }
} finally {
  if (existsSync(temporaryBackupPath)) unlinkSync(temporaryBackupPath);
}
const backupSha256 = sha256(backupPath);
const update = await fetch(`${localBaseUrl}/_emdash/api/content/pages/${encodeURIComponent(item.id)}?locale=en`, {
  method: "PUT", headers, redirect: "error", body: JSON.stringify({ data: { ...item.data, layout } }),
});
if (!update.ok) throw new Error(`Home update failed (${update.status}); inspect admin before retrying.`);
const verify = await fetch(endpoint, { headers, redirect: "error" });
if (!verify.ok) throw new Error(`Updated Home but read-back failed (${verify.status}); inspect admin before retrying.`);
const after = extractItem(await verify.json());
if (JSON.stringify(after.data.content) !== JSON.stringify(item.data.content) || JSON.stringify(after.data.layout) !== JSON.stringify(layout)) {
  throw new Error("Read-back did not match the intended update; stop and inspect the saved revision.");
}
console.log(JSON.stringify({
  action: "applied",
  id: item.id,
  legacyContentPreserved: true,
  layoutBlocks: layout.length,
  backup: { path: backupPath, sha256: backupSha256, integrity: "ok" },
}, null, 2));
