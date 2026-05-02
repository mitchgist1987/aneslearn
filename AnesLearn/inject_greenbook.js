/**
 * inject_greenbook.js
 * Injects Green Book content into index.html.
 * Works whether or not getRotationContent already exists in the file.
 */

const fs   = require('fs');
const path = require('path');

const GREENBOOK_DIR = path.resolve(__dirname, 'cugammadex/docs');
const INDEX_PATH    = path.resolve(__dirname, 'index.html');

const FILE_MAP = {
  aps:           'r/aps.md',
  chco:          'r/chco.md',
  cp:            'r/cp.md',
  ct:            'r/ct.md',
  cticu:         'r/cticu.md',
  dh:            'r/dh.md',
  inverness:     'r/inverness.md',
  neuro:         'r/neuro.md',
  nora:          'r/nora.md',
  ob:            'r/ob.md',
  pacu:          'r/pacu.md',
  pocus:         'r/pocus.md',
  pps:           'r/pps.md',
  senior:        'r/senior.md',
  sticu:         'r/sticu.md',
  txp:           'r/txp.md',
  uch:           'r/uch.md',
  va:            'r/va.md',
  'ob-cookbook': 'ref/ob-cookbook.md',
  'ct-att':      'ref/ct-att.md',
  vpn:           'ref/vpn.md',
  contacts:      'supplemental/contacts.md',
  qgenda:        'supplemental/qgenda-glossary.md',
  interns:       'supplemental/interns.md',
  links:         'supplemental/links.md',
};

function mdToHtml(md) {
  if (md.startsWith('---')) {
    const parts = md.split('---');
    if (parts.length >= 3) md = parts.slice(2).join('---').trim();
  }
  const lines = md.split('\n');
  const out = [];
  let inUl = false, inCode = false, inDetails = false, inTable = false, tableHeader = false;
  const inline = s => s
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:#F4F2EE;padding:1px 5px;border-radius:4px;font-size:12px;">$1</code>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#CFB87C;">$1</a>');
  const closeUl    = () => { if (inUl)    { out.push('</ul>');              inUl    = false; } };
  const closeTable = () => { if (inTable) { out.push('</table></div>');     inTable = false; tableHeader = false; } };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) { out.push('</code></pre>'); inCode = false; }
      else { closeUl(); closeTable(); out.push('<pre style="background:#F4F2EE;padding:12px;border-radius:8px;font-size:12px;overflow-x:auto;"><code>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(line.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')); continue; }
    if (line.trim().startsWith('::: details')) {
      closeUl(); closeTable();
      out.push('<details style="margin:8px 0;border:1px solid #E8E5DF;border-radius:8px;padding:10px 14px;"><summary style="cursor:pointer;font-weight:600;font-size:13px;">' + (line.trim().replace('::: details','').trim()||'Details') + '</summary><div style="margin-top:10px;">');
      inDetails = true; continue;
    }
    if (line.trim() === ':::') { if (inDetails) { out.push('</div></details>'); inDetails = false; } continue; }
    if (line.trim().startsWith(':::')) continue;
    if (inUl && !line.startsWith('- ') && !line.startsWith('* ') && !line.startsWith('  ')) closeUl();
    if      (line.startsWith('#### ')) { closeTable(); out.push('<h4 style="font-size:14px;font-weight:700;margin:16px 0 6px;">'                                                + inline(line.slice(5)) + '</h4>'); }
    else if (line.startsWith('### '))  { closeTable(); out.push('<h3 style="font-size:16px;font-weight:700;margin:20px 0 8px;color:#A8924A;">'                                  + inline(line.slice(4)) + '</h3>'); }
    else if (line.startsWith('## '))   { closeTable(); out.push('<h2 style="font-size:18px;font-weight:800;margin:24px 0 10px;padding-bottom:6px;border-bottom:1px solid #E8E5DF;">' + inline(line.slice(3)) + '</h2>'); }
    else if (line.startsWith('# '))    { closeTable(); out.push('<h1 style="font-size:22px;font-weight:800;margin-bottom:16px;">'                                               + inline(line.slice(2)) + '</h1>'); }
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inUl) { closeTable(); out.push('<ul style="margin:6px 0 6px 20px;line-height:1.7;">'); inUl = true; }
      out.push('<li style="font-size:13px;">' + inline(line.slice(2)) + '</li>');
    }
    else if (line.startsWith('> ')) { closeUl(); closeTable(); out.push('<div style="border-left:3px solid #CFB87C;background:#FAF3DF;padding:10px 14px;border-radius:0 8px 8px 0;margin:10px 0;font-size:13px;">' + inline(line.slice(2)) + '</div>'); }
    else if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line.trim().slice(1,-1).split('|').map(c=>c.trim());
      if (cells.every(c=>/^[-: ]+$/.test(c))) continue;
      if (!inTable) { closeUl(); out.push('<div style="overflow-x:auto;margin:12px 0;"><table style="width:100%;border-collapse:collapse;font-size:12px;">'); inTable = true; }
      const hdr = !tableHeader; if (hdr) tableHeader = true;
      const tag = hdr ? 'th' : 'td';
      const sty = hdr ? 'padding:7px 10px;border:1px solid #E8E5DF;background:#F4F2EE;font-weight:700;text-align:left;' : 'padding:7px 10px;border:1px solid #E8E5DF;text-align:left;';
      out.push('<tr>' + cells.map(c=>'<'+tag+' style="'+sty+'">' + inline(c) + '</'+tag+'>').join('') + '</tr>');
    }
    else { closeTable(); if (line.trim()) out.push('<p style="font-size:13px;line-height:1.7;margin:6px 0;">' + inline(line.trim()) + '</p>'); }
  }
  closeUl(); closeTable();
  return out.join('\n');
}

function buildOverview() {
  const groups = [
    { label:'Service',         items:[{id:'aps',icon:'💉',label:'Acute Pain Service'},{id:'nora',icon:'📡',label:'NORA'},{id:'pps',icon:'📋',label:'Pre-Procedure Services'}] },
    { label:'General OR',      items:[{id:'uch',icon:'🏛️',label:'UCH'},{id:'va',icon:'🎖️',label:'Rocky Mountain VA'},{id:'dh',icon:'🚑',label:'Denver Health'}] },
    { label:'Subspecialty OR', items:[{id:'ob',icon:'🤱',label:'OB Anesthesia'},{id:'txp',icon:'🫀',label:'Transplant'},{id:'ct',icon:'❤️',label:'Cardiothoracic'},{id:'neuro',icon:'🧠',label:'Neuroanesthesia'},{id:'chco',icon:'👶',label:"Children's (CHCO)"},{id:'cp',icon:'🩺',label:'Chronic Pain'}] },
    { label:'ICU',             items:[{id:'sticu',icon:'🩻',label:'STICU'},{id:'cticu',icon:'🏥',label:'CTICU'}] },
    { label:'CA-3',            items:[{id:'senior',icon:'⭐',label:'Senior Month'},{id:'pacu',icon:'🛏️',label:'PACU'},{id:'pocus',icon:'🔊',label:'POCUS'},{id:'inverness',icon:'🏔️',label:'Inverness'}] },
    { label:'Reference',       items:[{id:'ob-cookbook',icon:'📖',label:'OB Cookbook'},{id:'ct-att',icon:'👨‍⚕️',label:'CT Attending Prefs'},{id:'vpn',icon:'🔐',label:'VPN / Remote Access'},{id:'contacts',icon:'📞',label:'Contacts'},{id:'qgenda',icon:'📅',label:'QGenda Glossary'},{id:'interns',icon:'🌱',label:'Intern Info'},{id:'links',icon:'🔗',label:'Useful Links'}] },
  ];
  const rows = groups.map(g => {
    const btns = g.items.map(r =>
      '<button onclick="S.rotationSubsec=\'' + r.id + '\';draw()" style="padding:10px 14px;border-radius:8px;border:1.5px solid #E8E5DF;background:#fff;text-align:left;cursor:pointer;font-size:13px;font-weight:600;width:100%;">' + r.icon + ' ' + r.label + '</button>'
    ).join('');
    return '<div><div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;letter-spacing:.08em;margin:16px 0 6px;">' + g.label + '</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px;">' + btns + '</div></div>';
  }).join('');
  return '<div><h2 style="font-size:18px;font-weight:800;margin-bottom:4px;">Green Book</h2><p style="font-size:13px;color:#aaa;margin-bottom:16px;">Select a rotation guide from the list.</p>' + rows + '</div>';
}

// Convert all files
const contentMap = { overview: buildOverview() };
for (const [id, relPath] of Object.entries(FILE_MAP)) {
  const fullPath = path.join(GREENBOOK_DIR, relPath);
  try {
    contentMap[id] = mdToHtml(fs.readFileSync(fullPath, 'utf8'));
    console.log('✓ ' + id + ': ' + contentMap[id].length + ' chars');
  } catch(e) {
    console.warn('⚠  ' + id + ': ' + e.message);
    contentMap[id] = '<p style="color:#aaa;font-size:13px;">Content not available for ' + id + '.</p>';
  }
}

// Build the new function using JSON.stringify for safe embedding
const mapEntries = Object.entries(contentMap)
  .map(([k,v]) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(v))
  .join(',\n');

const newFn = '\nfunction getRotationContent(sec) {\n  var _map = {\n' + mapEntries + '\n  };\n  return _map[sec] || \'<p style="color:#aaa;font-size:13px;">Select a rotation from the menu.</p>\';\n}\n// ─── END ROTATION CONTENT ───\n';

// Read and inject
let html = fs.readFileSync(INDEX_PATH, 'utf8');

// Find start: try multiple patterns
let fnStart = html.indexOf('\nfunction getRotationContent(sec)');
if (fnStart === -1) fnStart = html.indexOf('function getRotationContent(sec)');
if (fnStart !== -1 && html[fnStart] === '\n') fnStart++; // skip leading newline

// Find end: try sentinel first, then fallback to pgResources
let fnEnd = html.indexOf('// ─── END ROTATION CONTENT ───');
if (fnEnd !== -1) {
  // Skip to end of sentinel line
  fnEnd = html.indexOf('\n', fnEnd) + 1;
}

if (fnStart === -1) {
  // getRotationContent doesn't exist yet — insert before pgResources
  fnStart = html.indexOf('\nfunction pgResources()');
  if (fnStart === -1) { console.error('ERROR: Cannot find pgResources() in index.html'); process.exit(1); }
  fnStart++; // skip leading newline
  fnEnd = fnStart; // insert at same position (no replacement)
  console.log('ℹ  getRotationContent not found — inserting fresh');
} else if (fnEnd === -1) {
  // Has function but no sentinel — find pgResources as fallback end
  fnEnd = html.indexOf('\nfunction pgResources()');
  if (fnEnd === -1) { console.error('ERROR: Cannot find end boundary'); process.exit(1); }
  fnEnd++;
  console.log('ℹ  No sentinel found — using pgResources() as end boundary');
}

html = html.slice(0, fnStart) + newFn + html.slice(fnEnd);
fs.writeFileSync(INDEX_PATH, html);
console.log('\n✅ Injected ' + Object.keys(contentMap).length + ' rotation guides (' + (html.length/1024).toFixed(0) + ' KB)');

if (html.indexOf('return getRotationContent(') !== -1) {
  console.error('ERROR: Recursive call found in output');
  process.exit(1);
}
console.log('✓ Recursion check passed');
