// pendigits-orig（UNIPEN）を読む → [{label, writer, strokes:[[x,y],...][]}]
const fs = require('fs');
function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = []; let cur = null, stroke = null, writer = -1;
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith('.SEGMENT')) {
      const m = l.match(/"(\d)"/); cur = { label: +m[1], writer, strokes: [] }; out.push(cur); stroke = null;
    } else if (l.startsWith('.COMMENT')) { if (cur) cur.writer = +l.split(/\s+/)[1]; }
    else if (l.startsWith('.PEN_DOWN')) { stroke = []; cur.strokes.push(stroke); }
    else if (l.startsWith('.PEN_UP')) { stroke = null; }
    else if (stroke && /^-?\d+\s+-?\d+$/.test(l)) { const [x, y] = l.split(/\s+/).map(Number); stroke.push([x, y]); }
  }
  return out.filter(s => s.strokes.some(st => st.length));
}
module.exports = parse;
if (require.main === module) {
  const d = parse(process.argv[2]);
  console.log(d.length, 'samples; writers', new Set(d.map(s => s.writer)).size);
  const cnt = {}; d.forEach(s => cnt[s.label] = (cnt[s.label] || 0) + 1); console.log(cnt);
  console.log('strokes/sample', (d.reduce((a, s) => a + s.strokes.length, 0) / d.length).toFixed(2));
  // ASCII で何個か描いて向きを確認
  for (const s of d.slice(0, 3)) {
    const pts = s.strokes.flat(); const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
    const G = Array.from({ length: 12 }, () => Array(12).fill(' '));
    for (const [x, y] of pts) G[Math.floor((y - y0) / h * 12)][Math.floor((x - x0) / w * 12)] = '#';
    console.log('label', s.label, 'writer', s.writer); console.log(G.map(r => r.join('')).join('\n'));
  }
}
