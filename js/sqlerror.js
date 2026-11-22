// Menerjemahkan error PostgreSQL: baris berapa, bagian mana, dan kemungkinan penyebabnya.
// Hanya membahas syntax. Tidak pernah membahas isi jawaban.

// Buang isi string, komentar, dan $$...$$ supaya kata kunci di dalamnya tidak ikut terhitung
function bare(sql) {
  return sql.replace(/\$\$[\s\S]*?\$\$|'(?:[^']|'')*'|--[^\n]*/g, (m) => (m.startsWith('--') ? '' : " '' "));
}
const count = (text, re) => (text.match(re) || []).length;

// position dari PostgreSQL dihitung per karakter, mulai dari 1
export function locate(sql, position) {
  const pos = Number(position);
  if (!pos) return null;
  const chars = Array.from(sql.replace(/\s+$/, ''));
  const at = Math.min(pos - 1, chars.length);
  const before = chars.slice(0, at).join('');
  const rest = chars.slice(at).join('').split('\n')[0];
  const head = before.slice(before.lastIndexOf('\n') + 1);
  const token = (rest.match(/^('(?:[^']|'')*'?|[\w.]+|\S)/) || [''])[0];
  return { line: before.split('\n').length, head, token, tail: rest.slice(token.length), before };
}

export function explain(sql, message, where) {
  const b = bare(sql);
  const near = (message.match(/syntax error at or near "(.*)"/) || [])[1];
  const syntax = near !== undefined || /syntax error at end of input/.test(message);
  let m;

  if (/unterminated quoted string/.test(message)) return "Ada tanda kutip ' yang belum ditutup.";
  if (/unterminated dollar-quoted/.test(message)) return 'Isi function belum ditutup dengan $$.';
  if (syntax) {
    if (count(b, /\bcase\b/gi) > count(b, /\bend\b/gi)) return 'CASE belum ditutup. Tambahkan END sebelum AS atau sebelum kolom berikutnya.';
    const open = count(b, /\(/g), close = count(b, /\)/g);
    if (open > close) return 'Ada kurung buka ( yang belum ditutup.';
    if (close > open) return 'Ada kurung tutup ) yang berlebih.';
    const before = where ? bare(where.before).trimEnd() : '';
    if (near && /^(from|where|group|order|having|limit)$/i.test(near) && before.endsWith(',')) return `Ada koma berlebih tepat sebelum ${near.toUpperCase()}.`;
    const last = before.split(';').pop().trim();
    if (/^grant\b/i.test(last) && !/\bto\b/i.test(last)) return 'GRANT belum lengkap: harus ada TO lalu nama role.';
    if (/^revoke\b/i.test(last) && !/\bfrom\b/i.test(last)) return 'REVOKE belum lengkap: harus ada FROM lalu nama role.';
    if (near && last && /^(select|create|update|insert|delete|grant|revoke|with)$/i.test(near)) return `Perintah sebelum ${near.toUpperCase()} mungkin belum ditutup dengan titik koma (;).`;
    if (near === undefined || near === ';') return 'Perintahnya belum lengkap. Ada bagian yang kurang di akhir.';
    return 'Periksa bagian yang ditandai dan satu kata sebelumnya: salah eja, kurang koma, atau ada kata yang terlewat.';
  }
  if ((m = message.match(/column "(.+)" must appear in the GROUP BY/))) return `${m[1]} tampil tanpa fungsi agregat, jadi harus ikut ditulis di GROUP BY.`;
  if ((m = message.match(/column "?([^"]+?)"? does not exist/))) return `Kolom ${m[1]} tidak ada. Cek nama kolomnya di Arsip Mesin. Kalau maksudmu teks, pakai kutip satu.`;
  if ((m = message.match(/relation "(.+)" does not exist/))) return `Tabel ${m[1]} tidak ada. Cek namanya di Arsip Mesin.`;
  if ((m = message.match(/missing FROM-clause entry for table "(.+)"/))) return `Alias atau tabel ${m[1]} belum disebut di FROM atau JOIN.`;
  if ((m = message.match(/column reference "(.+)" is ambiguous/))) return `Kolom ${m[1]} ada di lebih dari satu tabel. Tulis alias tabel di depannya.`;
  if ((m = message.match(/function (\w+)\(.*\) does not exist/))) return `Function ${m[1]} tidak ada, atau tipe isinya tidak cocok. Cek ejaannya.`;
  if (/already exists/.test(message)) return 'Itu sudah pernah kamu buat. Hapus baris itu dari editor, atau tekan Reset data untuk mengulang.';
  return '';
}

export function describeError(sql, message, position) {
  const where = locate(sql, position);
  return { where, tip: explain(sql, message, where) };
}
