#!/usr/bin/env node
// Guard for the /notes/ article section: canonical @ids, metadata, sitemap and
// llms.txt coverage, and forbidden claims or copy.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://suede-ai.github.io';
const PERSON = 'https://suedeai.ai/founder#person';
const ORG = 'https://suedeai.ai/#organization';
const LOGO = 'https://suedeai.ai/#logo';
// The book's canonical Book node lives on suedeai.ai (jasonBookId in
// suede-home/src/lib/seo-entity.ts); this site describes the same book.
const BOOK = 'https://suedeai.ai/founder#book-stake-your-claim';
// Owner ruling 2026-11-21: suedeai.agency owns the Suede SEO practice entity.
// Every other site references this one @id and never mints its own.
const PRACTICE = 'https://suedeai.agency/#suede-seo';
const ALLOWED_IDS_OUTSIDE_SITE = new Set([PERSON, ORG, LOGO, BOOK, PRACTICE]);

// Person and Organization nodes are owned by suedeai.ai. A note may carry them
// only as inline references (2026-11-21): the canonical @id plus the name, url
// and, for the Organization, the canonical logo, so a reader of one page alone
// still gets a named author and publisher. Anything more (sameAs, jobTitle,
// description, address) is a second definition of the entity and stays on
// suedeai.ai, where it cannot drift.
// The Person reference also carries worksFor, as a bare @id reference to the
// Organization (2026-11-21), so a note alone states the founder-to-Suede edge.
// The Suede SEO practice is referenced the same way, by the agency's @id.
const ENTITY_REFS = {
  Person: { id: PERSON, name: 'Jason Colapietro', url: 'https://suedeai.ai/founder', keys: ['@type', '@id', 'name', 'url', 'worksFor'] },
  Organization: { id: ORG, name: 'Suede', url: 'https://suedeai.ai/', keys: ['@type', '@id', 'name', 'url', 'logo'] },
  ProfessionalService: { id: PRACTICE, name: 'Suede SEO', url: 'https://suedeai.agency/', keys: ['@type', '@id', 'name', 'url'] },
};
const LOGO_URL = 'https://suedeai.ai/suede-ai-logo-transparent.png';

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

// Naming rule (owner rename brief, 2026-11-21): the company is "Suede"; its
// practices are "Suede SEO" and "Suede GEO". "Suede AI" and "Suede Labs" are
// old names and appear in public copy only as schema alternateName values or
// an explicit alias ("formerly Suede Labs"). The match is case-sensitive on
// purpose: lowercase search queries such as `suede ai deployment` are queries
// people type, not the company's name, and domains (suedeai.ai), the GitHub
// org (Suede-AI) and Clutch slugs (suede-ai-seo) never match.
const OLD_NAME = /\bSuede ?AI\b(?![.-])|\bSuede Labs\b/;
const NAMING_SCOPE = /^(index\.html|llms(-full)?\.txt|notes\/.*\.html)$/;
const NAMING_EXEMPT_REGIONS = [
  { re: /<!--[\s\S]*?-->/g, why: 'HTML comments are never rendered' },
  { re: /<blockquote[\s\S]*?<\/blockquote>/gi, why: 'third-party quotes stay verbatim' },
  { re: /"alternateName":\s*(\[[^\]]*\]|"[^"]*")/g, why: 'schema aliases merge the old names into the entity' },
  { re: /\b(?:formerly|also known as|previously)(?: known as)? Suede (?:AI|Labs)\b(?: and Suede (?:AI|Labs)\b)?/g, why: 'the one alias statement' },
];

function scanNaming(rel, text) {
  if (!NAMING_SCOPE.test(rel)) return [];
  let scrubbed = text;
  for (const { re } of NAMING_EXEMPT_REGIONS) scrubbed = scrubbed.replace(re, (m) => m.replace(/[^\n]/g, ' '));
  const hits = [];
  scrubbed.split('\n').forEach((line, i) => {
    const m = line.match(OLD_NAME);
    if (m) hits.push(`${rel}:${i + 1}: old company name "${m[0]}"; the name is "Suede" (rename brief 2026-11-21)`);
  });
  return hits;
}

function namingSelfTest() {
  const problems = [];
  const caught = [
    ['notes/x/index.html', '<a href="https://suedeai.agency/">Suede AI SEO and GEO agency in West Palm Beach</a>'],
    ['llms-full.txt', 'request a Suede AI visibility assessment'],
    ['index.html', '<p>the Suede Labs team</p>'],
  ];
  for (const [rel, text] of caught) if (!scanNaming(rel, text).length) problems.push(`naming self-test: not caught in ${rel}: ${text}`);
  const allowed = [
    ['notes/x/index.html', '"alternateName": ["Suede AI", "Suede Labs"]'],
    ['notes/x/index.html', 'founded Suede (formerly Suede Labs) in 2024'],
    ['llms.txt', 'Suede was formerly known as Suede AI and Suede Labs.'],
    ['notes/x/index.html', '<pre><code>suede ai deployment</code></pre> https://suedeai.ai/ https://github.com/Suede-AI'],
    ['notes/x/index.html', 'the query "Suede labs ai review"'],
    ['book.html', 'Suede Labs: The Human Authenticity Layer'],
  ];
  for (const [rel, text] of allowed) if (scanNaming(rel, text).length) problems.push(`naming self-test: false hit in ${rel}: ${text}`);
  return problems;
}

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
namingSelfTest().forEach(fail);
for (const rel of walkPublic()) {
  const text = read(rel);
  scanHedges(rel, text).forEach(fail);
  scanNaming(rel, text).forEach(fail);
}

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
// to at least two articles on other Suede satellite sites, and the Clutch
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

// Agency twins (2026-11-21, review round 5 F5): twenty notes have an
// adapted edition among the suedeai.agency field notes. Each one names its
// agency edition as canonical (link rel=canonical and og:url), stays out of
// sitemap.xml and the llms note lists (the agency edition is listed there
// instead), and stays linked from the notes index. Every other note is
// self-canonical and listed everywhere. Keep this map in step with
// content/lab-notes-*.mjs in suedeai-agency.
const AGENCY = 'https://suedeai.agency/field-notes/';
const TWINS = {
  'suede-sing-chatgpt-case-study': 'chatgpt-named-suede-sing',
  'one-chatgpt-answer-beat-page-one': 'ai-answer-shortlist',
  'suede-voice-chatgpt-play-referrals': 'chatgpt-play-attribution',
  'after-the-spike-keeping-the-citation': 'protect-ai-recommendation',
  'apps-as-geo-laboratory': 'tested-on-suede-apps-first',
  'suede-iteration-loop': 'one-change-geo-tests',
  'geo-experiments-that-failed': 'geo-tactics-we-retired',
  'measuring-ai-referrals-honestly': 'ai-referral-reporting',
  'health-apps-geo-lessons': 'health-brands-in-ai-answers',
  'wealth-apps-geo-lessons': 'finance-brands-in-ai-answers',
  'relationship-apps-geo-lessons': 'conversational-ai-queries',
  'health-wealth-relationships-one-pattern': 'safe-to-repeat-claims',
  'app-store-listing-is-a-source': 'store-listing-ai-source',
  'crawler-access-what-mattered': 'ai-crawler-gates',
  'structured-data-for-apps': 'app-schema-identity',
  'why-suede-is-just-suede': 'one-name-for-ai-engines',
  'ai-deployment-engineering-lessons': 'ai-feature-release-discipline',
  'ai-integration-engineering-for-geo': 'citable-ai-product-pages',
  'geo-is-not-seo-with-a-new-name': 'where-geo-and-seo-split',
  'from-app-lab-to-client-playbook': 'lab-findings-to-client-work',
};

// Site identity on the notes (2026-11-21, F10): the notes are "Suede notes"
// (og:site_name and the breadcrumb root), every byline reads the same, and
// every note links in its body to one of the Suede GEO, Suede AEO or AI
// visibility pages.
const SITE_NAME = 'Suede notes';
const BYLINE = /class="byline">By <a href="https:\/\/suedeai\.ai\/founder">Jason Colapietro<\/a>, Founder and CEO, Suede &middot; West Palm Beach, Florida &middot; <time /;
const SERVICE_PAGE_LINK = /<a href="https:\/\/suedeai\.ai\/(?:geo|aeo|ai-visibility)">/;
// Infographic text must render at 12px or more on a 390px phone: each SVG
// with text carries a min-width at least viewBox width x 12 / smallest
// font-size, and the figure scrolls sideways instead of shrinking it.
const MIN_SVG_TEXT_PX = 12;
function checkSvgText(file, html) {
  for (const svg of html.match(/<svg\b[\s\S]*?<\/svg>/g) || []) {
    if (!svg.includes('<text')) continue;
    const open = svg.match(/<svg[^>]*>/)[0];
    const vb = Number(open.match(/viewBox="0 0 ([0-9.]+) /)?.[1]);
    const fonts = [...svg.matchAll(/font-size="([0-9.]+)"/g)].map((m) => Number(m[1]));
    const smallest = fonts.length ? Math.min(...fonts) : 16;
    const minWidth = Number(open.match(/min-width:\s*([0-9.]+)px/)?.[1] || 0);
    if (!vb || (minWidth * smallest) / vb < MIN_SVG_TEXT_PX) {
      fail(`${file}: infographic text renders under ${MIN_SVG_TEXT_PX}px on phones; give the <svg> style="min-width:${Math.ceil((vb * MIN_SVG_TEXT_PX) / smallest)}px"`);
    }
  }
}

const sitemap = read('sitemap.xml');
const llms = read('llms.txt');
const llmsFull = read('llms-full.txt');
const notesIndex = read('notes/index.html');

function sitemapLastmod(url) {
  const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sitemap.match(new RegExp(`<loc>${esc}</loc>\\s*<lastmod>([^<]+)</lastmod>`))?.[1];
}

// Freshness (2026-11-21): a note whose file was committed after its
// dateModified tells crawlers nothing changed when it did. Compare each note's
// last commit date with its dateModified. A shallow clone (actions/checkout's
// default depth of 1) reports every file as last changed in the tip commit, so
// the check is skipped there with a notice rather than failing every note; CI
// checks out full history so the rule runs.
const GIT_DATES = (() => {
  const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    if (git('rev-parse', '--is-shallow-repository') === 'true') {
      console.warn('Notes freshness check skipped: shallow clone (fetch full history to run it).');
      return null;
    }
    return (rel) => git('log', '-1', '--format=%cs', '--', rel) || null;
  } catch {
    console.warn('Notes freshness check skipped: git history unavailable.');
    return null;
  }
})();

function checkFreshness(file, dateModified) {
  if (!GIT_DATES) return;
  const committed = GIT_DATES(file);
  if (committed && committed > dateModified) {
    fail(`${file}: last committed ${committed}, after its dateModified ${dateModified}; update dateModified and the sitemap lastmod.`);
  }
}

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
  if (minted.length) fail(`${file}: must not define top-level Person/Organization nodes; reference canonical @ids.`);
  checkEntityRefs(file, graph);
}

function checkEntityRefs(file, node) {
  if (Array.isArray(node)) return node.forEach((n) => checkEntityRefs(file, n));
  if (!node || typeof node !== 'object') return;
  const spec = ENTITY_REFS[node['@type']];
  if (spec) {
    if (node['@id'] !== spec.id) fail(`${file}: inline ${node['@type']} must use @id ${spec.id}`);
    if (node.name !== spec.name) fail(`${file}: inline ${node['@type']} name must be "${spec.name}"`);
    if (node.url !== undefined && node.url !== spec.url) fail(`${file}: inline ${node['@type']} url must be ${spec.url}`);
    const extra = Object.keys(node).filter((k) => !spec.keys.includes(k));
    if (extra.length) fail(`${file}: inline ${node['@type']} may carry only ${spec.keys.join(', ')}; found ${extra.join(', ')}`);
    if (node['@type'] === 'Person' && JSON.stringify(node.worksFor) !== JSON.stringify({ '@id': ORG })) {
      fail(`${file}: inline Person must carry worksFor {"@id": "${ORG}"}`);
    }
    if (node.logo !== undefined && (node.logo['@id'] !== LOGO || node.logo.url !== LOGO_URL)) {
      fail(`${file}: inline Organization logo must be ${LOGO} (${LOGO_URL})`);
    }
  }
  Object.values(node).forEach((v) => checkEntityRefs(file, v));
}

for (const slug of slugs) {
  const file = `notes/${slug}/index.html`;
  const url = `${SITE}/notes/${slug}/`;
  const twin = TWINS[slug] ? `${AGENCY}${TWINS[slug]}` : null;
  const canonical = twin || url;
  const html = read(file);

  const title = html.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
  const desc = html.match(/<meta name="description" content="(.*?)">/)?.[1] ?? '';
  const plainLen = (s) => s.replace(/&[#\w]+;/g, 'x').length;
  if (plainLen(title) < 50 || plainLen(title) > 60) fail(`${file}: title length ${plainLen(title)} not in 50-60.`);
  if (plainLen(desc) < 120 || plainLen(desc) > 160) fail(`${file}: description length ${plainLen(desc)} not in 120-160.`);
  if (!html.includes(`<link rel="canonical" href="${canonical}">`)) fail(`${file}: canonical must be ${canonical}`);
  if (!html.includes(`<meta property="og:url" content="${canonical}">`)) fail(`${file}: og:url must be ${canonical}`);
  if (!html.includes(`<meta property="og:site_name" content="${SITE_NAME}">`)) fail(`${file}: og:site_name must be "${SITE_NAME}"`);
  if (!BYLINE.test(html)) fail(`${file}: byline must read "By Jason Colapietro, Founder and CEO, Suede · West Palm Beach, Florida · <date>"`);
  if (!SERVICE_PAGE_LINK.test(html.match(/<article>([\s\S]*?)<\/article>/)?.[1] ?? '')) {
    fail(`${file}: article must link https://suedeai.ai/geo, /aeo or /ai-visibility in its body`);
  }
  checkSvgText(file, html);
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
      if (post.author?.['@type'] !== 'Person' || !post.author?.name) fail(`${file}: BlogPosting author must be an inline Person reference with a name`);
      if (post.publisher?.['@id'] !== ORG) fail(`${file}: BlogPosting publisher must reference ${ORG}`);
      if (post.publisher?.['@type'] !== 'Organization' || !post.publisher?.name || !post.publisher?.logo) {
        fail(`${file}: BlogPosting publisher must be an inline Organization reference with a name and logo`);
      }
      if (post.mainEntityOfPage?.['@id'] !== url) fail(`${file}: mainEntityOfPage must be ${url}`);
      if (!post.datePublished) fail(`${file}: missing datePublished.`);
      if (!post.dateModified) fail(`${file}: missing dateModified.`);
      else {
        if (post.dateModified < post.datePublished) fail(`${file}: dateModified ${post.dateModified} is before datePublished.`);
        if (!twin) {
          const lastmod = sitemapLastmod(url);
          if (lastmod !== post.dateModified) fail(`sitemap.xml: ${url} lastmod ${lastmod} must equal the note's dateModified ${post.dateModified}.`);
        }
        checkFreshness(file, post.dateModified);
      }
    }
    if (!crumbs || crumbs.itemListElement?.at(-1)?.item !== url) fail(`${file}: BreadcrumbList must end at ${url}`);
    const root = crumbs?.itemListElement?.[0];
    if (root?.name !== SITE_NAME || root?.item !== `${SITE}/notes/`) fail(`${file}: BreadcrumbList root must be "${SITE_NAME}" at ${SITE}/notes/`);
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
    if (!notesIndex.includes(`"@id": "${url}#article"`)) fail(`notes/index.html: CollectionPage hasPart must include ${url}#article`);
  }

  if (twin) {
    if (sitemap.includes(`<loc>${url}</loc>`)) fail(`sitemap.xml: ${url} is canonicalized to ${twin}; leave it out of the sitemap`);
    for (const [name, text] of [['llms.txt', llms], ['llms-full.txt', llmsFull]]) {
      if (text.includes(url)) fail(`${name}: ${url} is canonicalized to ${twin}; list the agency edition instead`);
      if (!text.includes(`(${twin})`)) fail(`${name}: missing the agency edition ${twin}`);
    }
  } else {
    if (!sitemap.includes(`<loc>${url}</loc>`)) fail(`sitemap.xml: missing ${url}`);
    if (!llms.includes(url)) fail(`llms.txt: missing ${url}`);
    if (!llmsFull.includes(url)) fail(`llms-full.txt: missing ${url}`);
  }
  if (!notesIndex.includes(`href="/notes/${slug}/"`)) fail(`notes/index.html: missing link to ${slug}`);
}

for (const file of ['notes/index.html', 'llms.txt', 'llms-full.txt']) {
  const text = read(file);
  for (const re of FORBIDDEN) if (re.test(text)) fail(`${file}: forbidden term ${re}`);
}
if (!sitemap.includes(`<loc>${SITE}/notes/</loc>`)) fail('sitemap.xml: missing notes index.');
{
  const ld = notesIndex.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const page = ld && (JSON.parse(ld[1])['@graph'] || []).find((n) => n['@type'] === 'CollectionPage');
  if (!page?.dateModified) fail('notes/index.html: CollectionPage must carry dateModified.');
  else {
    if (sitemapLastmod(`${SITE}/notes/`) !== page.dateModified) fail(`sitemap.xml: ${SITE}/notes/ lastmod must equal the notes index dateModified ${page.dateModified}.`);
    checkFreshness('notes/index.html', page.dateModified);
  }
  if (page) checkIds('notes/index.html', [page]);
}
if (!read('index.html').includes('href="/notes/"')) fail('index.html: missing link to /notes/.');

// Contextual links from the notes to the service page each one is about
// (2026-11-21), so links between the notes and suedeai.ai run both ways.
const SERVICE_LINKS = {
  'suede-geo-in-five-minutes': [['https://suedeai.ai/geo', 'Suede GEO']],
  'ai-deployment-engineering-lessons': [
    ['https://suedeai.ai/ai-deployment', 'AI deployment by Suede'],
    ['https://suedeai.ai/ai-engineering', 'AI engineering by Suede'],
  ],
  'ai-integration-engineering-for-geo': [['https://suedeai.ai/ai-integration', 'AI integration by Suede']],
  'measuring-ai-referrals-honestly': [['https://suedeai.ai/ai-visibility', 'AI visibility by Suede']],
  'weekly-brand-watch-ai-answers': [['https://suedeai.ai/ai-visibility', 'the AI visibility by Suede page']],
  'what-chatgpt-says-about-your-business': [['https://suedeai.ai/ai-visibility', 'AI visibility by Suede']],
};
for (const [slug, links] of Object.entries(SERVICE_LINKS)) {
  const article = read(`notes/${slug}/index.html`).match(/<article>([\s\S]*?)<\/article>/)?.[1] ?? '';
  for (const [href, anchor] of links) {
    if (!article.includes(`<a href="${href}">${anchor}</a>`)) fail(`notes/${slug}: article must link ${href} with anchor "${anchor}"`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Notes check passed: ${slugs.length} articles.`);
