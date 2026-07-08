#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const FILES = ['index.html', 'book.html'];
const SHARED_IDS = [
  'https://suedeai.ai/founder#person',
  'https://suede-ai.github.io/#website',
];

function extractGraph(fileName) {
  const html = readFileSync(path.join(repoRoot, fileName), 'utf8');
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error(`No JSON-LD script block found in ${fileName}`);
  }
  const data = JSON.parse(match[1]);
  return data['@graph'] || [];
}

function findNode(graph, id) {
  return graph.find((node) => node['@id'] === id);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

const graphs = Object.fromEntries(FILES.map((f) => [f, extractGraph(f)]));

let hasMismatch = false;

for (const id of SHARED_IDS) {
  const nodesByFile = FILES.map((f) => [f, findNode(graphs[f], id)]);
  const [[, referenceNode], ...rest] = nodesByFile;

  if (!referenceNode) {
    console.error(`Node "${id}" is missing from ${FILES[0]}.`);
    hasMismatch = true;
    continue;
  }

  const referenceJson = JSON.stringify(canonicalize(referenceNode));

  for (const [fileName, node] of rest) {
    if (!node) {
      console.error(`Node "${id}" is missing from ${fileName}.`);
      hasMismatch = true;
      continue;
    }
    if (JSON.stringify(canonicalize(node)) !== referenceJson) {
      console.error(`Node "${id}" differs between ${FILES[0]} and ${fileName}.`);
      hasMismatch = true;
    }
  }
}

if (hasMismatch) {
  console.error('\nThe Person/WebSite JSON-LD nodes must stay identical across index.html and book.html.');
  process.exit(1);
}

console.log('Schema sync check passed: Person/WebSite JSON-LD nodes match across index.html and book.html.');
