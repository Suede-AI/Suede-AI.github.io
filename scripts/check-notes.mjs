#!/usr/bin/env node
// Guard for the /notes/ article section: canonical @ids, metadata, sitemap and
// llms.txt coverage, and forbidden claims or copy.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://suede-ai.github.io';
const PERSON = 'https://suedeai.ai/founder#person';
const ORG = 'https://suedeai.ai/#organization';
const ALLOWED_IDS_OUTSIDE_SITE = new Set([PERSON, ORG]);

const FORBIDDEN = [
  /velvet sundown/i,
  /\$\s?28\s?m/i,
  /\$\s?30\s?m/i,
  /multimillion/i,
  /forbes/i,
  /\bFAU\b/,
  /anthropic partner/i,
  /claude partner/i,
  /google partner/i,
  /olive ave/i,
  /\bdelve/i,
  /\bleverag/i,
  /\bunlock/i,
  /\belevat/i,
  /seamless/i,
  /game-changer/i,
  /tapestry/i,
  /\brealm\b/i,
  /fast-paced world/i,
];

const read = (p) => readFileSync(path.join(repoRoot, p), 'utf8');
const errors = [];
const fail = (msg) => errors.push(msg);

// Banned hedging phrases (owner ruling 2026-11-18). Founder-stated facts are
// the record, so public copy never disclaims, qualifies or undercuts them.
// Case-insensitive; ['’] also catches curly apostrophes.
const HEDGE_FAMILIES = [
  {
    family: 'promise disclaimer',
    patterns: [
      /cannot be promised/i,
      /can['’]t promise/i,
      /cannot promise/i,
      /no one can guarantee/i,
      /nobody can guarantee/i,
      /not a guarantee/i,
      /no guarantee/i,
    ],
  },
  {
    family: 'proves-nothing framing',
    patterns: [/what this does not prove/i, /does not prove/i, /doesn['’]t prove/i, /\bnot proof\b/i],
  },
  {
    family: 'unit disclaimer on a founder figure',
    patterns: [/events, not users/i, /not active users/i, /not unique products/i, /not installs\b/i, /not downloads\b/i],
  },
  {
    family: 'attribution qualifier',
    patterns: [/as reported by/i, /founder[-‐‑ ]reported/i, /self[-‐‑ ]reported/i],
  },
  {
    family: 'listing caveat',
    patterns: [/editions overlap/i, /Android editions overlap iOS/i, /counts describe platform listings/i],
  },
];

// Files the hedge scan skips, each with the reason it is out of scope.
const HEDGE_EXEMPT_PATHS = [
  { re: /^(LICENSE|.*\/?(terms|privacy|licen[cs]es?)(\/index)?\.(html|md|txt))$/i, why: 'legal pages state legal terms verbatim' },
  { re: /^scripts\//, why: 'code, error messages and guard self-test fixtures, not public copy' },
  { re: /^(AGENTS|CLAUDE)\.md$/, why: 'agent instructions list the banned phrases so agents can avoid them' },
  { re: /^docs\/handoffs\//, why: 'internal handoff records, not published' },
  { re: /^(google[0-9a-f]+\.html|[0-9a-f]{64}\.txt)$/, why: 'search-engine verification tokens carry no copy' },
  { re: /^site\/book\/.*(method|measur)/i, why: 'book methodology chapters teach readers measurement; not claims about Suede' },
];

// Regions inside a scanned file that the hedge scan blanks out (newlines are
// kept so reported line numbers stay true).
const HEDGE_EXEMPT_REGIONS = [
  { re: /<!--[\s\S]*?-->/g, why: 'HTML comments are code comments, never rendered' },
  { re: /<blockquote[\s\S]*?<\/blockquote>/gi, why: 'third-party quotes stay verbatim' },
  { re: /<script(?![^>]*application\/ld\+json)[^>]*>[\s\S]*?<\/script>/gi, why: 'scripts are code; JSON-LD stays in scope' },
  { re: /<style[\s\S]*?<\/style>/gi, why: 'stylesheets are code' },
  { re: /\bregistry record (?:does not|doesn['’]t) prove ownership\b/gi, why: 'IP-registry legal explanation' },
];

const HEDGE_SCANNED_EXT = /\.(html|txt|xml|json|md)$/i;

function hedgeExemptPath(rel) {
  return HEDGE_EXEMPT_PATHS.find((e) => e.re.test(rel));
}

function scanHedges(rel, text) {
  if (hedgeExemptPath(rel)) return [];
  let scrubbed = text;
  for (const { re } of HEDGE_EXEMPT_REGIONS) scrubbed = scrubbed.replace(re, (m) => m.replace(/[^\n]/g, ' '));
  const hits = [];
  scrubbed.split('\n').forEach((line, i) => {
    for (const { family, patterns } of HEDGE_FAMILIES) {
      for (const re of patterns) {
        const m = line.match(re);
        if (m) hits.push(`${rel}:${i + 1}: banned hedging phrase (${family}): "${m[0]}"`);
      }
    }
  });
  return hits;
}

function hedgeSelfTest() {
  const problems = [];
  const caught = [
    ['promise disclaimer', 'notes/x/index.html', '<p>Results cannot be promised.</p>'],
    ['promise disclaimer', 'index.html', '<p>We can’t promise rankings.</p>'],
    ['proves-nothing framing', 'llms.txt', 'What this does not prove: anything.'],
    ['proves-nothing framing', 'notes/x/index.html', '<script type="application/ld+json">{"text":"This is not proof"}</script>'],
    ['unit disclaimer on a founder figure', 'llms-full.txt', '145 acquisition events, not users.'],
    ['attribution qualifier', 'notes/x/index.html', '<figcaption>Source: Suede app analytics, as reported by Jason Colapietro.</figcaption>'],
    ['attribution qualifier', 'book.html', 'a founder-reported figure'],
    ['listing caveat', 'app-store-listings.json', '{"scope":"Counts describe platform listings. Android editions overlap iOS products."}'],
  ];
  for (const [family, rel, text] of caught) {
    const hits = scanHedges(rel, text);
    if (!hits.some((h) => h.includes(`(${family})`))) problems.push(`self-test: ${family} not caught in ${rel}`);
    if (!hits.every((h) => h.startsWith(`${rel}:1: `))) problems.push(`self-test: hit for ${rel} lacks file:line`);
  }
  const multi = scanHedges('index.html', 'ok\nok\nnobody can guarantee it');
  if (!multi[0]?.startsWith('index.html:3: ')) problems.push('self-test: line number not reported correctly');
  const exempt = [
    ['LICENSE', 'THE SOFTWARE IS PROVIDED AS IS, WITH NO GUARANTEE'],
    ['terms.html', '<p>There is no guarantee of results.</p>'],
    ['privacy/index.html', '<p>We cannot promise uptime.</p>'],
    ['scripts/fixture.mjs', "throw new Error('not proof')"],
    ['AGENTS.md', '- "cannot be promised"'],
    ['docs/handoffs/2026-11-18.md', 'events, not users'],
    ['google4b0bcf0a4950299c.html', 'self-reported'],
    ['site/book/chapter-07-measurement.html', 'A spike does not prove causation.'],
    ['index.html', '<!-- not a guarantee -->'],
    ['index.html', '<blockquote>Nobody can guarantee a citation.</blockquote>'],
    ['index.html', "<script>console.error('not proof')</script>"],
    ['notes/x/index.html', '<p>A registry record doesn’t prove ownership.</p>'],
  ];
  for (const [rel, text] of exempt) {
    if (scanHedges(rel, text).length) problems.push(`self-test: exemption not respected for ${rel}`);
  }
  return problems;
}

function walkPublic(dir = repoRoot, out = []) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.name === '.git' || d.name === 'node_modules' || d.name === '.github') continue;
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) walkPublic(abs, out);
    else if (HEDGE_SCANNED_EXT.test(d.name) || d.name === 'LICENSE') out.push(path.relative(repoRoot, abs).split(path.sep).join('/'));
  }
  return out;
}

hedgeSelfTest().forEach(fail);
for (const rel of walkPublic()) scanHedges(rel, read(rel)).forEach(fail);

const notesDir = path.join(repoRoot, 'notes');
const slugs = readdirSync(notesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(notesDir, d.name, 'index.html')))
  .map((d) => d.name);

if (slugs.length < 3) fail(`Expected at least 3 notes, found ${slugs.length}.`);

// Every published note must stay on disk; removing one would orphan sitemap
// and llms entries and break inbound links from sibling satellites.
const REQUIRED_SLUGS = [
  'ai-search-asset-west-palm-beach-jupiter',
  'public-evidence-ledger',
  'stake-your-claim-in-client-seo-geo',
  'google-business-profile-directories-without-inventing',
  'customer-proof-structured-evidence',
];
for (const slug of REQUIRED_SLUGS) {
  if (!slugs.includes(slug)) fail(`notes/${slug}/index.html is missing.`);
}

// Depth articles (2026-11-15): published that day, 900-1300 words, deep links
// to at least two articles on other Suede AI satellite sites, and the Clutch
// ranking stated once in its exact wording, apart from The Manifest.
const DEPTH_SLUGS = new Set([
  'google-business-profile-directories-without-inventing',
  'customer-proof-structured-evidence',
]);
const SATELLITE_ARTICLE =
  /href="(https:\/\/(?:optimize|docs|agentix|signal|dna|podcast)\.suedeai\.ai\/(?:notes|articles)\/[a-z0-9-]+\/?|https:\/\/(?:guitar\.services|guitarchords\.info|guitarhub\.org)\/notes\/[a-z0-9-]+\/?)"/g;
const CLUTCH_SENTENCE =
  'Suede ranks among <a href="https://clutch.co/profile/suede-ai-seo">Clutch</a>\'s ' +
  '<a href="https://clutch.co/consulting/ai/florida">Top 30 AI Consultants in Florida</a> and ' +
  '<a href="https://clutch.co/us/consulting/ai">Top 50 AI Consultants nationwide</a> (November 2026).';

const sitemap = read('sitemap.xml');
const llms = read('llms.txt');
const llmsFull = read('llms-full.txt');
const notesIndex = read('notes/index.html');

function collectIds(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => collectIds(n, out));
  else if (node && typeof node === 'object') {
    if (typeof node['@id'] === 'string') out.push(node['@id']);
    Object.values(node).forEach((v) => collectIds(v, out));
  }
  return out;
}

function checkIds(file, graph) {
  for (const id of collectIds(graph)) {
    if (!id.startsWith(`${SITE}/`) && !ALLOWED_IDS_OUTSIDE_SITE.has(id)) {
      fail(`${file}: unexpected external @id ${id}`);
    }
  }
  const minted = graph.filter((n) => ['Person', 'Organization'].includes(n['@type']));
  if (minted.length) fail(`${file}: must not define Person/Organization nodes; reference canonical @ids.`);
}

for (const slug of slugs) {
  const file = `notes/${slug}/index.html`;
  const url = `${SITE}/notes/${slug}/`;
  const html = read(file);

  const title = html.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
  const desc = html.match(/<meta name="description" content="(.*?)">/)?.[1] ?? '';
  const plainLen = (s) => s.replace(/&[#\w]+;/g, 'x').length;
  if (plainLen(title) < 50 || plainLen(title) > 60) fail(`${file}: title length ${plainLen(title)} not in 50-60.`);
  if (plainLen(desc) < 120 || plainLen(desc) > 160) fail(`${file}: description length ${plainLen(desc)} not in 120-160.`);
  if (!html.includes(`<link rel="canonical" href="${url}">`)) fail(`${file}: canonical must be ${url}`);
  if (!html.includes(`<meta property="og:url" content="${url}">`)) fail(`${file}: og:url must be ${url}`);
  if ((html.match(/<h1[\s>]/g) || []).length !== 1) fail(`${file}: must have exactly one h1.`);

  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!ld) {
    fail(`${file}: missing JSON-LD.`);
  } else {
    const graph = JSON.parse(ld[1])['@graph'] || [];
    const post = graph.find((n) => n['@type'] === 'BlogPosting');
    const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList');
    if (!post) fail(`${file}: missing BlogPosting.`);
    else {
      if (post.author?.['@id'] !== PERSON) fail(`${file}: BlogPosting author must reference ${PERSON}`);
      if (post.publisher?.['@id'] !== ORG) fail(`${file}: BlogPosting publisher must reference ${ORG}`);
      if (post.mainEntityOfPage?.['@id'] !== url) fail(`${file}: mainEntityOfPage must be ${url}`);
      if (!post.datePublished) fail(`${file}: missing datePublished.`);
    }
    if (!crumbs || crumbs.itemListElement?.at(-1)?.item !== url) fail(`${file}: BreadcrumbList must end at ${url}`);
    checkIds(file, graph);
  }

  const body = (html.match(/<article>([\s\S]*?)<\/article>/)?.[1] ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[#\w]+;/g, ' ');
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < 800 || words > 1300) fail(`${file}: ${words} words, expected 800-1300.`);
  if ((body.match(/Suede Labs/g) || []).length > 1) fail(`${file}: "Suede Labs" may appear at most once.`);
  if ((body.match(/Jason Colapietro/g) || []).length < 5) fail(`${file}: name Jason Colapietro at least 5 times.`);
  if (!html.includes('https://suedeai.agency/')) fail(`${file}: must link suedeai.agency.`);
  if (!html.includes('https://suedeai.ai/founder')) fail(`${file}: must link the founder page.`);

  for (const re of FORBIDDEN) if (re.test(html)) fail(`${file}: forbidden term ${re}`);

  if (DEPTH_SLUGS.has(slug)) {
    const articleHtml = html.match(/<article>([\s\S]*?)<\/article>/)?.[1] ?? '';
    if (words < 900) fail(`${file}: depth article has ${words} words, expected at least 900.`);
    if (!html.includes('"datePublished": "2026-11-15"')) fail(`${file}: depth article datePublished must be 2026-11-15.`);
    const deepLinks = new Set([...articleHtml.matchAll(SATELLITE_ARTICLE)].map((m) => m[1]));
    if (deepLinks.size < 2) fail(`${file}: needs deep links to at least 2 sibling satellite articles, found ${deepLinks.size}.`);
    if (articleHtml.split(CLUTCH_SENTENCE).length - 1 !== 1) fail(`${file}: Clutch ranking must appear exactly once, in its exact wording.`);
    if (/Clutch[^.]*Manifest|Manifest[^.]*Clutch/.test(articleHtml.replace(/<[^>]+>/g, ''))) {
      fail(`${file}: Clutch and The Manifest rankings must not be merged into one sentence.`);
    }
    if (!articleHtml.includes('https://suedeai.agency/"')) fail(`${file}: must link the suedeai.agency home page in the body.`);
    if (!articleHtml.includes('href="https://suedeai.ai/founder"')) fail(`${file}: must link the founder page in the body.`);
    const entry = sitemap.match(new RegExp(`<loc>${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</loc>\\s*<lastmod>([^<]+)</lastmod>`));
    if (entry?.[1] !== '2026-11-15') fail(`sitemap.xml: ${url} lastmod must be 2026-11-15.`);
    if (!notesIndex.includes(`"@id": "${url}#article"`)) fail(`notes/index.html: CollectionPage hasPart must include ${url}#article`);
  }

  if (!sitemap.includes(`<loc>${url}</loc>`)) fail(`sitemap.xml: missing ${url}`);
  if (!llms.includes(url)) fail(`llms.txt: missing ${url}`);
  if (!llmsFull.includes(url)) fail(`llms-full.txt: missing ${url}`);
  if (!notesIndex.includes(`href="/notes/${slug}/"`)) fail(`notes/index.html: missing link to ${slug}`);
}

for (const file of ['notes/index.html', 'llms.txt', 'llms-full.txt']) {
  const text = read(file);
  for (const re of FORBIDDEN) if (re.test(text)) fail(`${file}: forbidden term ${re}`);
}
if (!sitemap.includes(`<loc>${SITE}/notes/</loc>`)) fail('sitemap.xml: missing notes index.');
if (!read('index.html').includes('href="/notes/"')) fail('index.html: missing link to /notes/.');

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Notes check passed: ${slugs.length} articles.`);
