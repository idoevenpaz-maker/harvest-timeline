// Builds the site's data from two sources plus the media sheet:
//   - Yesh Din's live tracker (fetched each run): https://settlers-violence-opt.site/data.json
//   - Zman Israel "המבצר" incident list (static snapshot in data/sources/zman.json, Oct 2023 – Sep 2026)
//   - Google Sheet of articles/videos per incident id (CSV export)
// Writes data/incidents.json and data/media.json.
// Usage: node scripts/sync.mjs   (MEDIA_CSV_URL env var overrides config.json)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
const MEDIA_CSV_URL = process.env.MEDIA_CSV_URL || config.mediaCsvUrl || '';
const dataDir = path.join(root, 'data');
await mkdir(dataDir, { recursive: true });

const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn('WARN:', msg); };

async function get(url, kind) {
  const res = await fetch(url, { headers: { 'User-Agent': 'harvest-timeline-sync' } });
  if (!res.ok) throw new Error(`${kind}: HTTP ${res.status} from ${url}`);
  return res.text();
}

// ---------- shared category groups (used by the filter) ----------
const GROUPS = {
  killing: 'הריגה',
  violence: 'תקיפה אלימה',
  property: 'פגיעה ברכוש וגניבה',
  trees: 'פגיעה בעצים',
  agri: 'הפרעה למסיק ולחקלאות',
  threats: 'איומים והטרדה',
  animals: 'פגיעה בבעלי חיים',
  land: 'השתלטות על אדמות וגירוש',
};
// Zman category -> groups
const ZMAN_GROUPS = {
  'הריגה': ['killing', 'violence'],
  'תקיפה פיזית': ['violence'],
  'ירי לעבר אזרחים': ['violence'],
  'יידוי אבנים': ['violence'],
  'תקיפה על יישוב': ['violence'],
  'חטיפה וכליאה': ['violence'],
  'עימותים': ['violence'],
  'השחתת רכוש ורכבים': ['property'],
  'גניבת יבול ורכוש': ['property'],
  'הצתת בתים ומבנים': ['property'],
  'השחתת מבנים': ['property'],
  'הצתת שדות': ['property'],
  'פגיעה במקורות מים': ['property'],
  'חילול מסגדים וכנסיות': ['property'],
  'גרפיטי עוין ותג מחיר': ['property'],
  'השחתת עצים ועקירתם': ['trees'],
  'הפרעה למסיק ולעבודה חקלאית': ['agri'],
  'חסימת גישה': ['agri'],
  'הפחדה ואיומים': ['threats'],
  'הפרעה לצוותי סיוע ורפואה': ['threats'],
  'פגיעה בעדרים': ['animals'],
  'תקיפת בעלי חיים': ['animals'],
  'השתלטות על אדמות ומרעה': ['land'],
  'גירוש קהילות ועקירה כפויה': ['land'],
  'אחר': [],
};
// Yesh Din offence key -> groups
const YD_GROUPS = {
  violence: ['violence'],
  property: ['property'],
  trees: ['trees'],
  prevention: ['agri'],
  threats: ['threats'],
  animals: ['animals'],
  land: ['land'],
};

// Readable source name for a link (unwraps web.archive.org captures)
const HOSTS = [
  [/btselem/, 'בצלם'], [/peacenow/, 'שלום עכשיו'], [/keremnavot/, 'כרם נבות'], [/ynet/, 'ynet'],
  [/timesofisrael/, 'Times of Israel'], [/mekomit/, 'שיחה מקומית'], [/haaretz/, 'הארץ'], [/mako|n12/, 'N12'],
  [/walla/, 'וואלה'], [/ochaopt|unocha/, 'OCHA'], [/acri/, 'האגודה לזכויות האזרח'], [/13tv|reshet/, 'ערוץ 13'],
  [/kan\.org/, 'כאן'], [/yesh-din/, 'יש דין'], [/breakingthesilence/, 'שוברים שתיקה'], [/rhr|rabbisforhumanrights/, 'רבנים לזכויות אדם'],
  [/zman\.co\.il/, 'זמן ישראל'], [/youtube|youtu\.be/, 'YouTube'], [/x\.com|twitter/, 'X'], [/facebook/, 'Facebook'],
  [/thedailyfile/, 'הדף היומי'], [/mistaclim/, 'מסתכלים לכיבוש בעיניים'], [/hamoked/, 'המוקד להגנת הפרט'], [/i24/, 'i24NEWS'], [/maariv/, 'מעריב'], [/israelhayom/, 'ישראל היום'], [/kikar/, 'כיכר השבת'], [/972mag/, '+972'],
];
function linkInfo(url) {
  let target = url;
  const arch = url.match(/web\.archive\.org\/web\/\d+\*?\/(.+)$/);
  if (arch) target = arch[1];
  let host = '';
  try { host = new URL(target.startsWith('http') ? target : 'https://' + target).hostname.replace(/^www\./, ''); } catch {}
  const hit = HOSTS.find(([re]) => re.test(host));
  return { name: hit ? hit[1] : host || 'קישור', url, video: /\/video\/|youtube|youtu\.be|vimeo/.test(target) };
}

// ---------- Yesh Din (live) ----------
const yd = JSON.parse(await get(config.sourceUrl, 'Yesh Din data'));
if (!Array.isArray(yd.incidents) || yd.incidents.length === 0 || !yd.places) {
  throw new Error('Yesh Din data: unexpected structure (no incidents/places) — not overwriting');
}
const he = (o) => (o && (o.he || o.en)) || '';
const ydOffence = Object.fromEntries(Object.entries(yd.labels?.offence || {}).map(([k, v]) => [k, he(v)]));
const ydTrait = Object.fromEntries(Object.entries(yd.labels?.trait || {}).map(([k, v]) => [k, he(v)]));
const ydStart = yd.meta.campaign_start;
const ydIncidents = yd.incidents.map((i) => {
  const groups = new Set((i.offences || []).flatMap((o) => YD_GROUPS[o] || []));
  if (i.killed) { groups.add('killing'); groups.add('violence'); }
  const tags = [
    ...(i.offences || []).map((o) => ydOffence[o] || o),
    ...(i.traits || []).map((t) => ydTrait[t] || t),
  ];
  if (i.tab === 'harvest') tags.push('בזמן המסיק');
  if (i.sf) tags.push('בנוכחות כוחות ביטחון');
  return {
    id: i.id,
    date: i.date,
    place: he(yd.places[i.place]?.name) || i.place,
    text: he(i.summary),
    src: 'yd',
    groups: [...groups],
    tags,
    killed: i.killed || 0,
    links: [],
  };
});

// ---------- Zman Israel (snapshot) ----------
const zman = JSON.parse(await readFile(path.join(dataDir, 'sources', 'zman.json'), 'utf8'));
const unknownCats = new Set();
const zmIncidents = zman.incidents
  .filter((i) => i.date && i.date < ydStart) // Yesh Din covers from its campaign start on
  .map((i) => {
    const groups = new Set();
    for (const c of i.cats) {
      if (!(c in ZMAN_GROUPS)) unknownCats.add(c);
      (ZMAN_GROUPS[c] || []).forEach((g) => groups.add(g));
    }
    return {
      id: 'z' + i.n,
      date: i.date,
      place: i.place,
      text: i.text,
      src: 'zm',
      groups: [...groups],
      tags: i.cats.filter((c) => c !== 'אחר'),
      killed: i.cats.includes('הריגה') ? 1 : 0,
      links: i.links.map(linkInfo),
    };
  });
if (unknownCats.size) warn(`Zman categories without a group: ${[...unknownCats].join(', ')}`);

const idNum = (id) => Number(id.replace(/\D/g, ''));
const incidents = [...zmIncidents, ...ydIncidents].sort((a, b) =>
  a.date !== b.date ? a.date.localeCompare(b.date) : a.src !== b.src ? a.src.localeCompare(b.src) : idNum(a.id) - idNum(b.id)
);

// Guard against silent renumbering in Yesh Din: an id that used to point at a different date/place.
const incPath = path.join(dataDir, 'incidents.json');
try {
  const prev = JSON.parse(await readFile(incPath, 'utf8'));
  const prevById = new Map(prev.incidents.map((i) => [i.id, i]));
  let moved = 0;
  for (const i of ydIncidents) {
    const p = prevById.get(i.id);
    if (p && (p.date !== i.date || p.place !== i.place) && p.date < yd.meta.provisional_from) moved++;
  }
  if (moved) warn(`${moved} Yesh Din ids now point at a different date/place than last run — check media links`);
} catch { /* first run or old format */ }

const meta = {
  start: incidents[0].date,
  latest: yd.meta.latest_date,
  updated: yd.meta.data_updated,
  provisional_from: yd.meta.provisional_from,
  yd_start: ydStart,
  zman_extracted: zman.extracted_at.slice(0, 10),
};
await writeFile(incPath, JSON.stringify({ meta, groups: GROUPS, incidents }));
console.log(`incidents: ${incidents.length} = Zman ${zmIncidents.length} (${meta.start} → before ${ydStart}) + Yesh Din ${ydIncidents.length} (→ ${meta.latest})`);

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
  await writeFile(path.join(dataDir, 'sources', 'media-sheet.json'), JSON.stringify(media));
  console.log(`media: ${count} links on ${Object.keys(media).length} incidents`);
}

if (!MEDIA_CSV_URL) {
  console.log('media: no mediaCsvUrl configured — keeping the last sheet snapshot');
} else {
  try { await syncMedia(); }
  catch (e) { warn(`${e.message} — kept the last sheet snapshot (is the sheet shared "anyone with the link"?)`); }
}

// ---------- build data/media.json = sheet snapshot + approved web-search finds ----------
// Rebuilt from scratch each run, so un-approving a found link removes it from the site.
const mediaPath = path.join(dataDir, 'media.json');
let media = {};
try { media = JSON.parse(await readFile(path.join(dataDir, 'sources', 'media-sheet.json'), 'utf8')); } catch {}
try {
  const found = JSON.parse((await readFile(path.join(dataDir, 'sources', 'media-found.json'), 'utf8')).replace(/^﻿/, ''));
  const known = new Set(incidents.map((i) => i.id));
  let added = 0;
  for (const [id, items] of Object.entries(found)) {
    if (id.startsWith('_') || !Array.isArray(items)) continue;
    if (!known.has(id)) { warn(`media-found: unknown incident id "${id}"`); continue; }
    for (const m of items) {
      if (!m.approved) continue;
      const list = (media[id] ||= []);
      if (list.some((x) => x.url === m.url)) continue;
      list.push({ kind: m.kind === 'video' ? 'video' : 'article', title: m.title, url: m.url, source: m.source || '' });
      added++;
    }
  }
  console.log(`media-found: ${added} approved links added`);
} catch (e) {
  if (e.code !== 'ENOENT') warn(`media-found: ${e.message}`);
}
await writeFile(mediaPath, JSON.stringify(media));

await writeFile(path.join(dataDir, 'warnings.json'), JSON.stringify(warnings, null, 2));
