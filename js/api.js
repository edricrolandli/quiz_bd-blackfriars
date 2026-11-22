// Lapisan backend.
// LocalApi : semua di browser (tes lokal dan mode santai). Butuh konten lengkap.
// ProdApi  : Apps Script (saat quiz dinilai). Konten dari server tanpa kunci.
import { evaluateSteps } from './check.js';

const MULT = [1, 0.75, 0.5];

function hintTexts(content, hints) {
  const t = {};
  for (const id of Object.keys(hints || {})) {
    const ch = content.chapters[id], lv = hints[id];
    if (ch) t[id] = { hint1: lv >= 1 ? ch.hint1 : null, hint2: lv >= 2 ? ch.hint2 : null, solution: lv >= 3 ? ch.solution : null };
  }
  return t;
}

function selectFeedback(ch, fp) {
  const exp = ch.expect;
  const accepted = [exp, ...(exp.alt || [])];   // alt = bentuk lain yang juga benar
  if (fp && accepted.some((e) => fp.hash === e.hash)) return { correct: true };
  let fb;
  if (!fp) fb = 'Query-mu belum menghasilkan tabel.';
  else if (fp.cols !== exp.cols) fb = `Hasilmu ${fp.cols} kolom, Mesin mengharapkan ${exp.cols} kolom.`;
  else if (fp.rows !== exp.rows) fb = `Hasilmu ${fp.rows} baris, Mesin mengharapkan ${fp.rows < exp.rows ? 'lebih banyak' : 'lebih sedikit'}.`;
  else if (ch.ordered && accepted.some((e) => fp.unorderedHash === e.hashUnordered)) fb = 'Isinya sudah benar, tinggal urutan barisnya.';
  else fb = 'Jumlah baris dan kolom sudah pas, tapi isinya belum cocok. Cek nilai dan format tiap kolom.';
  return { correct: false, feedback: fb };
}

// ---------------------------------------------------------------------------------
export class LocalApi {
  constructor({ content = null, contentUrl = null, key = 'bf-dev-state', santai = false } = {}) {
    this.content = content; this.contentUrl = contentUrl; this.key = key;
    this.isLocal = true; this.isSantai = santai;
  }
  _load() { try { return JSON.parse(localStorage.getItem(this.key)) || null; } catch (e) { return null; } }
  _save(s) { try { localStorage.setItem(this.key, JSON.stringify(s)); } catch (e) { /* abaikan */ } }
  _pub(s) { return { flow: s.flow, name: s.name, done: s.done, hints: s.hints, hintTexts: hintTexts(this.content, s.hints), violations: s.violations, locked: s.locked, finished: s.finished }; }

  async login(nim) {
    if (!nim) throw new Error('Isi NIM dulu.');
    if (!this.content) {
      const r = await fetch(this.contentUrl, { cache: 'no-store' });
      if (!r.ok) throw new Error('Konten lokal tidak ditemukan. Jalankan node tools/build-content.mjs');
      this.content = await r.json();
    }
    let s = this._load();
    if (!s || s.nim !== nim) {
      const now = Date.now();
      s = { nim, name: null, start: now, end: now + 100 * 60000, flow: 0, done: {}, hints: {}, violations: 0, locked: false, finished: false, log: [] };
      this._save(s);
    }
    return {
      nim, name: null, lab: this.isSantai ? 'SANTAI' : 'DEV', mode: this.isSantai ? 'santai' : 'live', offset: 0,
      window: { start: s.start, end: this.isSantai ? null : s.end }, state: this._pub(s), content: this.content,
    };
  }
  async state() { return this._pub(this._load()); }
  async setFlow(i) { const s = this._load(); if (i > s.flow) s.flow = i; this._save(s); }
  async log(type, detail, chapter) {
    const s = this._load(); if (!s) return;
    s.log.push({ t: Date.now(), chapter: chapter || '', type, detail: String(detail || '').slice(0, 1500) });
    if (s.log.length > 400) s.log.shift();
    this._save(s);
  }
  async hint(id, level) {
    const s = this._load(); s.hints[id] = Math.max(s.hints[id] || 0, level); this._save(s);
    await this.log('HINT ' + level, '', id);
    return { text: this.content.chapters[id]['hint' + level], state: this._pub(s) };
  }
  async solution(id) {
    const s = this._load(); s.hints[id] = 3; this._save(s);
    await this.log('SOLUSI', '', id);
    return { text: this.content.chapters[id].solution, state: this._pub(s) };
  }
  async submitSelect(id, fp, sql) {
    const r = selectFeedback(this.content.chapters[id], fp);
    await this.log(r.correct ? 'QUERY BENAR' : 'QUERY SALAH', sql, id);
    return r.correct ? this._finish(id) : r;
  }
  async submitAction(id, outputs, sql, name) {
    const ch = this.content.chapters[id];
    const r = evaluateSteps(ch.steps, outputs);
    await this.log(r.pass ? 'AKSI BENAR' : 'AKSI SALAH', (r.fail || '') + ' | ' + (sql || ''), id);
    if (!r.pass) return { correct: false, feedback: r.fail };
    if (ch.kind === 'name') { const s = this._load(); s.name = name; this._save(s); }
    return this._finish(id);
  }
  _finish(id) {
    const s = this._load();
    const h = s.hints[id] || 0;
    if (!s.done[id]) s.done[id] = { score: h >= 3 ? 0 : Math.round(this.content.chapters[id].points * MULT[h] * 100) / 100, hints: h, at: Date.now() };
    this._save(s);
    return { correct: true, score: s.done[id].score, state: this._pub(s) };
  }
  async violation(kind, chapter) {
    const s = this._load();
    s.violations += 1;
    if (s.violations >= 3) s.locked = true;
    this._save(s);
    await this.log(s.locked ? 'TERKUNCI' : 'PELANGGARAN', kind + ' (#' + s.violations + ')', chapter);
    return { violations: s.violations, locked: s.locked };
  }
  async lockStatus() { const s = this._load(); return { locked: s.locked, violations: s.violations }; }
  async finish(reason) { const s = this._load(); s.finished = true; this._save(s); await this.log('SELESAI', reason); }
  async devUnlock() { const s = this._load(); s.locked = false; s.violations = 0; this._save(s); await this.log('DIBUKA', 'dev'); }
}

// ---------------------------------------------------------------------------------
export class SessionError extends Error {}
export class ClosedError extends Error {}

export class ProdApi {
  constructor(url) {
    this.url = url; this.isLocal = false; this.isSantai = false;
    this.nim = null; this.token = null; this.content = null;
    this.chain = Promise.resolve();       // permintaan dikirim satu per satu
    this.events = [];
    this.onNetwork = () => {};            // dipanggil dengan true/false saat koneksi putus/pulih
    setInterval(() => this._flush(), 10000);
  }

  async _post(body, tries = 4) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(this.url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        const j = await r.json();
        this.onNetwork(true);
        return j;
      } catch (e) {
        lastErr = e;
        this.onNetwork(false);
        await new Promise((res) => setTimeout(res, 1000 * Math.pow(2, i)));
      }
    }
    throw new Error('Koneksi ke server terputus. Coba lagi sebentar lagi. (' + (lastErr && lastErr.message) + ')');
  }

  _call(action, extra = {}) {
    const run = async () => {
      const j = await this._post({ action, nim: this.nim, token: this.token, ...extra });
      if (j.serverNow) this.offset = j.serverNow - Date.now();
      if (j.code === 'session') throw new SessionError(j.error);
      if (j.code === 'closed' && action !== 'login') throw new ClosedError(j.error);
      if (j.ok === false) throw new Error(j.error || 'Server menolak permintaan.');
      return j;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  async _flush() {
    if (!this.token || !this.events.length) return;
    const events = this.events.splice(0, 100);
    try { await this._call('logs', { events }); } catch (e) { if (!(e instanceof SessionError)) this.events.unshift(...events); }
  }

  async login(nim, code) {
    this.nim = String(nim || '').trim();
    const j = await this._call('login', { code });
    this.token = j.token; this.nim = j.nim; this.content = j.content;
    this.isSantai = j.mode === 'santai';
    return { nim: j.nim, name: j.name, lab: j.lab, mode: j.mode, offset: j.serverNow - Date.now(), window: j.window, state: j.state, content: j.content };
  }
  async state() { return (await this._call('state')).state; }
  async mode() { const j = await this._call('state'); return j.mode; }
  async setFlow(flow) { await this._call('flow', { flow }); }
  async log(type, detail, chapter) {
    this.events.push({ t: Date.now() + (this.offset || 0), chapter: chapter || '', type, detail: String(detail || '').slice(0, 1500) });
    if (this.events.length >= 25) this._flush();
  }
  async hint(id, level) { const j = await this._call('hint', { id, level }); return { text: j.text, state: j.state }; }
  async solution(id) { const j = await this._call('solution', { id }); return { text: j.text, state: j.state }; }
  async submitSelect(id, fp, sql) { await this._flush(); return this._call('select', { id, fp, sql }); }
  async submitAction(id, outputs, sql, name) { await this._flush(); return this._call('action', { id, outputs, sql, name }); }
  async violation(kind, chapter) { const j = await this._call('violation', { kind, chapter }); return { violations: j.violations, locked: j.locked }; }
  async lockStatus() { const j = await this._call('lock'); return { locked: j.locked, violations: j.violations }; }
  async finish(reason) { await this._flush(); try { await this._call('finish', { reason }); } catch (e) { /* abaikan */ } }
}
