/**
 * DSH History Viewer — 核心逻辑（零依赖）
 *
 * 直接读取 DSH 的会话日志（`<DSH_HOME>/sessions/**\/session.v*.jsonl.zstd`），
 * 抽取成可检索的文本缓存，提供：会话列表、项目（工作区）识别、项目内检索、
 * 逐条命中（带上下文）、Markdown 转录导出。
 *
 * 复用了独立版 D:\dsh-history\history.cjs 里已验证的算法：
 *   - 多帧 zstd 解压（v3/v4 两种日志格式都能读）
 *   - 同一会话的多份工作区副本按 id 合并（保留最新最全的一份）
 *   - 项目归属以 DSH 的 storages/workspace.json 为准（改过名/搬过目录也正确）
 *   - 截断时不切断 **粗体** 标记（避免渲染出裸星号）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const LF = String.fromCharCode(10);
export const SCOPES = {
  dialog: ['user', 'assistant'],
  tools: ['user', 'assistant', 'tool', 'tool-result'],
  all: null,
};

export function scopeKinds(scope) {
  const key = scope === undefined || scope === null || scope === '' ? 'dialog' : String(scope);
  return Object.prototype.hasOwnProperty.call(SCOPES, key) ? SCOPES[key] : SCOPES.dialog;
}
export function filterByScope(lines, scope) {
  const kinds = scopeKinds(scope);
  return kinds ? lines.filter((l) => kinds.includes(l.kind)) : lines;
}
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}
export /** 原子写：先写 .tmp 再 rename —— 避免读侧撞到半写文件（ENOSPC 也不留残file） */
function atomicWrite(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}
function safeName(id) {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}
function oneLine(s, max) {
  let t = String(s).replace(/\r?\n/g, '\\n').replace(/\t/g, ' ');
  if (max && t.length > max) t = t.slice(0, max) + ' …';
  return t;
}
function blocksToText(content) {
  if (!Array.isArray(content)) return { text: '', reasoning: '' };
  const parts = [];
  let reasoning = '';
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && b.text) parts.push(b.text);
    else if (b.type === 'reasoning' && b.text) reasoning += b.text;
    else if (b.type === 'image') parts.push('[图片]');
    else if (b.type === 'file') parts.push('[文件]');
  }
  return { text: parts.join(LF), reasoning };
}
function sourceLabel(source) {
  if (!source || typeof source !== 'object') return '';
  const k = source.kind || '';
  if (k === 'user') return '';
  if (k === 'plugin') return String(source.plugin || 'plugin');
  if (typeof k === 'string' && k.startsWith('plugin:')) return k.slice(7);
  return String(k);
}
function clipText(x, n) {
  let t = String(x == null ? '' : x).replace(/\\n/g, LF);
  if (t.length > n) {
    t = t.slice(0, n);
    const stars = (t.match(/\*\*/g) || []).length;
    if (stars % 2 === 1) {
      const last = t.lastIndexOf('**');
      if (last > 0) t = t.slice(0, last);
    }
    t += '…';
  }
  return t;
}

/** 找到所有会话日志文件。 */
export function findSessionFiles(sessionsDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^session\.v\d+\.jsonl\.zstd$/.test(e.name)) out.push(p);
    }
  };
  walk(sessionsDir);
  return out;
}

/** 读 DSH 的工作区定义：名称（如"物联网"）↔ 路径（如 D:\rf-iot）↔ 会话 id 列表。 */
export function loadProjects(home) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(home, 'storages', 'workspace.json'), 'utf8'));
    const t = (o.tables && o.tables.workspaces) || {};
    return Object.keys(t).map((k) => ({
      id: k,
      name: t[k].title || k,
      path: t[k].path || '',
      ids: Array.isArray(t[k].sessionIds) ? t[k].sessionIds : [],
    })).sort((a, b) => b.ids.length - a.ids.length);
  } catch { return []; }
}
function resolveProject(projects, sessionId, cwd) {
  for (const p of projects) if (p.ids.includes(sessionId)) return p;
  for (const p of projects) if (cwd && p.path && cwd.toLowerCase() === p.path.toLowerCase()) return p;
  return null;
}

/** 逐行解析一个会话日志（多帧 zstd）。 */
/** 解析失败统计：让"静默丢数据"在索引里可见（原来 corrupt/empty/坏行都被吞掉） */
export const stats = { corruptFrames: 0, emptyDecompress: 0, badJsonLines: 0, skippedFiles: 0 };
function readSessionLines(file, onLine) {
  const buf = fs.readFileSync(file);
  const offs = [];
  let i = buf.indexOf(ZSTD_MAGIC);
  while (i !== -1) { offs.push(i); i = buf.indexOf(ZSTD_MAGIC, i + 4); }
  let carry = '';
  for (let k = 0; k < offs.length; k++) {
    const s = offs[k];
    const e = k + 1 < offs.length ? offs[k + 1] : buf.length;
    let text;
    try {
      const out = zlib.zstdDecompressSync(buf.subarray(s, e));
      if (!out || out.length === 0) stats.emptyDecompress++;   // 截断帧会静默返回 0 字节，不抛错
      text = out.toString('utf8');
    } catch { stats.corruptFrames++; continue; }
    carry += text;
    let idx;
    while ((idx = carry.indexOf('\n')) !== -1) {
      const line = carry.slice(0, idx).replace(/\r$/, '');
      carry = carry.slice(idx + 1);
      if (line) onLine(line);
    }
  }
  if (carry.trim()) onLine(carry.replace(/\r$/, ''));
  return { frames: offs.length, bytes: buf.length };
}

/**
 * 建立/刷新索引：把每个会话抽成 `<dataDir>/text/<id>.txt`，并返回元信息数组。
 * 只在有会话文件比索引更新时才重建（增量判断在调用方）。
 */
export function buildIndex({ home, dataDir, onProgress }) {
  const sessionsDir = path.join(home, 'sessions');
  const textDir = path.join(dataDir, 'text');
  fs.mkdirSync(textDir, { recursive: true });
  const projects = loadProjects(home);
  const files = findSessionFiles(sessionsDir);
  const extracted = [];
  let done = 0;
  for (const file of files) {
    const meta = { file, id: path.basename(path.dirname(file)), version: null, cwd: '', title: '', createdAt: 0, lastTime: 0, events: 0, lines: 0, sizeBytes: 0 };
    const out = [];
    let title = '';
    try {
      const info = readSessionLines(file, (line) => {
        let ev;
        try { ev = JSON.parse(line); } catch { stats.badJsonLines++; return; }
        meta.events++;
        const t = typeof ev.time === 'number' ? ev.time : 0;
        if (t > meta.lastTime) meta.lastTime = t;
        switch (ev.type) {
          case 'session':
            meta.id = ev.id || meta.id;
            meta.version = ev.version || null;
            meta.cwd = ev.cwd || '';
            meta.createdAt = ev.createdAt || 0;
            break;
          case 'session/title': {
            const d = ev.data || {};
            const cand = d.title || (d.data && d.data.title) || '';
            if (cand) title = String(cand);
            break;
          }
          case 'user/message': {
            const d = ev.data || {};
            const { text } = blocksToText(d.content);
            if (!text) break;
            const label = sourceLabel(d.source);
            out.push(label ? { t, kind: 'ctx', text, label } : { t, kind: 'user', text });
            break;
          }
          case 'assistant/message': {
            const m = (ev.data && ev.data.message) || {};
            const { text, reasoning } = blocksToText(m.content);
            if (text) out.push({ t, kind: 'assistant', text });
            if (reasoning) out.push({ t, kind: 'reasoning', text: reasoning });
            break;
          }
          case 'tool/call': {
            const d = ev.data || {};
            out.push({ t, kind: 'tool', text: `[工具] ${d.name} ${oneLine(d.arguments || '', 400)}` });
            break;
          }
          case 'tool/result': {
            const m = (ev.data && ev.data.message) || {};
            const { text } = blocksToText(m.content);
            if (text) out.push({ t, kind: 'tool-result', text: oneLine(text, 4000) });
            break;
          }
          default: break;
        }
      });
      meta.sizeBytes = info.bytes;
    } catch { stats.skippedFiles++; continue; }
    meta.title = title;
    meta.lines = out.length;
    meta.workspace = path.basename(path.dirname(path.dirname(file)));
    extracted.push({ meta, out });
    done++;
    if (onProgress && done % 20 === 0) onProgress(done, files.length);
  }
  // 合并同一会话的多份工作区副本（取最后活动最新、其次文件更大的）
  const byId = new Map();
  for (const item of extracted) {
    const prev = byId.get(item.meta.id);
    const better = !prev
      || item.meta.lastTime > prev.meta.lastTime
      || (item.meta.lastTime === prev.meta.lastTime && item.meta.sizeBytes > prev.meta.sizeBytes);
    if (better) byId.set(item.meta.id, item);
  }
  const sessions = [];
  for (const { meta, out } of byId.values()) {
    const proj = resolveProject(projects, meta.id, meta.cwd);
    meta.project = proj ? proj.name : (meta.cwd ? path.basename(meta.cwd) : '未分组');
    meta.projectPath = proj ? proj.path : (meta.cwd || '');
    const textFile = path.join(textDir, safeName(meta.id) + '.txt');
    const body = [
      `# session ${meta.id}`,
      `# workspace ${meta.workspace}`,
      `# cwd ${meta.cwd}`,
      `# title ${meta.title}`,
      `# created ${meta.createdAt ? new Date(meta.createdAt).toISOString() : ''}`,
      ...out.map((l) => `${l.t}\t${l.kind}\t${l.label ? l.label + ': ' : ''}${oneLine(l.text, 200000)}`),
    ].join('\n') + '\n';
    atomicWrite(textFile, body);
    meta.textFile = textFile;
    sessions.push(meta);
  }
  const keep = new Set(sessions.map((s) => path.basename(s.textFile)));
  for (const f of fs.readdirSync(textDir)) if (!keep.has(f) && f.endsWith('.txt')) fs.rmSync(path.join(textDir, f), { force: true });
  sessions.sort((a, b) => (b.lastTime || b.createdAt) - (a.lastTime || a.createdAt));
  const index = {
    generatedAt: new Date().toISOString(), home, sessions,
    stats: Object.assign({}, stats),
    zstdSupported: typeof zlib.zstdDecompressSync === 'function',
  };
  fs.mkdirSync(dataDir, { recursive: true });
  atomicWrite(path.join(dataDir, 'index.json'), JSON.stringify(index));
  return index;
}

export function loadIndex(dataDir) {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'index.json'), 'utf8')); } catch { return null; }
}
export function indexIsStale({ home, dataDir }) {
  const idx = loadIndex(dataDir);
  if (!idx) return true;
  let newest = 0;
  for (const f of findSessionFiles(path.join(home, 'sessions'))) {
    try { newest = Math.max(newest, fs.statSync(f).mtimeMs); } catch { }
  }
  return newest > Date.parse(idx.generatedAt);
}
export function fmtTime(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function loadTextLines(s) {
  const raw = fs.readFileSync(s.textFile, 'utf8');
  const lines = [];
  for (const l of raw.split('\n')) {
    if (!l || l.startsWith('#')) continue;
    const p1 = l.indexOf('\t');
    if (p1 < 0) continue;
    const p2 = l.indexOf('\t', p1 + 1);
    if (p2 < 0) continue;
    lines.push({ t: Number(l.slice(0, p1)) || 0, kind: l.slice(p1 + 1, p2), text: l.slice(p2 + 1) });
  }
  return lines;
}

/** 「固定会话 + 当前项目」配置（界面里点 📌 / 选项目即改）。 */
export function loadFocus(dataDir) {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(dataDir, 'focus.json'), 'utf8'));
    return { active: !!o.active, ids: Array.isArray(o.ids) ? o.ids : [], project: typeof o.project === 'string' ? o.project : '' };
  } catch { return { active: false, ids: [], project: '' }; }
}
export function saveFocus(dataDir, f) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'focus.json'), JSON.stringify({ active: !!f.active, ids: f.ids || [], project: f.project || '' }, null, 1), 'utf8');
  } catch { }
}

/** 项目 + 固定过滤后的会话集合。 */
export function visibleSessions(index, focus) {
  let list = index.sessions;
  if (focus.project) list = list.filter((s) => (s.project || '未分组') === focus.project);
  const activeIds = focus.active ? focus.ids.filter((id) => list.some((s) => s.id === id)) : [];
  return { list, activeIds };
}

/** 检索：返回 groups（每个会话命中计数）+ hits（含上下文）。
 *  loadLines 可传入带缓存的取行函数（宿主插件用），避免每次搜索都重新读盘解析。 */
export function searchSessions({ index, focus, q, scope, perSession, limit, loadLines }) {
  const kinds = scopeKinds(scope);
  const needle = String(q).toLowerCase();
  const { list, activeIds } = visibleSessions(index, focus);
  const pool = activeIds.length ? list.filter((s) => activeIds.includes(s.id)) : list;
  const hits = [];
  const groups = [];
  let total = 0;
  let searched = 0;
  for (const s of pool) {
    let lines;
    try { lines = loadLines ? loadLines(s) : loadTextLines(s); } catch { continue; }
    const use = kinds ? lines.filter((l) => kinds.includes(l.kind)) : lines;
    const found = [];
    for (let i = 0; i < use.length; i++) if (use[i].text.toLowerCase().includes(needle)) found.push(i);
    if (!found.length) continue;
    searched++;
    total += found.length;            // 计数覆盖所有会话，不受 limit 影响
    if (hits.length >= limit) continue;   // 收集已达上限时继续统计，不再漏报总数
    groups.push({ id: s.id, title: s.title, workspace: s.workspace, project: s.project, count: found.length, shown: Math.min(found.length, perSession) });
    for (const i of found.slice(0, perSession)) {
      const l = use[i];
      hits.push({
        id: s.id, title: s.title, workspace: s.workspace, t: l.t, kind: l.kind, idx: i,
        before: i > 0 ? clipText(use[i - 1].text, 160) : '',
        text: clipText(l.text, 900),
        after: i + 1 < use.length ? clipText(use[i + 1].text, 160) : '',
      });
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }
  return { hits, groups, sessions: searched, total };
}

/** 导出用的 Markdown 转录。 */
export function transcriptMarkdown(s, scope, tail) {
  const all = loadTextLines(s);
  const lines = filterByScope(all, scope || 'dialog');
  const use = tail ? lines.slice(-tail) : lines;
  const scopeName = { dialog: '只看对话', tools: '对话+工具', all: '全部（含思考/上下文）' }[scope || 'dialog'] || scope;
  const head = `# ${s.title || '(无标题)'}\n\n- 会话：\`${s.id}\`\n- 项目：${s.project || ''}\n- 时间：${fmtTime(s.createdAt)} → ${fmtTime(s.lastTime)}\n- 范围：${scopeName}（本记录 ${lines.length} 条；该会话总计 ${all.length} 条）\n\n---\n`;
  const body = use.map((l) => {
    const who = l.kind === 'user' ? '🧑 我' : l.kind === 'assistant' ? '🤖 DSH' : l.kind === 'tool' ? '🔧 工具调用' : l.kind === 'tool-result' ? '📄 工具结果' : l.kind === 'ctx' ? '📎 上下文注入' : l.kind === 'reasoning' ? '💭 思考' : l.kind;
    return `### ${who} · ${fmtTime(l.t)}\n\n${l.text.replace(/\\n/g, '\n')}\n`;
  }).join('\n');
  return head + body;
}
