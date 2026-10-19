// 生成词典 SQLite：npm run dict:rebuild
// 说明：
//   - 默认：内置精简词表 data/seed-dict.json（离线可用，约 460 个高频词）
//   - 设置 ECDICT_CSV 指向本地 ecdict.csv：按 ECDICT 的「词频序号 bn」取前 N 个常用词
//     （N 由 ECDICT_LIMIT 控制，默认 30000），再由内置词表兜底补词
//   - 一键下载 + 生成：npm run dict:fetch
// 输出 data/dict.db：运行时只做索引点查，不会把整个词库读进内存。

import { DatabaseSync } from 'node:sqlite';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dbFile = path.join(dataDir, 'dict.db');
// 词表源文件固定在项目内的 data/seed-dict.json，输出位置跟随 DATA_DIR
const seedFile = path.join(root, 'data', 'seed-dict.json');
const force = process.argv.includes('--force');
const ecdictLimit = Number(process.env.ECDICT_LIMIT || 30000);

/** 解析一行 CSV，支持双引号包裹的字段 */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  if (existsSync(dbFile) && !force) {
    console.log(`[dict] 已存在 ${path.relative(root, dbFile)}，跳过生成（如需重建请加 --force）`);
    return;
  }

  const map = new Map();

  const csv = process.env.ECDICT_CSV;
  let fromEcdict = 0;
  if (csv && existsSync(csv)) {
    const text = await fs.readFile(csv, 'utf8');
    const lines = text.split(/\r?\n/);
    const header = parseCsvLine(lines[0] || '');
    const idx = (name, fallback) => {
      const i = header.indexOf(name);
      return i >= 0 ? i : fallback;
    };
    const iWord = idx('word', 0);
    const iPhonetic = idx('phonetic', 1);
    const iDef = idx('definition', 2);
    const iTrans = idx('translation', 3);
    const iPos = idx('pos', 4);
    const iBn = idx('bnc', 6);
    const iFrq = idx('frq', 7);

    // 第一遍：收集所有带中文释义的词，按词频（bnc，越小越常用）排序
    const candidates = [];
    for (let n = 1; n < lines.length; n++) {
      const line = lines[n];
      if (!line || line.length > 4000) continue;
      const cols = line.split(',').length > header.length ? parseCsvLine(line) : line.split(',');
      const word = (cols[iWord] || '').trim().toLowerCase();
      if (!word || !/^[a-z][a-z'-]*$/.test(word) || word.length > 40) continue;
      const translation = (cols[iTrans] || '').replace(/\\n/g, '；').replace(/\s+/g, ' ').trim();
      if (!translation) continue;
      const bn = Number(cols[iBn]);
      const frq = Number(cols[iFrq]);
      const rank = Number.isFinite(bn) && bn > 0 ? bn : Number.isFinite(frq) && frq > 0 ? frq + 100000 : Number.POSITIVE_INFINITY;
      candidates.push({ word, phonetic: (cols[iPhonetic] || '').trim(), translation, definition: (cols[iDef] || '').trim(), pos: (cols[iPos] || '').trim(), rank });
    }
    candidates.sort((a, b) => a.rank - b.rank);
    for (const c of candidates) {
      if (fromEcdict >= ecdictLimit) break;
      if (map.has(c.word)) continue;
      map.set(c.word, { w: c.word, zh: c.translation, phonetic: c.phonetic, def: c.definition, tag: c.pos || 'ecdict' });
      fromEcdict++;
    }
    console.log(`[dict] 从 ECDICT 取词 ${fromEcdict} 个（共扫描 ${candidates.length} 个有中文释义的词）`);
  }

  // 内置词表兜底：保证示例文章与基础高频词一定有本地释义
  const seed = JSON.parse(await fs.readFile(seedFile, 'utf8'));
  let fromSeed = 0;
  for (const e of seed.entries) {
    const key = String(e.w || '').trim().toLowerCase();
    if (!key || map.has(key)) continue;
    map.set(key, { w: key, zh: e.zh, phonetic: e.phonetic ?? '', def: e.def ?? '', tag: 'core' });
    fromSeed++;
  }
  if (fromSeed) console.log(`[dict] 内置词表补充 ${fromSeed} 个词条`);

  if (existsSync(dbFile)) await fs.rm(dbFile, { force: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE words (
      word TEXT PRIMARY KEY,
      phonetic TEXT,
      translation TEXT NOT NULL,
      definition TEXT,
      tag TEXT
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  const insert = db.prepare(
    'INSERT OR REPLACE INTO words (word, phonetic, translation, definition, tag) VALUES (?, ?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  for (const [word, e] of map) insert.run(word, e.phonetic ?? '', e.zh, e.def ?? '', e.tag ?? 'core');
  db.exec('COMMIT');
  const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  setMeta.run('source', fromEcdict > 0 ? 'ecdict' : 'bundled-mini');
  setMeta.run('count', String(map.size));
  setMeta.run('ecdictLimit', String(ecdictLimit));
  setMeta.run('builtAt', new Date().toISOString());
  db.close();

  const size = (await fs.stat(dbFile)).size;
  console.log(
    `[dict] 生成完成：${map.size} 个词条，${(size / 1024).toFixed(1)} KB -> ${path.relative(root, dbFile)}`
  );
}

main().catch((err) => {
  console.error('[dict] 生成失败：', err);
  process.exitCode = 1;
});
