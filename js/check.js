// Normalisasi hasil query + sidik jari (hash). Dipakai di browser dan di tools/build (Node 20).

export const RAW_OIDS = [16, 17, 18, 19, 20, 21, 23, 24, 25, 26, 114, 142, 600, 700, 701, 790, 1000, 1005,
  1007, 1009, 1015, 1016, 1021, 1022, 1028, 1042, 1043, 1082, 1083, 1114, 1115, 1182, 1183, 1184, 1185, 1186,
  1187, 1231, 1266, 1270, 1700, 2950, 3614, 3615, 3802, 3807];

export function rawParsers() {
  const id = (v) => v;
  return Object.fromEntries(RAW_OIDS.map((o) => [o, id]));
}

function arrayToText(a) {
  const items = a.map((v) => {
    if (v === null) return 'NULL';
    if (Array.isArray(v)) return arrayToText(v);
    const s = String(v);
    return /^$|[\s,{}"\\]/.test(s) || s.toUpperCase() === 'NULL' ? '"' + s.replace(/(["\\])/g, '\\$1') + '"' : s;
  });
  return '{' + items.join(',') + '}';
}

// Nilai satu sel -> teks seperti yang tampil di pgAdmin (null tetap null)
export function cellText(v, typeId) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return arrayToText(v);
  if (typeId === 16) return v === 't' || v === true ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// result: { fields: [{name, dataTypeID}], rows: [[...]] } (rowMode array)
export function normalize(result, ordered) {
  const types = (result.fields || []).map((f) => f.dataTypeID);
  const rows = (result.rows || []).map((r) => r.map((v, i) => cellText(v, types[i])));
  const keyed = rows.map((r) => JSON.stringify(r));
  if (!ordered) keyed.sort();
  return { cols: types.length, rows: keyed.length, text: JSON.stringify({ c: types.length, r: keyed }) };
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Penilaian bab aksi. spec = langkah lengkap (dengan harapan), outputs = [{ok, rows, error}] dari browser.
// Logika yang sama disalin ke appsscript/Core.js (server).
export function evaluateSteps(spec, outputs) {
  for (let i = 0; i < spec.length; i++) {
    const st = spec[i];
    const out = outputs[i] || { ok: false, error: 'tidak dijalankan' };
    let pass;
    if (st.expectError) pass = !out.ok && String(out.error || '').includes(st.expectError);
    else if (!out.ok) pass = false;
    else if (st.contains) pass = (out.rows || []).some((x) => String(x[0]).includes(st.contains));
    else if (st.expect) pass = JSON.stringify(out.rows) === JSON.stringify(st.expect);
    else pass = true;
    if (!pass) {
      const extra = !st.expectError && !out.ok && out.error ? ` (error: ${out.error})` : '';
      return { pass: false, index: i, fail: st.fail + extra };
    }
  }
  return { pass: true };
}

// Konten untuk browser saat dinilai: tanpa solusi, hint, sidik jari kunci, dan harapan langkah.
export function stripContent(full) {
  const c = JSON.parse(JSON.stringify(full));
  c.replay = { prolog: full.replay.prolog };
  for (const ch of Object.values(c.chapters)) {
    delete ch.solution; delete ch.hint1; delete ch.hint2; delete ch.expect; delete ch.after;
    if (ch.steps) ch.steps = ch.steps.map((s) => ({ sql: s.sql, rollback: !!s.rollback }));
  }
  return c;
}

export async function fingerprint(result, ordered) {
  const n = normalize(result, ordered);
  return { hash: await sha256(n.text), cols: n.cols, rows: n.rows };
}
