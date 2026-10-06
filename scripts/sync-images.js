#!/usr/bin/env node
/**
 * Keeps the site's photographs self-hosted and crawlable.
 *
 * The admin API returns every photo as a presigned S3 URL that expires after an
 * hour, which Google cannot index. This script mirrors those photos into
 * images/ and rewrites the pages so that browsers and crawlers only ever see
 * stable hestonphoto.co.uk URLs:
 *
 *   1. Fetches the admin API and looks up every S3 image by its upload id
 *      (the "<13-digit timestamp>-<16 hex>" prefix of the S3 key) in
 *      scripts/image-map.json. Images uploaded since the last run are
 *      downloaded, resized to 1600px, saved as JPEG + WebP, and added to the map.
 *   2. Writes scripts/site-content.json: the archives, pre-wedding shoots and
 *      gallery mosaic, with local image paths.
 *   3. Writes image-map.js, which the pages load to swap S3 URLs in live API
 *      responses for the local copies (new uploads still show from S3 until
 *      the next sync).
 *   4. Renders static <img> markup between <!-- sync-images:NAME --> markers
 *      in index.html, gallery.html and portfolio.html, so the photographs are
 *      in the HTML without JavaScript.
 *
 * Run it after changing photos in the admin panel, then run
 * scripts/generate-sitemap.js.
 *
 *   node scripts/sync-images.js            # fetch, download, rebuild
 *   node scripts/sync-images.js --check    # report un-mirrored images, write nothing
 *   node scripts/sync-images.js --offline  # rebuild pages from site-content.json only
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const API = 'https://hestonapi.edastra.in/api/website';
const MAP_FILE = path.join(__dirname, 'image-map.json');
const CONTENT_FILE = path.join(__dirname, 'site-content.json');
const RUNTIME_FILE = path.join(ROOT, 'image-map.js');

const S3_URL = /^https:\/\/[^/]*amazonaws\.com\/[^?]*?(\d{13}-[0-9a-f]{16})-([^/?]*)/;
const SECTIONS = ['home', 'archives', 'preWeddingShoot', 'gallery', 'services',
                  'testimonials', 'about', 'weddingPhotography'];

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const OFFLINE = args.has('--offline');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SMALL_WORDS = new Set(['of', 'the', 'and', 'at', 'in', 'on']);
const titleCase = (s) => String(s || '').trim().replace(/\s+/g, ' ').split(' ')
  .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()))
    ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ');

// "Harshil& Mitisha" -> "Harshil & Mitisha"
const tidyCouple = (s) => String(s || '').trim().replace(/\s*&\s*/g, ' & ');

const slugify = (s) => String(s).toLowerCase().replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const uploadId = (url) => { const m = S3_URL.exec(url || ''); return m ? m[1] : null; };

function imageSize(file) {
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
    const w = /pixelWidth: (\d+)/.exec(out), h = /pixelHeight: (\d+)/.exec(out);
    return w && h ? { w: +w[1], h: +h[1] } : null;
  } catch { return null; }
}

function hasTool(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const body = await res.json();
  if (!body.success) throw new Error(`${url} -> success=false`);
  return body.data;
}

// ---------------------------------------------------------------------------
// 1. Mirror S3 images
// ---------------------------------------------------------------------------

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} for ${dest}`);
  const tmp = path.join(os.tmpdir(), `heston-${process.pid}-${path.basename(dest)}`);
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  fs.mkdirSync(path.dirname(path.join(ROOT, dest)), { recursive: true });
  if (hasTool('sips')) {
    execFileSync('sips', ['-Z', '1600', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82',
      tmp, '--out', path.join(ROOT, dest)], { stdio: 'ignore' });
  } else {
    fs.copyFileSync(tmp, path.join(ROOT, dest));
  }
  fs.unlinkSync(tmp);
  if (hasTool('cwebp')) {
    execFileSync('cwebp', ['-quiet', '-q', '80', path.join(ROOT, dest),
      '-o', path.join(ROOT, dest.replace(/\.jpg$/, '.webp'))]);
  }
}

// Where a newly uploaded image should live, based on what it belongs to.
function targetPath(ctx, id) {
  const tag = id.slice(-8);
  if (ctx.kind === 'wedding')    return `images/weddings/${ctx.slug}/${ctx.slug}-asian-wedding-photography-${ctx.cover ? 'cover-' : ''}${tag}.jpg`;
  if (ctx.kind === 'prewedding') return `images/pre-wedding/${ctx.slug}/${ctx.slug}-pre-wedding-shoot-${ctx.cover ? 'cover-' : ''}${tag}.jpg`;
  if (ctx.kind === 'gallery')    return `images/gallery/heston-photo-asian-wedding-gallery-${tag}.jpg`;
  return `images/uploads/${slugify(ctx.name.replace(/\.[a-z]+$/i, '')) || tag}-${tag}.jpg`;
}

// Existing entries keep the folder their photos already live in; new ones get
// a folder named after the couple and venue.
function entrySlug(entry, kind, map) {
  const known = [entry.coverImageUrl, ...(entry.galleryImages || []).map((g) => g.imageUrl)]
    .map((u) => map[uploadId(u)]).find(Boolean);
  const dir = kind === 'wedding' ? 'weddings' : 'pre-wedding';
  const m = known && new RegExp(`^images/${dir}/([^/]+)/`).exec(known);
  if (m) return m[1];
  return slugify([entry.coupleName, entry.weddingPlace || entry.location].filter(Boolean).join(' '));
}

async function mirror(data, map) {
  const pending = new Map(); // id -> { url, ctx }

  const note = (url, ctx) => {
    const id = uploadId(url);
    if (id && !map[id] && !pending.has(id)) pending.set(id, { url, ctx });
  };

  for (const e of data.archives.archives.entries || []) {
    const slug = entrySlug(e, 'wedding', map);
    note(e.coverImageUrl, { kind: 'wedding', slug, cover: true });
    (e.galleryImages || []).forEach((g) => note(g.imageUrl, { kind: 'wedding', slug }));
  }
  for (const e of data.preWeddingShoot.preWeddingShoot.entries || []) {
    const slug = entrySlug(e, 'prewedding', map);
    note(e.coverImageUrl, { kind: 'prewedding', slug, cover: true });
    (e.galleryImages || []).forEach((g) => note(g.imageUrl, { kind: 'prewedding', slug }));
  }
  for (const g of data.gallery.gallery.images || []) note(g.imageUrl, { kind: 'gallery' });

  // Everything else (hero, film roll, services, testimonials, about ...).
  const walk = (v) => {
    if (typeof v === 'string') { const m = S3_URL.exec(v); if (m) note(v, { kind: 'other', name: m[2] }); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  Object.values(data).forEach(walk);

  // Mapped files that have gone missing from disk are also a problem.
  const missing = Object.entries(map).filter(([, p]) => !fs.existsSync(path.join(ROOT, p)));
  missing.forEach(([id, p]) => console.warn(`  ! mapped file missing: ${p} (${id})`));

  if (CHECK) {
    for (const [id, { ctx }] of pending) console.log(`  + would download ${id} -> ${targetPath(ctx, id)}`);
    return pending.size + missing.length;
  }

  for (const [id, { url, ctx }] of pending) {
    const dest = targetPath(ctx, id);
    process.stdout.write(`  + ${dest}\n`);
    await download(url, dest);
    map[id] = dest;
  }
  return pending.size;
}

// ---------------------------------------------------------------------------
// 2. Content snapshot (local paths only)
// ---------------------------------------------------------------------------

function buildContent(data, map) {
  const local = (url) => map[uploadId(url)] || null;
  const size = (p) => imageSize(path.join(ROOT, p)) || { w: 1600, h: 1067 };

  const entries = (list, kind) => (list || []).filter((e) => e.isActive !== false).map((e) => {
    const slug = entrySlug(e, kind, map);
    const page = `${kind === 'wedding' ? 'wedding' : 'pre-wedding'}-${slug}.html`;
    const images = (e.galleryImages || []).map((g) => local(g.imageUrl)).filter(Boolean);
    return {
      id: e._id,
      couple: tidyCouple(e.coupleName),
      place: titleCase(e.weddingPlace || e.location || ''),
      slug,
      page: fs.existsSync(path.join(ROOT, page)) ? page : null,
      cover: local(e.coverImageUrl) || images[0] || null,
      images: images.map((p) => ({ src: p, ...size(p) })),
    };
  }).filter((e) => e.cover);

  return {
    weddings: entries(data.archives.archives.entries, 'wedding'),
    preWedding: entries(data.preWeddingShoot.preWeddingShoot.entries, 'prewedding'),
    gallery: (data.gallery.gallery.images || [])
      .map((g) => local(g.imageUrl)).filter(Boolean)
      .map((p) => ({ src: p, ...size(p) })),
  };
}

// ---------------------------------------------------------------------------
// 3. Runtime map for live API responses
// ---------------------------------------------------------------------------

function writeRuntime(map) {
  const compact = {};
  for (const id of Object.keys(map).sort()) compact[id] = map[id].replace(/^images\//, '');
  fs.writeFileSync(RUNTIME_FILE, `/* Generated by scripts/sync-images.js — do not edit by hand.
 * Swaps presigned S3 URLs in admin API responses for the self-hosted copies
 * under images/, so pages never show expiring URLs to visitors or crawlers.
 * Usage: hestonLocalImages(apiResponse) — rewrites in place and returns it. */
(function () {
    var MAP = ${JSON.stringify(compact)};
    var S3 = /^https:\\/\\/[^\\/]*amazonaws\\.com\\/[^?]*?(\\d{13}-[0-9a-f]{16})-/;
    function swap(v) {
        if (typeof v === 'string') {
            var m = S3.exec(v);
            return m && MAP[m[1]] ? 'images/' + MAP[m[1]] : v;
        }
        if (v && typeof v === 'object') {
            for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) v[k] = swap(v[k]);
        }
        return v;
    }
    window.hestonLocalImages = swap;
})();
`);
}

// ---------------------------------------------------------------------------
// 4. Static markup
// ---------------------------------------------------------------------------

const ICON_EYE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>';
const ICON_ZOOM = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6"/></svg>';

const coverAlt = (e, kind) => kind === 'wedding'
  ? `${e.couple} wedding${e.place ? ` at ${e.place}` : ''} — Asian wedding photography by Heston Photo`
  : `${e.couple} pre-wedding shoot${e.place ? ` at ${e.place}` : ''} by Heston Photo`;

const galleryAlt = (i) => `Asian wedding photography by Heston Photo, London (${i + 1})`;

// Cards for index.html. Same markup renderArchivesGrid()/renderPreWeddingGrid()
// produce, so the live render swaps in without a visual jump.
function homeCards(list, kind, openFn) {
  return list.map((e, i) => {
    const delay = kind === 'wedding' ? (i + 1) * 100 : Math.min((i + 1) * 80, 400);
    return `
                <div class="gallery-item${e.images.length ? ' has-gallery' : ''}" data-aos="fade-up" data-aos-delay="${delay}"${e.images.length ? ` onclick="${openFn}('${e.id}')"` : ''}>${e.images.length ? `
                    <div class="gallery-view-indicator">
                        ${ICON_EYE}
                        <span>View Gallery</span>
                    </div>` : ''}
                    <img src="${esc(e.cover)}" alt="${esc(coverAlt(e, kind))}" loading="lazy">
                    <div class="gallery-overlay">
                        <h4>${esc(e.couple)}</h4>${e.place ? `
                        <span>${esc(e.place)}</span>` : ''}
                    </div>
                </div>`;
  }).join('') + '\n                ';
}

function mosaicItems(images, indent) {
  return images.map((img, i) => `
${indent}<div class="mosaic-item" onclick="openMosaicFullscreen(${i})">
${indent}    <img src="${esc(img.src)}" alt="${esc(galleryAlt(i))}" width="${img.w}" height="${img.h}" loading="lazy">
${indent}    <div class="mosaic-zoom">${ICON_ZOOM}</div>
${indent}</div>`).join('') + `\n${indent.slice(4)}`;
}

// Cards for portfolio.html: real links to each story page, opened in the
// lightbox by script.
function portfolioCards(list, kind) {
  return list.map((e, i) => `
                <a class="gallery-item has-gallery" href="${esc(e.page || '#')}" data-set="${kind}" data-index="${i}" data-aos="fade-up" data-aos-delay="${Math.min((i % 6 + 1) * 80, 400)}">
                    <div class="gallery-view-indicator">
                        ${ICON_EYE}
                        <span>View Gallery</span>
                    </div>
                    <img src="${esc(e.cover)}" alt="${esc(coverAlt(e, kind))}" loading="${i < 3 ? 'eager' : 'lazy'}">
                    <div class="gallery-overlay">
                        <h4>${esc(e.couple)}</h4>${e.place ? `
                        <span>${esc(e.place)}</span>` : ''}
                        <span class="gallery-count">${e.images.length} photographs</span>
                    </div>
                </a>`).join('') + '\n            ';
}

function portfolioData(content) {
  const pack = (list) => list.map((e) => ({
    couple: e.couple, place: e.place, page: e.page, images: e.images.map((i) => i.src),
  }));
  // "</" is escaped so the JSON can never close its <script> element.
  const json = JSON.stringify({
    wedding: pack(content.weddings),
    prewedding: pack(content.preWedding),
    mosaic: content.gallery.map((i) => i.src),
  }).replace(/<\//g, '<\\/');
  return `\n    <script type="application/json" id="portfolioData">${json}</script>\n    `;
}

function fillMarkers(file, blocks) {
  const full = path.join(ROOT, file);
  let html = fs.readFileSync(full, 'utf8');
  for (const [name, body] of Object.entries(blocks)) {
    const re = new RegExp(`(<!-- sync-images:${name} -->)[\\s\\S]*?(<!-- /sync-images:${name} -->)`);
    if (!re.test(html)) throw new Error(`${file}: marker sync-images:${name} not found`);
    html = html.replace(re, (_, open, close) => open + body + close);
  }
  fs.writeFileSync(full, html);
}

// ---------------------------------------------------------------------------

(async () => {
  const map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  let content;

  if (OFFLINE) {
    content = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
  } else {
    const data = {};
    for (const s of SECTIONS) data[s] = await getJson(`${API}/${s}`);
    const added = await mirror(data, map);
    if (CHECK) {
      console.log(added ? `${added} image(s) need syncing.` : 'All API images are mirrored locally.');
      process.exit(added ? 1 : 0);
    }
    fs.writeFileSync(MAP_FILE, JSON.stringify(Object.fromEntries(Object.entries(map).sort()), null, 1) + '\n');
    content = buildContent(data, map);
    fs.writeFileSync(CONTENT_FILE, JSON.stringify(content, null, 1) + '\n');
    console.log(`Mirrored ${Object.keys(map).length} images (${added} new).`);
  }

  writeRuntime(map);
  fillMarkers('index.html', {
    archives: homeCards(content.weddings, 'wedding', 'openGalleryLightbox'),
    prewedding: homeCards(content.preWedding, 'prewedding', 'openPreWeddingGallery'),
  });
  fillMarkers('gallery.html', { mosaic: mosaicItems(content.gallery, '                    ') });
  fillMarkers('portfolio.html', {
    weddings: portfolioCards(content.weddings, 'wedding'),
    prewedding: portfolioCards(content.preWedding, 'prewedding'),
    mosaic: mosaicItems(content.gallery, '                    '),
    data: portfolioData(content),
  });
  console.log(`Rendered ${content.weddings.length} weddings, ${content.preWedding.length} pre-wedding shoots, ${content.gallery.length} gallery images.`);
})().catch((err) => { console.error(err.message); process.exit(1); });
