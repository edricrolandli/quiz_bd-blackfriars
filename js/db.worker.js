// Mesin Analitik: PostgreSQL (PGlite) yang berjalan di Web Worker.
// Kalau query terlalu lama, halaman utama mematikan worker ini lalu membuat ulang.
import { PGlite } from '../vendor/pglite/index.js';
import { rawParsers, cellText, fingerprint } from './check.js';

let db = null;
const MAX_ROWS_SHOWN = 300;

function shape(res) {
  const fields = (res.fields || []).map((f) => ({ name: f.name, type: f.dataTypeID }));
  const rows = (res.rows || []).slice(0, MAX_ROWS_SHOWN)
    .map((r) => r.map((v, i) => cellText(v, fields[i] && fields[i].type)));
  return { fields, rows, rowCount: (res.rows || []).length, affectedRows: res.affectedRows ?? null };
}

async function inTransaction() {
  const open = typeof db.isInTransaction === 'function' ? db.isInTransaction() : false;
  if (!open) return { open: false, aborted: false };
  try {
    await db.query('SELECT 1');
    return { open: true, aborted: false };
  } catch (e) {
    return { open: true, aborted: true };
  }
}

async function runScripts(scripts) {
  for (const s of scripts) await db.exec(s);
}

const handlers = {
  async init({ scripts }) {
    const t0 = performance.now();
    db = await PGlite.create({ parsers: rawParsers() });
    await runScripts(scripts);
    return { ms: Math.round(performance.now() - t0) };
  },

  async reset({ scripts }) {
    const t0 = performance.now();
    try { await db.exec('ROLLBACK'); } catch (e) { /* tidak ada transaksi */ }
    try { await db.exec('RESET ROLE'); } catch (e) { /* abaikan */ }
    await runScripts(scripts);
    return { ms: Math.round(performance.now() - t0) };
  },

  async exec({ sql, ordered }) {
    const t0 = performance.now();
    let results;
    try {
      results = await db.exec(sql, { rowMode: 'array' });
    } catch (e) {
      const tx = await inTransaction();
      return { ok: false, error: e.message, position: e.position || null, ms: Math.round(performance.now() - t0), tx };
    }
    const ms = Math.round(performance.now() - t0);
    const withFields = results.filter((r) => r.fields && r.fields.length);
    const last = withFields.length ? withFields[withFields.length - 1] : null;
    const fp = last ? await fingerprint(last, ordered) : null;
    const tx = await inTransaction();
    return {
      ok: true, ms, tx,
      statements: results.length,
      last: last ? shape(last) : null,
      lastCommand: results.length ? { affectedRows: results[results.length - 1].affectedRows ?? null } : null,
      fp,
    };
  },

  // Rangkaian langkah pengecekan untuk bab aksi. Setiap langkah: { sql, expectError, capture }
  async check({ steps }) {
    const out = [];
    try { await db.exec('RESET ROLE'); } catch (e) { /* abaikan */ }
    for (const st of steps) {
      if (st.rollback) {
        // langkah uji yang mengubah data: jalankan di transaksi lalu selalu dibatalkan
        try {
          await db.exec('BEGIN');
          const r = await db.exec(st.sql, { rowMode: 'array' });
          const withFields = r.filter((x) => x.fields && x.fields.length);
          const last = withFields.length ? withFields[withFields.length - 1] : null;
          out.push({ ok: true, rows: last ? shape(last).rows : [] });
        } catch (e) {
          out.push({ ok: false, error: e.message });
        }
        try { await db.exec('ROLLBACK'); } catch (e) { /* abaikan */ }
        try { await db.exec('RESET ROLE'); } catch (e) { /* abaikan */ }
        continue;
      }
      try {
        const r = await db.exec(st.sql, { rowMode: 'array' });
        const withFields = r.filter((x) => x.fields && x.fields.length);
        const last = withFields.length ? withFields[withFields.length - 1] : null;
        out.push({ ok: true, rows: last ? shape(last).rows : [], fp: last ? await fingerprint(last, true) : null });
      } catch (e) {
        out.push({ ok: false, error: e.message });
        try { await db.exec('RESET ROLE'); } catch (e2) { /* abaikan */ }
      }
    }
    try { await db.exec('RESET ROLE'); } catch (e) { /* abaikan */ }
    return { steps: out };
  },

  async schema() {
    const r = await db.query(
      `SELECT c.table_name, c.column_name, c.data_type
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name, c.ordinal_position`, [], { rowMode: 'array' });
    const tables = {};
    for (const [t, col, type] of r.rows) (tables[t] = tables[t] || []).push({ col, type });
    return { tables };
  },

  async peek({ table }) {
    if (!/^[a-z_]+$/.test(table)) throw new Error('nama tabel tidak valid');
    const r = await db.query(`SELECT * FROM ${table} LIMIT 20`, [], { rowMode: 'array' });
    return { last: shape(r) };
  },
};

// Pesan diproses satu per satu supaya tidak ada query yang jalan sebelum init selesai
let queue = Promise.resolve();
self.onmessage = (ev) => {
  const { id, type, payload } = ev.data;
  queue = queue.then(async () => {
    try {
      if (!db && type !== 'init') throw new Error('Mesin belum siap. Tunggu sebentar lalu coba lagi.');
      const result = await handlers[type](payload || {});
      self.postMessage({ id, ok: true, result });
    } catch (e) {
      self.postMessage({ id, ok: false, error: e.message || String(e) });
    }
  });
};
