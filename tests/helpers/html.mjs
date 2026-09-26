import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

export function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

export function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

export function stripStyles(html) {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
}

export function htmlIds(html) {
  const markup = stripScripts(html);
  return [...markup.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
}

export function inlineScripts(html) {
  const out = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    if (/ld\+json/i.test(attrs)) continue;
    out.push(m[2]);
  }
  return out;
}

export function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/gi)].map((m) => m[1]);
}

export function extractBalanced(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const i = src.indexOf('{', at);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return null;
}

export function extractArray(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const i = src.indexOf('[', at);
  if (i < 0) return null;
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return src.slice(i, j + 1);
    }
  }
  return null;
}

export function cssVarsDefined(css) {
  const defined = new Set();
  const re = /--([a-zA-Z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(css))) defined.add('--' + m[1]);
  return defined;
}

export function cssVarsUsed(css) {
  const used = new Set();
  const re = /var\((--[a-zA-Z0-9-]+)(?=[,)])/g;
  let m;
  while ((m = re.exec(css))) used.add(m[1]);
  return used;
}

export function ensureDir(rel) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

export function writeReport(name, data) {
  const dir = ensureDir('tests/reports');
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}
