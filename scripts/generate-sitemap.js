#!/usr/bin/env node
/**
 * Regenerates sitemap.xml from the HTML files in frontend-landing/.
 *
 * Page entries come from every indexable *.html file; image entries come from
 * the <img src="images/..."> tags inside each page, using their alt text as the
 * image title/caption. That means a new page picks up correct image entries the
 * moment it ships, instead of the sitemap being hand-maintained.
 *
 *   node scripts/generate-sitemap.js          # write sitemap.xml
 *   node scripts/generate-sitemap.js --check  # report drift, write nothing
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://hestonphoto.co.uk';

// Pages that must never appear in the sitemap.
const EXCLUDE = new Set(['event.html', '404.html']);
const EXCLUDE_PREFIX = ['google']; // Search Console verification files

// priority / changefreq by filename pattern, first match wins.
const RULES = [
  [/^index\.html$/,            { priority: '1.0', changefreq: 'weekly'  }],
  [/^(wedding-photography|pre-wedding-shoots)\.html$/, { priority: '0.9', changefreq: 'monthly' }],
  [/^asian-wedding-photographer-/, { priority: '0.85', changefreq: 'monthly' }],
  [/^(portfolio|gallery|blog)\.html$/, { priority: '0.8', changefreq: 'weekly' }],
  [/^(wedding|pre-wedding)-/,  { priority: '0.75', changefreq: 'monthly' }],
  [/^(privacy|terms|cookies)\.html$/, { priority: '0.3', changefreq: 'yearly' }],
];
const DEFAULT_RULE = { priority: '0.7', changefreq: 'monthly' };

const xmlEscape = (s) =>
  s.replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;')
   .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Undo HTML entities that appear in alt text so we re-escape exactly once.
const decodeEntities = (s) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');

function ruleFor(file) {
  for (const [pattern, rule] of RULES) if (pattern.test(file)) return rule;
  return DEFAULT_RULE;
}

function isIndexable(file, html) {
  if (!file.endsWith('.html')) return false;
  if (EXCLUDE.has(file)) return false;
  if (EXCLUDE_PREFIX.some((p) => file.startsWith(p))) return false;
  // Respect an explicit noindex on the page itself.
  const robots = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i);
  return !(robots && /noindex/i.test(robots[1]));
}

function imagesIn(html, pageTitle) {
  const seen = new Set();
  const out = [];
  const re = /<img\b[^>]*>/gi;
  let tag;
  while ((tag = re.exec(html))) {
    const src = (tag[0].match(/\ssrc=["']([^"']+)["']/i) || [])[1];
    if (!src || !src.replace(/^\//, '').startsWith('images/')) continue;
    const loc = `${ORIGIN}/${src.replace(/^\//, '')}`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    const alt = (tag[0].match(/\salt=["']([^"']*)["']/i) || [])[1] || '';
    out.push({ loc, caption: decodeEntities(alt) || pageTitle });
  }
  return out;
}

function build() {
  const today = new Date().toISOString().slice(0, 10);
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).sort();

  const entries = [];
  let imageCount = 0;

  for (const file of files) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    if (!isIndexable(file, html)) continue;

    const canonical = (html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i) || [])[1];
    const loc = canonical || `${ORIGIN}/${file === 'index.html' ? '' : file}`;
    const rawTitle = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || file;
    const title = decodeEntities(rawTitle.trim());

    const images = imagesIn(html, title);
    imageCount += images.length;
    entries.push({ loc, title, images, ...ruleFor(file) });
  }

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
  ];
  for (const e of entries) {
    lines.push('  <url>');
    lines.push(`    <loc>${xmlEscape(e.loc)}</loc>`);
    lines.push(`    <lastmod>${today}</lastmod>`);
    lines.push(`    <changefreq>${e.changefreq}</changefreq>`);
    lines.push(`    <priority>${e.priority}</priority>`);
    for (const img of e.images) {
      lines.push('    <image:image>');
      lines.push(`      <image:loc>${xmlEscape(img.loc)}</image:loc>`);
      lines.push(`      <image:title>${xmlEscape(img.caption)}</image:title>`);
      lines.push(`      <image:caption>${xmlEscape(img.caption)}</image:caption>`);
      lines.push('    </image:image>');
    }
    lines.push('  </url>');
  }
  lines.push('</urlset>');

  return { xml: lines.join('\n') + '\n', pageCount: entries.length, imageCount, entries };
}

const { xml, pageCount, imageCount, entries } = build();
const target = path.join(ROOT, 'sitemap.xml');

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const existingLocs = new Set([...existing.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  const nextLocs = new Set(entries.map((e) => e.loc));
  const added = [...nextLocs].filter((l) => !existingLocs.has(l));
  const removed = [...existingLocs].filter((l) => !nextLocs.has(l));
  console.log(`current: ${existingLocs.size} pages | generated: ${pageCount} pages, ${imageCount} images`);
  if (added.length) console.log(`\nwould ADD (${added.length}):\n  ${added.join('\n  ')}`);
  if (removed.length) console.log(`\nwould REMOVE (${removed.length}):\n  ${removed.join('\n  ')}`);
  if (!added.length && !removed.length) console.log('\nno page-level drift.');
  process.exit(0);
}

fs.writeFileSync(target, xml);
console.log(`sitemap.xml written: ${pageCount} pages, ${imageCount} images`);
