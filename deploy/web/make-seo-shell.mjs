// Builds dist/seo-shell.html: the production index.html whose <title> and description are replaced by a
// Caddy template include of the API's server-rendered head (/api/public/seo/<path>). Crawlers and link
// previews get the published congress metadata without running JavaScript; browsers get the same SPA.
import { readFileSync, writeFileSync } from 'node:fs';

const dist = process.argv[2] ?? 'dist';
const html = readFileSync(`${dist}/index.html`, 'utf8');
if (html.includes('{{')) throw new Error('index.html already contains template delimiters');
const head = /<meta name="description"[^>]*>\s*(?:<meta name="author"[^>]*>\s*)?<title>[^<]*<\/title>/;
if (!head.test(html)) throw new Error('index.html head layout changed: description/title not found');
const author = (html.match(/<meta name="author"[^>]*>/) ?? [''])[0];
const shell = html.replace(head, `${author}\n    {{ httpInclude (print "/api/public/seo" .OriginalReq.URL.Path) }}`);
writeFileSync(`${dist}/seo-shell.html`, shell);
console.log('seo-shell.html written');
