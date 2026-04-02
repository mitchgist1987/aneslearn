/**
 * inject_greenbook.js
 * 
 * Reads the latest markdown files from ./cugammadex/docs/
 * Converts them to HTML and injects into AnesLearn/index.html
 * replacing the getRotationContent() function.
 * 
 * Run automatically by Netlify build script (build.sh)
 * Or manually: node inject_greenbook.js
 */

const fs = require('fs');
const path = require('path');

const GREENBOOK_DIR = './cugammadex/docs';
const SOURCE_HTML = './AnesLearn/index.html';
const OUT_HTML = './AnesLearn/index.html';

// File map: section ID -> relative path in greenbook repo
const FILE_MAP = {
  aps:          'r/aps.md',
  chco:         'r/chco.md',
  cp:           'r/cp.md',
  ct:           'r/ct.md',
  cticu:        'r/cticu.md',
  dh:           'r/dh.md',
  inverness:    'r/inverness.md',
  neuro:        'r/neuro.md',
  nora:         'r/nora.md',
  ob:           'r/ob.md',
  pacu:         'r/pacu.md',
  pocus:        'r/pocus.md',
  pps:          'r/pps.md',
  senior:       'r/senior.md',
  sticu:        'r/sticu.md',
  txp:          'r/txp.md',
  uch:          'r/uch.md',
  va:           'r/va.md',
  'ob-cookbook':'ref/ob-cookbook.md',
  'ct-att':     'ref/ct-att.md',
  vpn:          'ref/vpn.md',
  contacts:     'supplemental/contacts.md',
  qgenda:       'supplemental/qgenda-glossary.md',
  interns:      'supplemental/interns.md',
  links:        'supplemental/links.md',
};

function mdToHtml(md) {
  // Strip frontmatter
  if (md.startsWith('---')) {
    const parts = md.split('---');
    if (parts.length >= 3) md = parts.slice(2).join('---').trim();
  }

  const lines = md.split('\n');
  const out = [];
  let inUl = false, inCode = false, inDetails = false, inTable = false;

  for (let line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) { out.push('</code></pre>'); inCode = false; }
      else { out.push('<pre style="background:#F4F2EE;padding:12px;border-radius:8px;font-size:12px;overflow-x:auto;"><code>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(line.replace(/</g,'&lt;').replace(/>/g,'&gt;')); continue; }

    if (line.trim().startsWith('::: details')) {
      const label = line.trim().replace('::: details','').trim();
      out.push(`<details style="margin:8px 0;border:1px solid #E8E5DF;border-radius:8px;padding:10px 14px;"><summary style="cursor:pointer;font-weight:600;font-size:13px;">${label||'Details'}</summary><div style="margin-top:10px;">`);
      inDetails = true; continue;
    }
    if (line.trim() === ':::' && inDetails) { out.push('</div></details>'); inDetails = false; continue; }
    if (line.trim().startsWith(':::')) continue;

    if (inUl && !line.startsWith('- ') && !line.startsWith('  - ')) {
      out.push('</ul>'); inUl = false;
    }

    const inline = s => s
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background:#F4F2EE;padding:1px 5px;border-radius:4px;font-size:12px;">$1</code>')
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#CFB87C;">$1</a>');

    if (line.startsWith('#### ')) out.push(`<h4 style="font-size:14px;font-weight:700;margin:16px 0 6px;">${inline(line.slice(5))}</h4>`);
    else if (line.startsWith('### ')) out.push(`<h3 style="font-size:16px;font-weight:700;margin:20px 0 8px;color:#A8924A;">${inline(line.slice(4))}</h3>`);
    else if (line.startsWith('## ')) out.push(`<h2 style="font-size:18px;font-weight:800;font-family:'Playfair Display',serif;margin:24px 0 10px;padding-bottom:6px;border-bottom:1px solid #E8E5DF;">${inline(line.slice(3))}</h2>`);
    else if (line.startsWith('# ')) out.push(`<h1 style="font-size:22px;font-weight:800;font-family:'Playfair Display',serif;margin-bottom:16px;">${inline(line.slice(2))}</h1>`);
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inUl) { out.push('<ul style="margin:6px 0 6px 20px;line-height:1.7;">'); inUl = true; }
      out.push(`<li style="font-size:13px;">${inline(line.slice(2))}</li>`);
    }
    else if (line.startsWith('> ')) out.push(`<div style="border-left:3px solid #CFB87C;background:#FAF3DF;padding:10px 14px;border-radius:0 8px 8px 0;margin:10px 0;font-size:13px;">${inline(line.slice(2))}</div>`);
    else if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line.trim().slice(1,-1).split('|').map(c=>c.trim());
      if (cells.every(c => /^[-:]+$/.test(c))) continue;
      if (!inTable) { out.push('<div style="overflow-x:auto;margin:12px 0;"><table style="width:100%;border-collapse:collapse;font-size:12px;">'); inTable = true; }
      const isHeader = !out.some(l => l.includes('<td'));
      const tag = isHeader ? 'th' : 'td';
      const style = isHeader ? 'padding:7px 10px;border:1px solid #E8E5DF;background:#F4F2EE;font-weight:700;' : 'padding:7px 10px;border:1px solid #E8E5DF;';
      out.push(`<tr>${cells.map(c=>`<${tag} style="${style}">${inline(c)}</${tag}>`).join('')}</tr>`);
    }
    else {
      if (inTable) { out.push('</table></div>'); inTable = false; }
      if (line.trim()) out.push(`<p style="font-size:13px;line-height:1.7;margin:6px 0;">${inline(line.trim())}</p>`);
    }
  }
  if (inUl) out.push('</ul>');
  if (inTable) out.push('</table></div>');
  return out.join('\n');
}

// Read and convert all files
const contentMap = {};
for (const [id, relPath] of Object.entries(FILE_MAP)) {
  const fullPath = path.join(GREENBOOK_DIR, relPath);
  try {
    const md = fs.readFileSync(fullPath, 'utf8');
    const html = mdToHtml(md)
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$\{/g, '\\${');
    contentMap[id] = html;
    console.log(`✓ ${id}: ${html.length} chars`);
  } catch(e) {
    console.warn(`⚠ ${id}: ${e.message}`);
    contentMap[id] = `<p style="color:#aaa;">Content not available for ${id}.</p>`;
  }
}

// Build new getRotationContent function
const cases = Object.entries(contentMap)
  .map(([k,v]) => `    case '${k}': return \`${v}\`;`)
  .join('\n');

const newFn = `\nfunction getRotationContent(sec) {\n  switch(sec) {\n${cases}\n    default: return getRotationContent('overview');\n  }\n}\n`;

// Inject into HTML
let html = fs.readFileSync(SOURCE_HTML, 'utf8');
const fnStart = html.indexOf('\nfunction getRotationContent(sec)');
const fnEnd = html.indexOf('\nfunction pgResources()');

if (fnStart === -1 || fnEnd === -1) {
  console.error('ERROR: Could not find getRotationContent in index.html');
  process.exit(1);
}

html = html.slice(0, fnStart) + newFn + html.slice(fnEnd);
fs.writeFileSync(OUT_HTML, html);
console.log(`\n✅ Injected ${Object.keys(contentMap).length} rotation guides`);
console.log(`   Output: ${OUT_HTML} (${(html.length/1024).toFixed(0)} KB)`);
