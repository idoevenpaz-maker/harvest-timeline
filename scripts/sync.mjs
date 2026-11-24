// Daily sync: pulls Yesh Din's olive-harvest incident data and the media sheet,
// writes data/incidents.json and data/media.json for the static site.
// Usage: node scripts/sync.mjs   (MEDIA_CSV_URL env var overrides config.json)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
const SOURCE_URL = config.sourceUrl;
const MEDIA_CSV_URL = process.env.MEDIA_CSV_URL || config.mediaCsvUrl || '';

const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn('WARN:', msg); };

async function get(url, kind) {
  const res = await fetch(url, { headers: { 'User-Agent': 'harvest-timeline-sync' } });
  if (!res.ok) throw new Error(`${kind}: HTTP ${res.status} from ${url}`);
  return res.text();
}

// ---------- incidents ----------
const raw = JSON.parse(await get(SOURCE_URL, 'source data'));
if (!Array.isArray(raw.incidents) || raw.incidents.length === 0 || !raw.places) {
  throw new Error('source data: unexpected structure (no incidents/places) — not overwriting');
}

const he = (o) => (o && (o.he || o.en)) || '';
const labels = {
  offence: Object.fromEntries(Object.entries(raw.labels?.offence || {}).map(([k, v]) => [k, he(v)])),
  tab: Object.fromEntries(Object.entries(raw.labels?.tab || {}).map(([k, v]) => [k, he(v)])),
  trait: Object.fromEntries(Object.entries(raw.labels?.trait || {}).map(([k, v]) => [k, he(v)])),
};
const places = Object.fromEntries(
  Object.entries(raw.places).map(([k, p]) => [k, { name: he(p.name) || k, lat: p.lat, lng: p.lng }])
);
const incidents = raw.incidents
  .map((i) => ({
    id: i.id,
    date: i.date,
    place: i.place,
    tab: i.tab,
    offences: i.offences || [],
    traits: i.traits || [],
    killed: i.killed || 0,
    sf: !!i.sf,
    text: he(i.summary),
  }))
  .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id, 'en', { numeric: true }) : a.date.localeCompare(b.date)));

// Guard against silent renumbering: an id that used to point at a different date/place.
const dataDir = path.join(root, 'data');
await mkdir(dataDir, { recursive: true });
const incPath = path.join(dataDir, 'incidents.json');
try {
  const prev = JSON.parse(await readFile(incPath, 'utf8'));
  const prevById = new Map(prev.incidents.map((i) => [i.id, i]));
  let moved = 0;
  for (const i of incidents) {
    const p = prevById.get(i.id);
    if (p && (p.date !== i.date || p.place !== i.place) && p.date < raw.meta.provisional_from) moved++;
  }
  if (moved) warn(`${moved} incident ids now point at a different date/place than yesterday — check media links`);
} catch { /* first run */ }

await writeFile(
  incPath,
  JSON.stringify({ meta: raw.meta, labels, places, incidents }, null, 0)
);
console.log(`incidents: ${incidents.length} (${raw.meta.campaign_start} → ${raw.meta.latest_date})`);

// ---------- media sheet ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim()));
}

const mediaPath = path.join(dataDir, 'media.json');
if (!MEDIA_CSV_URL) {
  console.log('media: no mediaCsvUrl configured — keeping existing data/media.json');
} else {
  try { await syncMedia(); }
  catch (e) { warn(`${e.message} — kept the previous data/media.json (is the sheet shared "anyone with the link"?)`); }
}

async function syncMedia() {
  const rows = parseCsv(await get(MEDIA_CSV_URL, 'media sheet'));
  const header = rows.shift().map((h) => h.trim());
  const col = (names) => header.findIndex((h) => names.includes(h));
  const cId = col(['מזהה', 'id']);
  const cKind = col(['סוג', 'kind']);
  const cTitle = col(['כותרת', 'title']);
  const cUrl = col(['קישור', 'url']);
  const cSource = col(['מקור', 'source']);
  if (cId < 0 || cUrl < 0) throw new Error(`media sheet: missing "מזהה" or "קישור" column (got: ${header.join(', ')})`);

  const known = new Set(incidents.map((i) => i.id));
  const media = {};
  let count = 0;
  for (const r of rows) {
    const id = (r[cId] || '').trim().toLowerCase();
    const url = (r[cUrl] || '').trim();
    if (!id && !url) continue;
    if (!known.has(id)) { warn(`media sheet: unknown incident id "${id}" (${url})`); continue; }
    if (!/^https?:\/\//.test(url)) { warn(`media sheet: bad link for ${id}: "${url}"`); continue; }
    const kindRaw = (r[cKind] || '').trim();
    const kind = /סרט|וידאו|video|youtu|vimeo/i.test(kindRaw + ' ' + url) ? 'video' : 'article';
    (media[id] ||= []).push({
      kind,
      title: (r[cTitle] || '').trim() || new URL(url).hostname.replace(/^www\./, ''),
      url,
      source: cSource >= 0 ? (r[cSource] || '').trim() : '',
    });
    count++;
  }
  await writeFile(mediaPath, JSON.stringify(media, null, 0));
  console.log(`media: ${count} links on ${Object.keys(media).length} incidents`);
}

await writeFile(path.join(dataDir, 'warnings.json'), JSON.stringify(warnings, null, 2));
