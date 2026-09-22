#!/usr/bin/env node
/**
 * Builds the venue landing pages from scripts/venues.json.
 *
 * These target "<venue> wedding photographer" searches — someone who has already
 * booked the venue and is now looking for a photographer who knows it. Each page
 * links down into the real galleries we shot there, so the claim is evidenced.
 *
 * Styles, header and footer are lifted from an existing story page at build time
 * so the venue pages track the site design instead of drifting from it.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://hestonphoto.co.uk';
const DONOR = 'wedding-jag-and-sara-havelock-gurdwara.html'; // design source
const TODAY = new Date().toISOString().slice(0, 10);

const venues = JSON.parse(fs.readFileSync(path.join(__dirname, 'venues.json'), 'utf8'));
const donor = fs.readFileSync(path.join(ROOT, DONOR), 'utf8');

const STYLE = (donor.match(/<style>[\s\S]*?<\/style>/i) || [])[0];
const HEADER = (donor.match(/<header>[\s\S]*?<\/header>/i) || [])[0];
const FOOTER = (donor.match(/<footer>[\s\S]*?<\/footer>/i) || [])[0];
if (!STYLE || !HEADER || !FOOTER) throw new Error(`could not lift design blocks from ${DONOR}`);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonEsc = (s) => String(s).replace(/&/g, '&').replace(/</g, '\\u003c');

// Pull the display title and cover image out of an existing story page.
function story(slug, kind) {
  const file = `${kind}-${slug}.html`;
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) throw new Error(`missing story page: ${file}`);
  const html = fs.readFileSync(full, 'utf8');
  const rawTitle = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || slug;
  const dir = kind === 'wedding' ? 'weddings' : 'pre-wedding';
  const suffix = kind === 'wedding' ? 'asian-wedding-photography' : 'pre-wedding-shoot';
  const cover = `images/${dir}/${slug}/${slug}-${suffix}-cover.jpg`;
  if (!fs.existsSync(path.join(ROOT, cover))) throw new Error(`missing cover: ${cover}`);
  const count = (html.match(/<img\b[^>]*\bsrc=["']images\//gi) || []).length;
  return { file, cover, count, title: rawTitle.split('|')[0].trim() };
}

function page(v) {
  const url = `${ORIGIN}/${v.slug}.html`;
  const title = `Asian Wedding Photographer at ${v.name} | Heston Photo`;
  const desc = `Asian and Indian wedding photography at ${v.name}, ${v.where}. Real galleries shot at the venue, plus notes on light, timings and ceremony coverage from Heston Photo.`;

  const weddings = (v.stories || []).map((s) => story(s, 'wedding'));
  const preWeddings = (v.preWeddingStories || []).map((s) => story(s, 'pre-wedding'));
  const all = [...weddings, ...preWeddings];
  const hero = all[0].cover;

  const notes = v.notes.map(([h, b]) =>
    `<div class="vnote"><h4>${esc(h)}</h4><p>${esc(b)}</p></div>`).join('\n');

  const cards = all.map((s) =>
    `<a class="vcard" href="${s.file}">
      <img src="${s.cover}" alt="${esc(s.title)} — photographed at ${esc(v.name)} by Heston Photo" width="800" height="1200" loading="lazy">
      <span class="vcard-t">${esc(s.title)}</span>
      <span class="vcard-m">${s.count} photographs</span>
    </a>`).join('\n');

  const faq = v.faq.map(([q, a]) =>
    `<div class="vfaq"><h4>${esc(q)}</h4><p>${esc(a)}</p></div>`).join('\n');

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfessionalService', '@id': `${url}#business`,
        name: `Heston Photo — Asian Wedding Photography at ${v.name}`,
        description: desc, url, image: `${ORIGIN}/${hero}`,
        priceRange: '£££',
        address: { '@type': 'PostalAddress', addressLocality: 'London', addressCountry: 'GB' },
        areaServed: { '@type': 'Place', name: `${v.name}, ${v.where}` },
        provider: { '@type': 'Organization', name: 'Heston Photo', url: `${ORIGIN}/` },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: 'Wedding Photography', item: `${ORIGIN}/wedding-photography.html` },
          { '@type': 'ListItem', position: 3, name: `${v.name}`, item: url },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: v.faq.map(([q, a]) => ({
          '@type': 'Question', name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      },
    ],
  };

  const extraCss = `<style>
.vnote{margin:0 0 26px}
.vnote h4{font-family:"Cormorant Garamond",serif;font-size:1.3rem;font-weight:500;margin:0 0 6px;color:#2C2C2C}
.vnote p{margin:0;line-height:1.75}
.vgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:22px;margin:28px 0 0}
.vcard{display:block;text-decoration:none;color:inherit}
.vcard img{width:100%;height:320px;object-fit:cover;display:block;border-radius:2px}
.vcard-t{display:block;font-family:"Cormorant Garamond",serif;font-size:1.15rem;margin:10px 0 2px}
.vcard-m{display:block;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;opacity:.6}
.vfaq{margin:0 0 22px}
.vfaq h4{font-family:"Montserrat",sans-serif;font-size:.9rem;font-weight:600;margin:0 0 6px;color:#2C2C2C}
.vfaq p{margin:0;line-height:1.75}
.vsec{margin:56px 0 0}
.vsec > h3{font-family:"Cormorant Garamond",serif;font-size:1.9rem;font-weight:400;margin:0 0 22px;color:#2C2C2C}
</style>`;

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<script src="/cookie-consent.js"></script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#2C2C2C">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${ORIGIN}/${hero}">
<meta property="og:site_name" content="Heston Photo">
<meta property="og:locale" content="en_GB">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${ORIGIN}/${hero}">
<link rel="icon" type="image/x-icon" href="favicon.ico">
<link rel="apple-touch-icon" href="favicon-64.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
${STYLE}
${extraCss}
<script type="application/ld+json">${jsonEsc(JSON.stringify(ld))}</script>
</head>
<body>
${HEADER}
<nav aria-label="Breadcrumb" class="breadcrumb"><a href="index.html">Home</a><span>/</span><a href="wedding-photography.html">Wedding Photography</a><span>/</span>${esc(v.name)}</nav>
<main class="wrap">
<div class="lede">
<p class="eyebrow">${esc(v.eyebrow)} &middot; ${esc(v.where)}</p>
<h2 class="page">Asian Wedding Photographer at ${esc(v.name)}</h2>
<p>${esc(v.lede)}</p>
</div>

<div class="vsec">
<h3>Photographing at ${esc(v.name)}</h3>
${notes}
</div>

<div class="vsec">
<h3>Weddings we have photographed here</h3>
<div class="vgrid">
${cards}
</div>
</div>

<div class="vsec">
<h3>Common questions</h3>
${faq}
</div>

<div class="vsec">
<h3>Related</h3>
<p><a href="wedding-photography.html">Asian wedding photography</a> &middot; <a href="pre-wedding-shoots.html">Pre-wedding shoots</a> &middot; <a href="portfolio.html">Full portfolio</a> &middot; <a href="intimate-asian-weddings-london.html">Intimate Asian weddings in London</a></p>
</div>

<div class="cta"><h3>Photographing at ${esc(v.name)}?</h3><p>Tell us your date and we will confirm availability and send recent work from the venue.</p><a class="btn" href="index.html#contact">Enquire with Heston Photo</a></div>
</main>
${FOOTER}
</body>
</html>
`;
}

let written = 0;
for (const v of venues) {
  const out = path.join(ROOT, `${v.slug}.html`);
  fs.writeFileSync(out, page(v));
  console.log(`  ${v.slug}.html`);
  written++;
}
console.log(`\n${written} venue pages written.`);
