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

const notesDir = path.join(repoRoot, 'notes');
const slugs = readdirSync(notesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(notesDir, d.name, 'index.html')))
  .map((d) => d.name);

if (slugs.length < 3) fail(`Expected at least 3 notes, found ${slugs.length}.`);

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
