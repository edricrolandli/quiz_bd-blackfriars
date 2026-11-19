// Ilustrasi vektor buatan sendiri: latar adegan + potret siluet tokoh. Tanpa gambar eksternal.
const NIGHT = '#1f1d1a', WALL = '#2c2a26', DARK = '#3a3732', MID = '#4a463f', SEPIA = '#c9a86a',
  LAMP = '#f0b54a', LAMPSOFT = '#f7d58f', PAPER = '#efe3c8', BRASS = '#a8843f', FOG = '#b4b2a9';

const wrap = (inner) => `<svg viewBox="0 0 960 300" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;

const fog = (y, op) => `
  <ellipse cx="250" cy="${y}" rx="330" ry="26" fill="${FOG}" opacity="${op}"><animate attributeName="cx" values="210;300;210" dur="12s" repeatCount="indefinite"/></ellipse>
  <ellipse cx="740" cy="${y - 6}" rx="360" ry="30" fill="${FOG}" opacity="${op}"><animate attributeName="cx" values="780;680;780" dur="15s" repeatCount="indefinite"/></ellipse>`;

const gasLamp = (x, y, flicker = true) => `
  <rect x="${x - 3}" y="${y}" width="6" height="${300 - y}" fill="${NIGHT}"/>
  <rect x="${x - 13}" y="${y - 22}" width="26" height="22" rx="3" fill="${NIGHT}"/>
  <circle cx="${x}" cy="${y - 11}" r="30" fill="${LAMP}" opacity="0.18">${flicker ? '<animate attributeName="opacity" values="0.14;0.24;0.16;0.2;0.14" dur="3s" repeatCount="indefinite"/>' : ''}</circle>
  <rect x="${x - 8}" y="${y - 18}" width="16" height="13" fill="${LAMPSOFT}"/>`;

const gear = (cx, cy, r, dur, dir = 1) => `
  <g transform="translate(${cx} ${cy})"><g>
    <circle r="${r}" fill="none" stroke="${BRASS}" stroke-width="${Math.max(6, r / 3)}" stroke-dasharray="${(r * 0.35).toFixed(1)} ${(r * 0.35).toFixed(1)}"/>
    <circle r="${(r * 0.72).toFixed(1)}" fill="${MID}" stroke="${BRASS}" stroke-width="2"/>
    <circle r="${(r * 0.18).toFixed(1)}" fill="${BRASS}"/>
    <animateTransform attributeName="transform" type="rotate" from="0" to="${360 * dir}" dur="${dur}s" repeatCount="indefinite"/>
  </g></g>`;

const shelves = (x0, w) => {
  let s = '';
  const tones = ['#5b3a24', '#6e4a2c', '#4a3020', '#7a5634', '#5a4630', '#3f2c1d'];
  for (let row = 0; row < 4; row++) {
    const y = 60 + row * 58;
    s += `<rect x="${x0}" y="${y + 48}" width="${w}" height="6" fill="${DARK}"/>`;
    let x = x0 + 6, i = row * 3;
    while (x < x0 + w - 14) {
      const bw = 10 + ((i * 7) % 9), bh = 34 + ((i * 11) % 13);
      s += `<rect x="${x}" y="${y + 48 - bh}" width="${bw}" height="${bh}" fill="${tones[i % tones.length]}"/>`;
      x += bw + 2; i++;
    }
  }
  return s;
};

const flames = (cx, base) => `
  <path d="M${cx - 40} ${base} Q${cx - 30} ${base - 70} ${cx} ${base - 110} Q${cx + 26} ${base - 60} ${cx + 40} ${base} Z" fill="#e2611f" opacity="0.85"><animate attributeName="opacity" values="0.7;0.95;0.75;0.9;0.7" dur="1.2s" repeatCount="indefinite"/></path>
  <path d="M${cx - 22} ${base} Q${cx - 12} ${base - 50} ${cx + 4} ${base - 76} Q${cx + 16} ${base - 40} ${cx + 22} ${base} Z" fill="#f4b23a"><animate attributeName="d" values="M${cx - 22} ${base} Q${cx - 12} ${base - 50} ${cx + 4} ${base - 76} Q${cx + 16} ${base - 40} ${cx + 22} ${base} Z;M${cx - 22} ${base} Q${cx - 6} ${base - 56} ${cx - 2} ${base - 84} Q${cx + 20} ${base - 44} ${cx + 22} ${base} Z;M${cx - 22} ${base} Q${cx - 12} ${base - 50} ${cx + 4} ${base - 76} Q${cx + 16} ${base - 40} ${cx + 22} ${base} Z" dur="0.9s" repeatCount="indefinite"/></path>`;

export const BG = {
  jalan: wrap(`
    <rect width="960" height="300" fill="${NIGHT}"/>
    <circle cx="820" cy="60" r="26" fill="${PAPER}" opacity="0.8"/>
    <g fill="${DARK}">
      <rect x="0" y="110" width="110" height="190"/><rect x="95" y="60" width="60" height="240"/><polygon points="95,60 125,18 155,60"/>
      <rect x="170" y="130" width="140" height="170"/><rect x="320" y="90" width="90" height="210"/>
      <rect x="420" y="150" width="180" height="150"/><rect x="495" y="70" width="34" height="80"/>
      <rect x="610" y="120" width="120" height="180"/><rect x="740" y="80" width="80" height="220"/><rect x="830" y="140" width="130" height="160"/>
    </g>
    <circle cx="512" cy="92" r="13" fill="${PAPER}"/><line x1="512" y1="92" x2="512" y2="83" stroke="${DARK}" stroke-width="2"/><line x1="512" y1="92" x2="518" y2="95" stroke="${DARK}" stroke-width="2"/>
    <g fill="${LAMP}" opacity="0.9"><rect x="200" y="160" width="14" height="18"/><rect x="250" y="200" width="14" height="18"/><rect x="650" y="170" width="14" height="18"/><rect x="870" y="190" width="14" height="18"/><rect x="345" y="140" width="14" height="18"/></g>
    ${gasLamp(700, 170)}${fog(282, 0.32)}`),

  mesin: wrap(`
    <rect width="960" height="300" fill="${WALL}"/>
    <g stroke="${DARK}" stroke-width="2" opacity="0.6">${Array.from({ length: 10 }, (_, i) => `<line x1="0" y1="${30 * i}" x2="960" y2="${30 * i}"/>`).join('')}</g>
    <rect x="220" y="40" width="520" height="230" rx="6" fill="${DARK}" stroke="${BRASS}" stroke-width="3"/>
    ${gear(320, 120, 46, 14)}${gear(400, 175, 30, 9, -1)}${gear(560, 110, 38, 11, -1)}${gear(650, 175, 50, 16)}
    <g>${Array.from({ length: 7 }, (_, i) => `<rect x="${300 + i * 52}" y="222" width="40" height="30" fill="${PAPER}"/><circle cx="${310 + i * 52}" cy="232" r="2.5" fill="${DARK}"/><circle cx="${322 + i * 52}" cy="242" r="2.5" fill="${DARK}"/><circle cx="${330 + i * 52}" cy="232" r="2.5" fill="${DARK}"/>`).join('')}</g>
    <rect x="460" y="56" width="40" height="34" rx="4" fill="${NIGHT}" stroke="${BRASS}"/><rect x="466" y="62" width="28" height="22" fill="${LAMP}" opacity="0.5"><animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.4s" repeatCount="indefinite"/></rect>
    <rect x="40" y="200" width="150" height="100" fill="${MID}"/><rect x="60" y="186" width="70" height="14" fill="${PAPER}" opacity="0.8"/>
    <circle cx="150" cy="168" r="38" fill="${LAMP}" opacity="0.16"/><rect x="142" y="166" width="16" height="24" fill="${LAMPSOFT}"/>
    <rect x="780" y="70" width="120" height="150" rx="4" fill="${NIGHT}" stroke="${BRASS}"/><circle cx="840" cy="130" r="40" fill="${PAPER}" opacity="0.85"/>
    <line x1="840" y1="130" x2="840" y2="100" stroke="${NIGHT}" stroke-width="3"/><line x1="840" y1="130" x2="862" y2="130" stroke="${NIGHT}" stroke-width="3"/>`),

  akta: wrap(`
    <rect width="960" height="300" fill="${WALL}"/>
    ${shelves(30, 380)}${shelves(560, 380)}
    <rect x="430" y="40" width="110" height="150" fill="${NIGHT}" stroke="${DARK}" stroke-width="6"/>
    <line x1="485" y1="40" x2="485" y2="190" stroke="${DARK}" stroke-width="4"/><line x1="430" y1="115" x2="540" y2="115" stroke="${DARK}" stroke-width="4"/>
    <circle cx="510" cy="75" r="14" fill="${PAPER}" opacity="0.7"/>
    <rect x="0" y="282" width="960" height="18" fill="${DARK}"/>`),

  api: wrap(`
    <rect width="960" height="300" fill="#2a1a12"/>
    ${shelves(30, 380)}${shelves(560, 380)}
    <rect width="960" height="300" fill="#e2611f" opacity="0.18"><animate attributeName="opacity" values="0.12;0.26;0.15;0.22;0.12" dur="1.6s" repeatCount="indefinite"/></rect>
    ${flames(250, 285)}${flames(680, 290)}${flames(470, 292)}
    <ellipse cx="480" cy="40" rx="520" ry="60" fill="#0f0d0b" opacity="0.65"><animate attributeName="ry" values="55;75;55" dur="5s" repeatCount="indefinite"/></ellipse>`),

  lorong: wrap(`
    <rect width="960" height="300" fill="${NIGHT}"/>
    <polygon points="0,0 380,90 380,230 0,300" fill="${WALL}"/><polygon points="960,0 580,90 580,230 960,300" fill="${WALL}"/>
    <polygon points="380,230 580,230 960,300 0,300" fill="${DARK}"/><rect x="380" y="90" width="200" height="140" fill="#15130f"/>
    <polygon points="90,70 170,92 170,250 90,268" fill="${MID}"/><polygon points="870,70 790,92 790,250 870,268" fill="${MID}"/>
    <polygon points="250,108 300,120 300,236 250,245" fill="${MID}"/><polygon points="710,108 660,120 660,236 710,245" fill="${MID}"/>
    <rect x="455" y="150" width="50" height="80" fill="${DARK}"/><rect x="474" y="136" width="12" height="14" fill="${LAMPSOFT}" opacity="0.7"/>
    ${[[210, 120, 1], [750, 120, 1], [330, 135, 0.7], [630, 135, 0.7]].map(([x, y, s]) => `<circle cx="${x}" cy="${y}" r="${26 * s}" fill="${LAMP}" opacity="0.2"><animate attributeName="opacity" values="0.15;0.26;0.18;0.15" dur="${2 + s}s" repeatCount="indefinite"/></circle><rect x="${x - 5 * s}" y="${y - 7 * s}" width="${10 * s}" height="${14 * s}" fill="${LAMPSOFT}"/>`).join('')}
    ${fog(285, 0.18)}`),

  pagi: wrap(`
    <rect width="960" height="300" fill="#e9d9b6"/>
    <rect x="300" y="20" width="360" height="200" fill="#f6e7c4" stroke="#8a6a3e" stroke-width="8"/>
    <circle cx="480" cy="190" r="70" fill="#f4c46a" opacity="0.9"/>
    <line x1="480" y1="20" x2="480" y2="220" stroke="#8a6a3e" stroke-width="6"/><line x1="300" y1="120" x2="660" y2="120" stroke="#8a6a3e" stroke-width="6"/>
    <g fill="#cfa86a" opacity="0.55">${Array.from({ length: 6 }, (_, i) => `<polygon points="${480 - 40 + i * 16},220 ${330 + i * 60},300 ${360 + i * 60},300"/>`).join('')}</g>
    <rect x="0" y="236" width="960" height="64" fill="#8a6a3e"/>
    <rect x="560" y="214" width="150" height="26" fill="${PAPER}" stroke="#6a5030"/><line x1="575" y1="224" x2="690" y2="224" stroke="#6a5030" stroke-width="2"/><line x1="575" y1="232" x2="660" y2="232" stroke="#6a5030" stroke-width="2"/>
    <path d="M250 214 h44 v18 a22 10 0 0 1 -44 0 Z" fill="${PAPER}" stroke="#6a5030" stroke-width="2"/>
    <path d="M264 206 q4 -10 0 -18 M276 206 q4 -10 0 -18" stroke="#ffffff" stroke-width="2" fill="none" opacity="0.8"><animate attributeName="opacity" values="0.2;0.8;0.2" dur="3s" repeatCount="indefinite"/></path>`),
};

// ---------------------------------------------------------------------------------
// Potret siluet (gaya cameo era Victoria)
// ---------------------------------------------------------------------------------
let cameoId = 0;
const cameo = (inner, ring = '#854f0b') => { const id = 'cl' + (++cameoId); return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <ellipse cx="32" cy="32" rx="29" ry="31" fill="#faeeda" stroke="${ring}" stroke-width="2.5"/>
  <clipPath id="${id}"><ellipse cx="32" cy="32" rx="27" ry="29"/></clipPath><g clip-path="url(#${id})" fill="#412402">${inner}</g></svg>`; };

export const PORTRAIT = {
  whitlock: cameo(`<circle cx="32" cy="25" r="10"/><circle cx="32" cy="12" r="7"/><path d="M14 64 Q16 40 32 38 Q48 40 50 64 Z"/><rect x="27" y="33" width="10" height="8"/>`),
  silas: cameo(`<circle cx="32" cy="27" r="10"/><path d="M19 22 Q32 10 45 22 L48 24 L18 24 Z"/><path d="M12 64 Q14 42 32 40 Q50 42 52 64 Z"/>`),
  edmund: cameo(`<circle cx="32" cy="26" r="10"/><path d="M22 22 Q30 12 43 20 Q34 18 24 24 Z"/><path d="M13 64 Q15 42 32 40 Q49 42 51 64 Z"/><path d="M26 42 L32 45 L38 42 L38 48 L32 45 L26 48 Z" fill="#faeeda"/>`),
  nell: cameo(`<circle cx="32" cy="27" r="9"/><path d="M22 24 Q32 14 42 24 L42 40 Q40 44 38 40 L38 28 L26 28 L26 40 Q24 44 22 40 Z"/><path d="M15 64 Q17 44 32 42 Q47 44 49 64 Z"/>`),
  barnaby: cameo(`<circle cx="32" cy="25" r="10"/><path d="M23 29 Q32 46 41 29 Q38 38 32 39 Q26 38 23 29 Z"/><path d="M12 64 Q14 43 32 41 Q50 43 52 64 Z"/>`),
  vane: cameo(`<circle cx="32" cy="28" r="9"/><rect x="24" y="6" width="16" height="16"/><rect x="19" y="20" width="26" height="3"/><path d="M13 64 Q15 43 32 41 Q49 43 51 64 Z"/>`),
  mesin: cameo(`<g transform="translate(32 32)"><circle r="14" fill="none" stroke="#412402" stroke-width="7" stroke-dasharray="5 5"/><circle r="6"/></g>`, '#a8843f'),
  kamu: cameo(`<path d="M20 50 L44 18 L47 21 L23 53 Z"/><path d="M18 54 L22 50 L23 53 Z"/>`),
};
