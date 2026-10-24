// Inlines src/style.css, src/nn.js and src/app.js into src/content.html -> index.html.
// Run: node build.js    Share links default to the live site; override with SITE_URL=https://other.example/ (SITE_URL= for relative)
const fs = require('fs'), path = require('path');
const src = f => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
if (/<\/script/i.test(src('nn.js') + src('app.js'))) throw new Error('a script contains </script, which would break inlining');
const raw = process.env.SITE_URL ?? 'https://f-a-tonmoy.github.io/nn-explainer/';
const site = raw ? raw.replace(/\/?$/, '/') : '';
let html = src('content.html').replace(/\/\* @inline ([\w.]+) \*\//g, (_, f) => src(f));
// share previews need absolute URLs; without SITE_URL the image path stays relative and og:url is dropped
if (!site) html = html.replace(/^.*og:url.*\n/m, '');
html = html.replace(/@@SITE@@/g, site);
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log(`index.html written, ${(html.length / 1024).toFixed(1)} KB${site ? `, share links point to ${site}` : '. Set SITE_URL before deploying so LinkedIn can load the preview image.'}`);
