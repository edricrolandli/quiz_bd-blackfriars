import { LocalApi, ProdApi, SessionError, ClosedError } from './api.js';
import { BG, PORTRAIT } from './art.js';
import { API_URL } from './config.js';

const params = new URLSearchParams(location.search);
const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);
// ?api=<url> hanya untuk uji di laptop (server tiruan tools/mock-server.mjs)
const API = (isLocalHost && params.get('api')) || API_URL;
const USE_LOCAL = params.has('dev') || !API || (isLocalHost && !params.has('prod') && !params.get('api'));
let api = USE_LOCAL ? new LocalApi({ contentUrl: '../content/dist/content.dev.json' }) : new ProdApi(API);
let ANTICHEAT = params.get('ac') !== '0';
let offset = 0;                                  // selisih jam server - jam PC
const nowMs = () => Date.now() + offset;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CHAPTER_ORDER = ['prolog', 'bab1', 'bab2', 'bab3', 'bab4', 'bab5', 'bab6', 'bonus'];
const CHAPTER_LABEL = { prolog: 'Prolog', bab1: 'Bab 1', bab2: 'Bab 2', bab3: 'Bab 3', bab4: 'Bab 4', bab5: 'Bab 5', bab6: 'Bab 6', bonus: 'Bonus' };

let C = null;          // konten
let S = null;          // state pemain (dari backend)
let playerName = null;
let deadline = 0;
let ended = false;
let locked = false;

// ---------------------------------------------------------------------------------
// Mesin (PGlite di Web Worker) dengan batas waktu
// ---------------------------------------------------------------------------------
class Machine {
  constructor() { this.seq = 0; this.pending = new Map(); this.w = null; }
  _spawn() {
    this.w = new Worker('js/db.worker.js', { type: 'module' });
    this.w.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      clearTimeout(p.timer);
      if (e.data.ok) p.res(e.data.result); else p.rej(new Error(e.data.error));
    };
    this.w.onerror = (e) => { for (const p of this.pending.values()) p.rej(new Error(e.message || 'worker error')); this.pending.clear(); };
  }
  call(type, payload, timeoutMs = 15000) {
    return new Promise((res, rej) => {
      const id = ++this.seq;
      const timer = timeoutMs ? setTimeout(() => {
        this.pending.delete(id);
        const err = new Error('TIMEOUT'); err.timeout = true; rej(err);
      }, timeoutMs) : null;
      this.pending.set(id, { res, rej, timer });
      this.w.postMessage({ id, type, payload });
    });
  }
  start(scripts) { this._spawn(); return this.call('init', { scripts }, 180000); }
  restart(scripts) {
    if (this.w) this.w.terminate();
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.rej(new Error('restart')); }
    this.pending.clear();
    return this.start(scripts);
  }
}
const machine = new Machine();

function sqlString(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function replayScripts() {
  const done = (S && S.done) || {};
  const out = [C.dataset];
  if (playerName) out.push(C.replay.prolog.replace('{NAMA_SQL}', sqlString(playerName)));
  if (done.bab5) out.push(C.replay.bab5);
  if (done.bab6) out.push(C.replay.bab6);
  if (done.bonus) out.push(C.chapters.bonus.solution);
  return out;
}

// ---------------------------------------------------------------------------------
// Utilitas tampilan
// ---------------------------------------------------------------------------------
function show(id) { for (const s of ['login', 'loading', 'ready', 'game']) $(s).classList.toggle('hidden', s !== id); }
function nameOf(s) { return String(s).replaceAll('{NAMA}', playerName || 'Operator'); }
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms);
}
function renderGrid(last, el, meta) {
  if (!last) { el.innerHTML = meta ? `<div class="result-meta">${esc(meta)}</div>` : ''; return; }
  const head = last.fields.map((f) => `<th>${esc(f.name)}</th>`).join('');
  const body = last.rows.map((r) => '<tr>' + r.map((v) => v === null ? '<td class="null">[null]</td>' : `<td>${esc(v)}</td>`).join('') + '</tr>').join('');
  const more = last.rowCount > last.rows.length ? ` · ditampilkan ${last.rows.length} baris pertama` : '';
  el.innerHTML = `<div class="result-meta">${esc(meta || '')}${last.rowCount} baris${more}</div><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
function feedback(kind, html) {
  const f = $('feedback');
  if (!kind) { f.classList.add('hidden'); return; }
  f.className = kind; f.innerHTML = html; f.classList.remove('hidden');
}
// konfirmasi di dalam halaman (confirm() bawaan memicu blur = pelanggaran palsu)
function ask(title, text, yes = 'Ya', no = 'Batal') {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="overlay-card"><h2>${esc(title)}</h2><p>${esc(text)}</p><div style="display:flex;gap:8px;justify-content:center"><button class="ghost" data-a="0">${esc(no)}</button><button class="primary" data-a="1">${esc(yes)}</button></div></div>`;
    ov.addEventListener('click', (e) => { const a = e.target.getAttribute('data-a'); if (a !== null) { ov.remove(); resolve(a === '1'); } });
    $('game').appendChild(ov);
  });
}

// ---------------------------------------------------------------------------------
// Bunyi (Web Audio, tanpa file)
// ---------------------------------------------------------------------------------
let audio = null;
function beep(freq, dur, when = 0, type = 'square', vol = 0.08) {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(audio.destination);
    const t = audio.currentTime + when; o.start(t); o.stop(t + dur);
  } catch (e) { /* tanpa suara */ }
}
function alarmSound(times = 6) { for (let i = 0; i < times; i++) { beep(880, 0.25, i * 0.5); beep(660, 0.25, i * 0.5 + 0.25); } }
function bell() { beep(523, 0.6, 0, 'sine', 0.1); beep(392, 0.9, 0.5, 'sine', 0.08); }

// ---------------------------------------------------------------------------------
// Panggung (visual novel)
// ---------------------------------------------------------------------------------
let currentBg = null;
function setBg(id) {
  if (!id || id === currentBg) return;
  const el = $('stage-bg');
  el.classList.add('fade');
  setTimeout(() => { el.innerHTML = BG[id] || ''; el.classList.remove('fade'); }, currentBg ? 350 : 0);
  currentBg = id;
}
function showStage() { $('work').classList.add('hidden'); $('stage').classList.remove('hidden'); }

let typing = null;
let nextResolve = null;
function typeLine(text) {
  const el = $('line');
  clearInterval(typing);
  el.textContent = '';
  let k = 0;
  return new Promise((resolve) => {
    typing = setInterval(() => {
      el.textContent = text.slice(0, ++k);
      if (k >= text.length) { clearInterval(typing); typing = null; resolve(); }
    }, 22);
    typeLine.finish = () => { clearInterval(typing); typing = null; el.textContent = text; resolve(); };
  });
}
function waitNext() { return new Promise((resolve) => { nextResolve = resolve; }); }
$('btn-next').addEventListener('click', () => {
  if (typing && typeLine.finish) { typeLine.finish(); return; }
  if (nextResolve) { const r = nextResolve; nextResolve = null; r(); }
});
$('btn-all').addEventListener('click', () => { if (typing && typeLine.finish) typeLine.finish(); });

async function sayLine(ln) {
  const who = ln.who || 'narasi';
  const ch = C.characters[who] || { name: '' };
  $('portrait').innerHTML = who !== 'narasi' && PORTRAIT[who] ? PORTRAIT[who] : '';
  $('speaker').textContent = nameOf(ch.name || '');
  $('line').style.fontStyle = who === 'narasi' ? 'italic' : 'normal';
  $('dialog').classList.remove('hidden');
  await typeLine(nameOf(ln.text));
  await waitNext();
}
async function playLines(lines, bg) {
  showStage(); setBg(bg || currentBg || 'mesin');
  $('stage-title').classList.add('hidden');
  for (const ln of lines) { if (ln.bg) setBg(ln.bg); await sayLine(ln); }
}
function showTitle(t1, t2, mode) {
  showStage();
  const el = $('stage-title');
  el.className = mode || '';
  el.querySelector('.t1').textContent = t1;
  el.querySelector('.t2').textContent = t2 || '';
  $('dialog').classList.add('hidden');
  return new Promise((resolve) => {
    const done = () => { el.removeEventListener('click', done); clearTimeout(h); el.classList.add('hidden'); resolve(); };
    const h = setTimeout(done, mode === 'alarm' ? 3200 : 2600);
    el.addEventListener('click', done);
  });
}

async function runMachineScene(id) {
  const m = C.machine[id];
  await playLines(m.before, 'mesin');
  const con = $('console');
  con.classList.remove('hidden');
  $('console-result').innerHTML = '';
  $('console-note').textContent = '';
  const pre = $('console-sql');
  pre.textContent = '';
  for (let k = 0; k <= m.sql.length; k += 3) { pre.textContent = m.sql.slice(0, k); await new Promise((r) => setTimeout(r, 8)); }
  pre.textContent = m.sql;
  try {
    const r = await machine.call('exec', { sql: m.sql, ordered: true });
    renderGrid(r.last, $('console-result'), '');
  } catch (e) { $('console-result').innerHTML = `<div class="sql-error">${esc(e.message)}</div>`; }
  $('console-note').textContent = m.note;
  await sayLine({ who: 'mesin', text: m.title + ': perintah selesai dijalankan.' });
  con.classList.add('hidden');
  await playLines(m.after);
}

// ---------------------------------------------------------------------------------
// Layar bab (soal)
// ---------------------------------------------------------------------------------
let chapterResolve = null;
let current = null;    // id bab aktif
let lastTx = { open: false };

async function buildArsip(ch) {
  let schema;
  try { schema = await machine.call('schema', {}); } catch (e) { schema = { tables: {} }; }
  const notes = C.tableNotes || {};
  const names = Object.keys(schema.tables).sort((a, b) => {
    const sa = ch.tables.includes(a) ? 0 : 1, sb = ch.tables.includes(b) ? 0 : 1;
    return sa - sb || a.localeCompare(b);
  });
  $('tables').innerHTML = names.map((t) => {
    const n = notes[t] || { cols: {} };
    const star = ch.tables.includes(t);
    const cols = schema.tables[t].map((c) => `<div class="col"><code>${esc(c.col)}</code> <span class="ty">${esc(c.type)}</span>${n.cols && n.cols[c.col] ? `<span class="arti">${esc(n.cols[c.col])}</span>` : ''}</div>`).join('');
    return `<div class="tbl"><button class="tbl-name${star ? ' starred' : ''}" data-t="${t}"><span>${t}</span>${star ? '<span class="star">★</span>' : ''}</button>
      <div class="tbl-body hidden" id="tb-${t}">${n.desc ? `<p class="desc">${esc(n.desc)}</p>` : ''}${cols}<button data-peek="${t}">Lihat isi</button></div></div>`;
  }).join('');
}
$('tables').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-t]');
  if (t) { $('tb-' + t.getAttribute('data-t')).classList.toggle('hidden'); return; }
  const p = e.target.closest('[data-peek]');
  if (p) {
    const name = p.getAttribute('data-peek');
    try {
      const r = await machine.call('peek', { table: name });
      feedback(null);
      renderGrid(r.last, $('result'), `Isi tabel ${name} (contoh, tidak dihitung sebagai percobaan) · `);
    } catch (err) { $('result').innerHTML = `<div class="sql-error">${esc(err.message)}</div>`; }
  }
});

function renderHints(id) {
  const level = (S.hints && S.hints[id]) || 0;
  const ch = C.chapters[id];
  const tx = (S.hintTexts && S.hintTexts[id]) || {};
  let html = '';
  if (level >= 1 && tx.hint1) html += `<div class="hint"><b>Hint 1.</b> ${esc(tx.hint1)}</div>`;
  if (level >= 2 && tx.hint2) html += `<div class="hint"><b>Hint 2.</b> ${esc(tx.hint2)}</div>`;
  if (level >= 3 && tx.solution) html += `<div class="hint"><b>Solusi.</b><pre class="solution">${esc(tx.solution)}</pre></div>`;
  $('hints').innerHTML = html;
  $('btn-h1').disabled = level >= 1 || !!S.done[id];
  $('btn-h2').disabled = level >= 2 || !!S.done[id];
  $('btn-sol').disabled = level >= 3 || !!S.done[id];
  if (ch.points === 0) { $('btn-h1').textContent = 'Hint 1'; $('btn-h2').textContent = 'Hint 2'; $('btn-sol').textContent = 'Tampilkan contoh'; }
  else { $('btn-h1').textContent = 'Hint 1 · maks 75%'; $('btn-h2').textContent = 'Hint 2 · maks 50%'; $('btn-sol').textContent = 'Tampilkan solusi · 0'; }
}

const draftKey = (id) => 'bf-draft-' + id;
function saveDraft() { try { if (current) localStorage.setItem(draftKey(current), $('editor').value); } catch (e) { /* abaikan */ } }

async function runChapter(id) {
  if (S.done[id]) return;
  const ch = C.chapters[id];
  current = id;
  $('stage').classList.add('hidden');
  $('work').classList.remove('hidden');
  $('bab-label').textContent = (CHAPTER_LABEL[id] + (ch.points ? ` · ${ch.points} poin` : ' · latihan, tidak dinilai')).toUpperCase();
  $('bab-title').textContent = ch.title;
  $('bab-intro').textContent = nameOf(ch.intro || '');
  $('bab-soal').textContent = ch.soal;
  $('bab-bentuk').textContent = ch.bentuk;
  $('bab-catatan').innerHTML = (ch.catatan || []).map((c) => `<li>${esc(c)}</li>`).join('');
  let draft = null;
  try { draft = localStorage.getItem(draftKey(id)); } catch (e) { /* abaikan */ }
  $('editor').value = draft ?? (ch.starter || (ch.kind === 'action' ? '-- tulis perintahmu di sini\n' : 'SELECT\n'));
  $('btn-check').classList.toggle('hidden', ch.kind !== 'action');
  $('result').innerHTML = '';
  feedback('info', ch.kind === 'action'
    ? 'Jalankan perintahmu, lalu tekan <b>Periksa</b> kalau sudah yakin.'
    : 'Setiap kali kamu menjalankan query, Mesin langsung mencocokkan hasilnya.');
  renderHints(id);
  updateProgress();
  await buildArsip(ch);
  $('editor').focus();
  return new Promise((resolve) => { chapterResolve = resolve; });
}

async function chapterSolved(id, score, state) {
  if (state) S = state;
  updateProgress();
  const ch = C.chapters[id];
  feedback('ok', ch.points
    ? `Benar! Bab ini selesai dengan nilai <b>${score}</b> dari ${ch.points}. <button id="btn-continue" class="primary" style="margin-left:8px">Lanjutkan cerita</button>`
    : `Berhasil. <button id="btn-continue" class="primary" style="margin-left:8px">Lanjutkan cerita</button>`);
  renderHints(id);
  bell();
  $('btn-continue').onclick = async () => {
    current = null;
    await playLines(ch.after);
    const r = chapterResolve; chapterResolve = null; if (r) r();
  };
}

async function execEditor() {
  const id = current;
  if (!id || ended || locked) return;
  const sql = $('editor').value.trim();
  if (!sql) return;
  saveDraft();
  const ch = C.chapters[id];
  $('btn-run').disabled = true;
  $('run-status').textContent = 'Mesin bekerja…';
  let r;
  try {
    r = await machine.call('exec', { sql, ordered: !!ch.ordered }, 12000);
  } catch (e) {
    $('btn-run').disabled = false;
    if (e.timeout) {
      $('run-status').textContent = '';
      feedback('bad', 'Mesin macet (query berjalan lebih dari 12 detik). Mesin dinyalakan ulang, dan data kembali ke awal bab ini.');
      api.log('TIMEOUT', sql, id);
      $('result').innerHTML = '';
      await machine.restart(replayScripts());
      return;
    }
    $('run-status').textContent = '';
    feedback('bad', esc(e.message));
    return;
  }
  $('btn-run').disabled = false;
  $('run-status').textContent = r.ok ? `selesai dalam ${r.ms} ms` : '';
  lastTx = r.tx || { open: false };
  if (!r.ok) {
    $('result').innerHTML = `<div class="sql-error">ERROR: ${esc(r.error)}</div>`;
    feedback(r.tx && r.tx.aborted ? 'bad' : null, r.tx && r.tx.aborted ? 'Transaksimu dibatalkan karena error. Jalankan <b>ROLLBACK</b> dulu sebelum mencoba lagi.' : '');
    api.log('QUERY ERROR', r.error + ' | ' + sql, id);
    return;
  }
  if (r.last) renderGrid(r.last, $('result'), '');
  else $('result').innerHTML = `<div class="result-meta">Perintah selesai${r.lastCommand && r.lastCommand.affectedRows !== null ? ` · ${r.lastCommand.affectedRows} baris terpengaruh` : ''}.</div>`;
  if (lastTx.open) feedback('info', 'Kamu sedang di dalam transaksi. Perubahan belum permanen sampai <b>COMMIT</b> (atau batalkan dengan <b>ROLLBACK</b>).');

  if (S.done[id]) return;
  if (ch.kind === 'action') api.log('QUERY', sql, id);   // bab aksi: setiap perintah tercatat (dikirim berkelompok)
  if (ch.kind === 'select') {
    const fp = r.fp ? { ...r.fp, unorderedHash: null } : null;
    if (fp && ch.ordered) {
      const u = await machine.call('exec', { sql, ordered: false }).catch(() => null);
      if (u && u.fp) fp.unorderedHash = u.fp.hash;
    }
    let res;
    try { res = await api.submitSelect(id, fp, sql); } catch (e) { return apiError(e); }
    if (res.correct) await chapterSolved(id, res.score, res.state);
    else feedback('bad', 'Belum cocok. ' + esc(res.feedback));
  } else if (ch.kind === 'name') {
    await checkSteps(id, sql);
  }
}

// Bab aksi dan prolog: Mesin menjalankan langkah pemeriksaan (uji yang mengubah data selalu dibatalkan),
// hasilnya dinilai oleh server (atau LocalApi saat tes lokal).
async function checkSteps(id, sql) {
  const ch = C.chapters[id];
  if (lastTx.open) { feedback('bad', 'Kamu masih di dalam transaksi. Jalankan <b>COMMIT</b> atau <b>ROLLBACK</b> dulu, baru tekan Periksa.'); return; }
  $('run-status').textContent = 'Mesin memeriksa…';
  let outputs;
  try { outputs = (await machine.call('check', { steps: ch.steps }, 30000)).steps; }
  catch (e) { $('run-status').textContent = ''; feedback('bad', 'Mesin error saat memeriksa: ' + esc(e.message)); return; }
  let typedName = null;
  if (ch.kind === 'name') {
    const r = await machine.call('exec', { sql: 'SELECT nama FROM pegawai WHERE id_pegawai = 1' }).catch(() => null);
    typedName = r && r.last && r.last.rows[0] ? String(r.last.rows[0][0]).trim().replace(/\s+/g, ' ') : null;
  }
  let res;
  try { res = await api.submitAction(id, outputs, sql, typedName); } catch (e) { $('run-status').textContent = ''; return apiError(e); }
  $('run-status').textContent = '';
  if (res.correct) {
    if (ch.kind === 'name') playerName = (res.state && res.state.name) || typedName;
    await chapterSolved(id, res.score, res.state);
  } else feedback('bad', 'Belum lolos. ' + esc(res.feedback));
}

// Kesalahan dari server
function apiError(e) {
  if (e instanceof SessionError) { sessionEnded(e.message); return; }
  if (e instanceof ClosedError) { endGame('Waktu habis', 'Waktu quiz sudah habis. Jawaban yang sudah benar tetap tersimpan.'); return; }
  feedback('bad', esc(e.message));
}
function sessionEnded(msg) {
  ended = true; disarm();
  $('end-title').textContent = 'Sesi berakhir';
  $('end-text').textContent = msg;
  $('overlay-end').classList.remove('hidden');
}

$('btn-run').addEventListener('click', execEditor);
$('btn-check').addEventListener('click', () => { if (current && !S.done[current]) checkSteps(current, $('editor').value); });
$('btn-reset').addEventListener('click', async () => {
  if (!(await ask('Reset data?', 'Database dikembalikan ke awal bab ini. Perubahan yang kamu buat di bab ini hilang, tapi isi editor tetap.'))) return;
  $('run-status').textContent = 'Mengembalikan data…';
  await machine.restart(replayScripts());
  lastTx = { open: false };
  $('run-status').textContent = 'Data dikembalikan ke awal bab.';
  api.log('RESET', '', current);
  if (current) buildArsip(C.chapters[current]);
});
async function useHint(level) {
  const id = current; const ch = C.chapters[id];
  if (ch.points && !api.isSantai && !(await ask(`Pakai Hint ${level}?`, `Nilai maksimal bab ini jadi ${level === 1 ? '75' : '50'}% (${ch.points * (level === 1 ? 0.75 : 0.5)} poin).`))) return;
  try { const r = await api.hint(id, level); S = r.state; renderHints(id); } catch (e) { apiError(e); }
}
$('btn-h1').addEventListener('click', () => useHint(1));
$('btn-h2').addEventListener('click', () => useHint(2));
$('btn-sol').addEventListener('click', async () => {
  const id = current; const ch = C.chapters[id];
  if (ch.points && !api.isSantai && !(await ask('Tampilkan solusi?', 'Nilai bab ini jadi 0. Mesin menjalankan solusinya supaya cerita bisa lanjut.', 'Tampilkan solusi'))) return;
  let sol;
  try { const r = await api.solution(id); S = r.state; sol = r.text; renderHints(id); } catch (e) { return apiError(e); }
  if (id === 'prolog') return; // nama harus diketik sendiri
  $('editor').value = sol; saveDraft();
  if (ch.kind === 'select') await execEditor();
  else {
    if (lastTx.open) await machine.call('exec', { sql: 'ROLLBACK' }).catch(() => null);
    lastTx = { open: false };
    if (id === 'bab6') await machine.restart(replayScripts());   // hapus sisa percobaan (misalnya role yang sudah dibuat)
    const r = await machine.call('exec', { sql: sol }).catch((e) => ({ ok: false, error: e.message }));
    if (r.last) renderGrid(r.last, $('result'), '');
    await checkSteps(id, sol);
  }
});

// Editor: Ctrl+Enter, Tab, blokir paste
const editor = $('editor');
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); execEditor(); return; }
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = editor.selectionStart, en = editor.selectionEnd;
    editor.value = editor.value.slice(0, s) + '    ' + editor.value.slice(en);
    editor.selectionStart = editor.selectionEnd = s + 4;
  }
});
editor.addEventListener('input', () => { clearTimeout(editor.h); editor.h = setTimeout(saveDraft, 600); });
for (const ev of ['paste', 'drop']) {
  editor.addEventListener(ev, (e) => { e.preventDefault(); toast('Paste dimatikan. Ketik query-mu sendiri.'); api.log('PASTE', '', current || ''); });
}
document.addEventListener('contextmenu', (e) => { if (!$('game').classList.contains('hidden')) e.preventDefault(); });

// ---------------------------------------------------------------------------------
// Progres, nilai, timer
// ---------------------------------------------------------------------------------
function totalScore() { return Math.min(100, Object.values(S.done || {}).reduce((a, d) => a + d.score, 0)); }
function updateProgress() {
  $('progress').innerHTML = CHAPTER_ORDER.map((id) => {
    const d = S.done[id];
    const cls = d ? (d.score === 0 && C.chapters[id].points ? 'dot zero' : 'dot done') : id === current ? 'dot now' : 'dot';
    return `<span class="${cls}">${CHAPTER_LABEL[id]}</span>`;
  }).join('');
  $('stat-score').textContent = String(Math.round(totalScore() * 100) / 100);
  $('stat-viol').textContent = `${S.violations || 0}/3`;
}
function tick() {
  if (ended || !deadline) return;
  const left = Math.max(0, deadline - nowMs());
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  $('stat-timer').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  $('stat-timer').classList.toggle('low', left < 10 * 60000);
  if (left <= 0) endGame('Waktu habis', 'Jawabanmu sudah tersimpan. Setelah semua lab selesai, game dibuka lagi dalam mode santai tanpa nilai.');
}
function endGame(title, text) {
  if (ended) return;
  ended = true;
  disarm();
  $('end-title').textContent = title;
  $('end-text').innerHTML = `${esc(text)}<br><br>` + (api.isSantai
    ? 'Mode santai: tidak dinilai.'
    : `Nilai akhir: <b>${Math.round(totalScore() * 100) / 100}</b> / 100`);
  $('overlay-end').classList.remove('hidden');
  api.finish(title);
}

// ---------------------------------------------------------------------------------
// Anti-cheat: layar penuh, pindah tab/jendela, kunci
// ---------------------------------------------------------------------------------
let armed = false, lastViol = 0;
function isFull() { return !!document.fullscreenElement; }
async function goFull() { try { await document.documentElement.requestFullscreen(); } catch (e) { /* ditolak browser */ } }
async function violation(kind) {
  if (!armed || ended || locked) return;
  const now = Date.now();
  if (now - lastViol < 2500) return;
  lastViol = now;
  let r;
  try { r = await api.violation(kind, current); } catch (e) { return apiError(e); }
  S.violations = r.violations; S.locked = r.locked; updateProgress();
  if (r.locked) lockGame();
  else { $('fs-text').textContent = `Pelanggaran ${r.violations} dari 3 (${kind}). Pelanggaran ketiga mengunci game.`; $('overlay-fs').classList.remove('hidden'); beep(440, 0.3); }
}
function onFsChange() { if (!isFull()) violation('keluar layar penuh'); }
function onVis() { if (document.hidden) violation('pindah tab'); }
function onBlur() { violation('pindah jendela'); }
function arm() {
  if (!ANTICHEAT || armed) return;
  armed = true;
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('blur', onBlur);
}
function disarm() {
  armed = false;
  document.removeEventListener('fullscreenchange', onFsChange);
  document.removeEventListener('visibilitychange', onVis);
  window.removeEventListener('blur', onBlur);
}
$('btn-fs').addEventListener('click', async () => { await goFull(); $('overlay-fs').classList.add('hidden'); });

let lockPoll = null;
function lockGame() {
  locked = true;
  $('overlay-fs').classList.add('hidden');
  $('overlay-lock').classList.remove('hidden');
  if (api.isLocal) $('dev-unlock').classList.remove('hidden');
  alarmSound();
  clearInterval(lockPoll);
  lockPoll = setInterval(async () => {
    try {
      const st = await api.lockStatus();
      $('lock-status').textContent = 'Menunggu asisten… (dicek setiap 5 detik)';
      if (!st.locked) unlockGame(st);
    } catch (e) { if (e instanceof SessionError || e instanceof ClosedError) { clearInterval(lockPoll); apiError(e); } }
  }, 5000);
}
function unlockGame(st) {
  clearInterval(lockPoll);
  locked = false;
  $('overlay-lock').classList.add('hidden');
  $('fs-text').textContent = 'Kunci sudah dibuka asisten. Kembali ke layar penuh untuk melanjutkan.';
  $('overlay-fs').classList.remove('hidden');
  if (st) { S.locked = false; S.violations = st.violations; updateProgress(); }
}
$('btn-dev-unlock').addEventListener('click', async () => { await api.devUnlock(); unlockGame({ violations: 0 }); });

// ---------------------------------------------------------------------------------
// Alur utama
// ---------------------------------------------------------------------------------
async function runFlow() {
  for (let i = S.flow || 0; i < C.flow.length && !ended; i++) {
    const it = C.flow[i];
    if (it.kind === 'title') await showTitle(it.text, it.sub, '');
    else if (it.kind === 'scene') await playLines(it.lines, it.bg);
    else if (it.kind === 'alarm') { setBg('api'); alarmSound(3); await showTitle(it.text, '', 'alarm'); }
    else if (it.kind === 'loop') { bell(); await showTitle(it.text, 'Hari ini terulang.', 'loop'); }
    else if (it.kind === 'machine') await runMachineScene(it.id);
    else if (it.kind === 'chapter') await runChapter(it.id);
    else if (it.kind === 'bonusGate') {
      await playLines([{ who: 'barnaby', text: 'Dulu, si pembakar masih punya satu kartu cadangan. Mau mengunci pintu terakhir, Nak?' }], 'mesin');
      const yes = await ask('Bonus (+5)', 'Kerjakan bonus "Kebenaran yang Tidak Bisa Dihapus" sebelum ending? Kalau dilewati, ending tetap utuh.', 'Kerjakan bonus', 'Lewati ke ending');
      if (yes) await runChapter('bonus');
    } else if (it.kind === 'ending') {
      for (const ln of C.ending) { if (ln.ifBonus && !S.done.bonus) continue; await playLines([ln], ln.bg); }
      endGame('Kebenaran selamat', `Sabtu, 31 Oktober 1891. Terima kasih sudah bermain, ${playerName || 'Operator'}.`);
    }
    S.flow = i + 1;
    api.setFlow(i + 1).catch((e) => { if (e instanceof SessionError) apiError(e); });
  }
}

// Mulai mengunduh mesin (16 MB) sejak halaman login dibuka, supaya saat login tinggal pakai cache.
// Diunduh berurutan supaya tidak membanjiri jaringan lab saat 20+ PC membuka halaman bersamaan.
async function preloadEngine() {
  for (const f of ['index.js', 'pglite.wasm', 'pglite.data', 'initdb.wasm']) {
    try { await fetch('vendor/pglite/' + f); } catch (e) { /* nanti dicoba lagi saat Mesin dinyalakan */ }
  }
}

// Menyalakan Mesin, dengan coba ulang kalau ada file yang gagal terunduh
async function startMachine() {
  for (let i = 1; i <= 3; i++) {
    try { return await machine.restart(replayScripts()); }
    catch (e) {
      if (i === 3) throw new Error('Mesin gagal dinyalakan. Cek koneksi internet lalu muat ulang halaman. (' + e.message + ')');
      $('loading-text').textContent = `Sebagian berkas Mesin gagal terunduh, mencoba lagi (${i + 1}/3)…`;
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

let startAt = 0;        // jam mulai lab (jam server)
function waitCountdown() {
  const btn = $('btn-start');
  const left = startAt - nowMs();
  if (left <= 0) {
    btn.disabled = false;
    $('ready-text').textContent = 'Quiz sudah dimulai. Tekan Mulai untuk masuk ke layar penuh.';
    return;
  }
  btn.disabled = true;
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  $('ready-text').textContent = `Mesin siap. Quiz dimulai dalam ${m}:${String(s).padStart(2, '0')}. Tombol Mulai aktif begitu waktunya tiba.`;
  setTimeout(waitCountdown, 1000);
}

async function boot() {
  $('login-crest').innerHTML = PORTRAIT.mesin;
  preloadEngine();
  if (USE_LOCAL && isLocalHost) $('login-err').textContent = 'Mode lokal (tes). Kode akses boleh kosong.';
  $('btn-login').addEventListener('click', async () => {
    $('login-err').textContent = '';
    $('btn-login').disabled = true;
    try {
      const nim = $('in-nim').value.trim();
      let res = await api.login(nim, $('in-code').value.trim());
      if (res.mode === 'santai' && !api.isLocal) {
        // setelah semua lab selesai: main di browser saja, tidak dinilai
        api = new LocalApi({ content: res.content, key: 'bf-santai-' + res.nim, santai: true });
        res = await api.login(res.nim);
      }
      if (api.isSantai) ANTICHEAT = false;
      offset = res.offset || 0;
      C = res.content;
      S = res.state;
      deadline = res.window.end || 0;
      startAt = res.mode === 'wait' ? res.window.start : 0;
      playerName = S.name || null;
      if (api instanceof ProdApi) api.onNetwork = (okNet) => $('stat-timer').title = okNet ? 'Sisa waktu' : 'Koneksi ke server terputus, mencoba lagi…';
      show('loading');
      $('loading-text').textContent = 'Menyalakan Mesin Analitik… (sekitar 5–15 detik)';
      const t0 = performance.now();
      await startMachine();
      const secs = Math.round((performance.now() - t0) / 100) / 10;
      show('ready');
      if (api.isSantai) $('ready-text').textContent = `Mode santai (tidak dinilai). Mesin siap dalam ${secs} detik.`;
      else if (startAt) waitCountdown();
      else $('ready-text').textContent = `Mesin siap dalam ${secs} detik. Tekan Mulai untuk masuk ke layar penuh.`;
    } catch (e) {
      show('login');
      $('login-err').textContent = e.message;
    } finally {
      $('btn-login').disabled = false;
    }
  });
  $('btn-start').addEventListener('click', async () => {
    if (ANTICHEAT) await goFull();
    show('game');
    arm();
    updateProgress();
    if (deadline) { tick(); setInterval(tick, 1000); } else $('stat-timer').classList.add('hidden');
    if (api.isSantai) $('stat-viol').classList.add('hidden');
    if (S.locked) lockGame();
    api.log('MULAI', 'flow ' + (S.flow || 0));
    await runFlow();
  });
}
boot();
