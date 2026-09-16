// Fail when a rendered diagram stops agreeing with its .mmd.
//
// The README calls the .mmd the source. Nothing enforced that, so the quick way
// to fix a wrong word in a picture was to edit the picture — and errors lived in
// rendered SVGs while the .mmd beside them was already right. Three gates, no
// dependencies and no browser, so this runs anywhere:
//
//   1. Every word the .mmd puts in a label appears in both SVGs.
//   2. Neither SVG carries Mermaid's stock palette, and both carry this
//      product's — i.e. they went through theme.json, not the defaults.
//   3. Both SVGs are well-formed XML.
//
//   node docs/diagrams/check.mjs
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const THEME = JSON.parse(await readFile(join(HERE, 'theme.json'), 'utf8'));
const fail = [];

// Mermaid's built-in themes. Their presence means a render went out without
// theme.json, whatever the picture looks like at a glance.
const STOCK = ['#ececff', '#9370db', '#ffffde', '#aaaa33', '#a44141', '#f9fffe', '#1f2020', '#e8e8e8'];

const decode = (s) => s
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

// Words worth asserting on. Punctuation-only fragments and single characters
// carry no meaning and would only make the check noisy.
const words = (text) => decode(text)
  .split(/[\s,;]+/)
  .map((w) => w.replace(/^[("'[{]+|[)"'\]}.:]+$/g, ''))
  .filter((w) => w.length > 1 && /[a-z0-9]/i.test(w));

// Label text in a .mmd: anything quoted, plus |edge labels|. Comment lines are
// not content.
const labelsOf = (mmd) => {
  const body = mmd.split('\n').filter((l) => !l.trim().startsWith('%%')).join('\n');
  const out = [];
  for (const m of body.matchAll(/"([^"]*)"/g)) out.push(m[1]);
  for (const m of body.matchAll(/\|([^|]+)\|/g)) out.push(m[1]);
  return out;
};

// The words a renderer will actually show: <text>/<tspan> content, with the
// stylesheet removed so CSS identifiers cannot satisfy the check by accident.
//
// A Set of whole words, not one long string: a substring test passes "repair
// font" against a picture that says "repair fonts". Tspans are joined with a
// space because each is one rendered line, which also means a word split across
// two of them fails — as it should, that is how one label once rendered as
// "TerminalInterpolatedStringHa / ndler".
const renderedWords = (svg) => {
  const noStyle = svg.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const text = [...noStyle.matchAll(/<(?:text|tspan)[\s>][\s\S]*?<\/(?:text|tspan)>/gi)]
    .map((m) => m[0].replace(/<[^>]*>/g, ' ')).join(' ');
  return new Set(words(text).map((w) => w.toLowerCase()));
};

// Well-formedness by tag stack. Node ships no XML parser, and pulling one in
// would cost this check its "runs anywhere with no install" property.
const xmlError = (svg) => {
  const stack = [];
  const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m, consumed = 0;
  while ((m = re.exec(svg))) {
    consumed = re.lastIndex;
    if (!m[2]) continue;
    if (m[1]) {
      const open = stack.pop();
      if (open !== m[2]) return `</${m[2]}> closes <${open ?? 'nothing'}>`;
    } else if (!m[4]) stack.push(m[2]);
  }
  if (svg.slice(consumed).includes('<')) return 'unparseable markup after the last complete tag';
  if (stack.length) return `<${stack[stack.length - 1]}> is never closed`;
  return null;
};

const sources = (await readdir(HERE)).filter((f) => f.endsWith('.mmd')).sort();
if (!sources.length) { console.error('no .mmd files beside this script'); process.exit(1); }

for (const file of sources) {
  const mmd = await readFile(join(HERE, file), 'utf8');
  const want = [...new Set(labelsOf(mmd).flatMap(words))];
  const slug = basename(file, '.mmd');

  for (const variant of ['light', 'dark']) {
    const name = `${slug}-${variant}.svg`;
    let svg;
    try { svg = await readFile(join(HERE, name), 'utf8'); }
    catch { fail.push(`${name}: missing — run: node docs/diagrams/build.mjs`); continue; }

    const broken = xmlError(svg);
    if (broken) { fail.push(`${name}: not well-formed XML — ${broken}`); continue; }

    const shown = renderedWords(svg);
    const missing = want.filter((w) => !shown.has(w.toLowerCase()));
    if (missing.length)
      fail.push(`${name}: ${file} says ${missing.map((w) => JSON.stringify(w)).join(', ')}, the picture does not`);

    const lower = svg.toLowerCase();
    const stock = STOCK.filter((c) => lower.includes(c));
    if (stock.length)
      fail.push(`${name}: rendered on Mermaid's stock palette (${stock.join(', ')}) — build.mjs applies theme.json`);

    for (const key of ['plate', 'text', 'node'])
      if (!lower.includes(THEME[variant][key]))
        fail.push(`${name}: theme.${variant}.${key} (${THEME[variant][key]}) does not appear`);
  }
}

if (fail.length) {
  console.error(`diagram check failed — ${fail.length} problem(s):\n`);
  for (const f of fail) console.error('  ' + f);
  process.exit(1);
}
console.log(`diagrams ok — ${sources.length} source(s), ${sources.length * 2} SVGs carry every label and this product's palette`);
