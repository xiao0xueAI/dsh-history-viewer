/**
 * DSH History Viewer — Host 半体
 *
 * 把本地会话历史（检索 / 阅读 / 导出）挂到 DSH 自己的 Web 服务上，
 * 路由前缀 `/plugins/dsh-history-viewer`，无需另开端口。
 *
 * 设计要点：
 *   - 零依赖：只用 node 内置模块 + 本包的 lib/core.js
 *   - 索引缓存在 `~/.dsh/dsh-history-viewer/`（可用环境变量 DSH_HISTORY_VIEWER_DIR 改）
 *   - 索引过期时后台重建，不阻塞正在进行的请求
 *   - 只服务本机（校验 Host 头），避免误暴露到局域网
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { Worker } from 'node:worker_threads';
import crypto from 'node:crypto';
import * as core from './lib/core.js';

export const name = 'dsh-history-viewer';
export const inject = ['webServer'];

const PLUGIN_ID = 'dsh-history-viewer';
const BASE = '/plugins/' + PLUGIN_ID;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_FILE = path.join(DIR, 'ui.html');
const WORKER_FILE = path.join(DIR, 'lib', 'index-worker.js');
/** 索引重建冷却期：当前会话一直在写日志，"文件比索引新"永远为真，
 *  没有冷却期就会每次请求都重建（这正是"卡卡的"的根因）。 */
const REBUILD_COOLDOWN_MS = 5 * 60 * 1000;

export function apply(ctx, config = {}) {
  /** 本次运行随机令牌：界面从 HTML 里拿到，所有 /api/* 请求都要带上 */
  const TOKEN = crypto.randomUUID();
  if (typeof zlib.zstdDecompressSync !== 'function') {
    log('error', '当前 Node 缺少 zlib.zstdDecompressSync（需要 Node >= 22.15），历史索引将为空');
  }
  const home = config.dshHome || core.dshHome();
  const dataDir = process.env.DSH_HISTORY_VIEWER_DIR || path.join(home, PLUGIN_ID);
  /** 日志：优先宿主 logger，缺失时退回 console（原来 try/catch 会把输出整个吞掉） */
  const log = (level, msg) => {
    const sink = ctx.logger || console;
    try { (sink[level] || sink.log || console.log).call(sink, '[' + PLUGIN_ID + '] ' + msg); } catch { }
  };

  let index = null;
  let building = false;
  let activeWorker = null;
  let watchdog = null;
  let lastBuildAt = 0;
  // 会话文本缓存：避免每次搜索/打开都重新读盘解析（key = session id）
  const lineCache = new Map();

  function loadFromDisk() {
    index = index || core.loadIndex(dataDir);
    return index;
  }

  /** 在 worker 线程里重建索引，绝不阻塞宿主。 */
  function rebuildInWorker() {
    if (building) return;
    building = true;
    lastBuildAt = Date.now();
    log('info', '后台重建索引（worker 线程）…');
    let worker;
    try {
      worker = new Worker(WORKER_FILE, { workerData: { home, dataDir }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    } catch (e) {
      building = false;
      log('warn', 'worker 启动失败，跳过本次重建：' + (e && e.message));
      return;
    }
    worker.on('message', (m) => {
      if (m && m.type === 'error') log('warn', '重建失败：' + m.message);
      if (m && m.type === 'done') log('info', `索引已刷新：${m.sessions} 个会话`);
    });
    worker.on('error', (e) => log('warn', 'worker 错误：' + (e && e.message)));
    worker.on('exit', () => { building = false; index = null; lineCache.clear(); lineCacheBytes = 0; if (watchdog) { clearTimeout(watchdog); watchdog = null; } activeWorker = null; });
    activeWorker = worker;
    worker.unref();                                  // 不阻止宿主退出
    watchdog = setTimeout(() => {                    // 卡死自愈：2 分钟没结束就终止
      log('warn', '重建超时，终止 worker');
      try { worker.terminate(); } catch { }
      building = false;
    }, 120000);
  }

  function maybeRefresh(force) {
    const loaded = loadFromDisk();
    if (!loaded) { rebuildInWorker(); return; }
    if (building) return;
    const now = Date.now();
    if (force || (now - lastBuildAt > REBUILD_COOLDOWN_MS && core.indexIsStale({ home, dataDir }))) {
      rebuildInWorker();
    }
  }

  const LINE_CACHE_BUDGET = 64 * 1024 * 1024;   // 行缓存总量上限
  const LINE_CACHE_MAX_ONE = 8 * 1024 * 1024;   // 单个会话超过此值不入缓存（每次按需读盘）
  let lineCacheBytes = 0;
  function lines(session) {
    let mtime = 0, size = 0;
    try { const st = fs.statSync(session.textFile); mtime = st.mtimeMs; size = st.size; } catch { }
    const hit = lineCache.get(session.id);
    if (hit && hit.mtime === mtime && hit.size === size) {   // 会话被追加写入时必须重读
      lineCache.delete(session.id); lineCache.set(session.id, hit);   // LRU 触达
      return hit.lines;
    }
    const parsed = core.loadTextLines(session);
    if (hit) { lineCache.delete(session.id); lineCacheBytes -= hit.bytes || 0; }
    if (size > 0 && size <= LINE_CACHE_MAX_ONE) {
      lineCache.set(session.id, { mtime, size, bytes: size, lines: parsed });
      lineCacheBytes += size;
      while (lineCacheBytes > LINE_CACHE_BUDGET && lineCache.size > 1) {
        const k = lineCache.keys().next().value;
        lineCacheBytes -= (lineCache.get(k) || {}).bytes || 0;
        lineCache.delete(k);
      }
    }
    return parsed;
  }

  function currentIndex() {
    maybeRefresh(false);
    return loadFromDisk() || { sessions: [], generatedAt: new Date().toISOString() };
  }

  /** 界面 HTML：读一次后常驻内存（只在文件变化时重读），并注入 API 前缀 + 本次运行的访问令牌。 */
  let uiCache = null;
  let uiMtime = 0;
  function uiHtml() {
    const st = fs.statSync(UI_FILE);
    if (!uiCache || st.mtimeMs !== uiMtime) {
      const inject = `<head><script>window.__HV_BASE__=${JSON.stringify(BASE)};window.__HV_TOKEN__=${JSON.stringify(TOKEN)};</script>`;
      uiCache = fs.readFileSync(UI_FILE, 'utf8').replace('<head>', inject);
      uiMtime = st.mtimeMs;
    }
    return uiCache;
  }

  const send = (res, code, body, type) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    res.writeHead(code, { 'content-type': (type || 'text/plain; charset=utf-8'), 'content-length': buf.length, 'cache-control': 'no-store' });
    res.end(buf);
  };
  const json = (res, obj) => send(res, 200, JSON.stringify(obj), 'application/json; charset=utf-8');
  /** 数值参数钳制：NaN 会让上限判断失效（实测 limit=abc 会返回全部命中 58MB）。 */
  const clampInt = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : dflt; };

  /**
   * 三重防护（该路由没有 DSH 的鉴权护栏，历史又含敏感内容）：
   *  1) Host 必须是本机字面量（精确匹配，不能用前缀 —— `127.0.0.1.evil.com` 会命中前缀）
   *  2) 浏览器的同源信号必须是 same-origin/none（挡 DNS rebinding 与跨站请求）
   *  3) /api/* 必须带本次运行随机生成的令牌（挡本机其它程序/页面直接猜接口）
   */
  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
  /** 连接来源必须是回环（比 Host 头可靠：Host 可被客户端任意伪造） */
  function remoteOk(req) {
    const a = String((req.socket && req.socket.remoteAddress) || '');
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  }
  function hostOk(req) {
    const raw = String(req.headers.host || '').trim().toLowerCase();
    if (!raw) return false;
    let host = raw;
    if (host.startsWith('[')) { const i = host.indexOf(']'); host = i >= 0 ? host.slice(0, i + 1) : host; }
    else { const i = host.lastIndexOf(':'); if (i > 0) host = host.slice(0, i); }
    return LOOPBACK.has(host);
  }
  function sameSiteOk(req) {
    const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
    if (site && site !== 'same-origin' && site !== 'none') return false;
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(String(origin)).hostname !== '127.0.0.1' && new URL(String(origin)).hostname !== 'localhost') return false; }
      catch { return false; }
    }
    return true;
  }
  function tokenOk(req, url) {
    const t = req.headers['x-hv-token'] || url.searchParams.get('token');
    return typeof t === 'string' && t === TOKEN;
  }

  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: BASE,
    handler: async (req, res) => {
      if (!remoteOk(req)) return send(res, 403, 'forbidden: not loopback');
      if (!hostOk(req)) return send(res, 403, 'forbidden: bad host');
      if (!sameSiteOk(req)) return send(res, 403, 'forbidden: cross-site');
      const url = new URL(req.url, 'http://127.0.0.1');
      const p = url.pathname.slice(BASE.length) || '/';
      if (p !== '/' && p !== '' && p.startsWith('/api/') && !tokenOk(req, url)) {
        return send(res, 401, 'unauthorized: missing or bad token');
      }
      try {
        if (p === '/' || p === '') {
          let html = '';
          try { html = uiHtml(); } catch { return send(res, 500, 'ui.html 缺失'); }
          const hb = Buffer.from(html, 'utf8');
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8', 'content-length': hb.length, 'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'",
          });
          return res.end(hb);
        }
        const idx = currentIndex();
        const focus = core.loadFocus(dataDir);

        if (p === '/api/sessions') {
          const readyIndex = loadFromDisk();
          const counts = {};
          for (const s of (readyIndex ? readyIndex.sessions : [])) counts[s.project || '未分组'] = (counts[s.project || '未分组'] || 0) + 1;
          const { list, activeIds } = core.visibleSessions(readyIndex || { sessions: [] }, focus);
          const all = list.map((s) => ({ id: s.id, title: s.title, project: s.project || '未分组', workspace: s.workspace, cwd: s.cwd, created: s.createdAt, last: s.lastTime, lines: s.lines, mb: +(s.sizeBytes / 1048576).toFixed(2) }));
          const shown = activeIds.length ? all.filter((s) => activeIds.includes(s.id)) : all;
          const projects = Object.keys(counts).map((k) => ({ name: k, count: counts[k] })).sort((a, b) => b.count - a.count);
          return json(res, {
            sessions: shown,
            projects,
            ready: !!readyIndex && readyIndex.sessions.length > 0,
            building,
            indexGeneratedAt: readyIndex ? readyIndex.generatedAt : null,
            stats: readyIndex ? readyIndex.stats || null : null,
            focus: { active: activeIds.length > 0, ids: focus.ids, activeIds, pinnedHere: focus.ids.filter((id) => list.some((s) => s.id === id)).length, project: focus.project || '', total: all.length, shown: shown.length },
          });
        }
        if (p === '/api/focus') {
          const patch = {};
          const toggle = url.searchParams.get('toggle');
          if (toggle) patch.ids = focus.ids.includes(toggle) ? focus.ids.filter((x) => x !== toggle) : focus.ids.concat([toggle]);
          const active = url.searchParams.get('active');
          if (active !== null) patch.active = active === '1' || active === 'true';
          const project = url.searchParams.get('project');
          if (project !== null) patch.project = project;
          const next = Object.assign({}, focus, patch);
          if (patch.ids && patch.ids.length && !('active' in patch)) next.active = true;
          if (url.searchParams.get('clear') === '1') { next.ids = []; next.active = false; next.project = ''; }
          core.saveFocus(dataDir, next);
          return json(res, { active: !!next.active, ids: next.ids, project: next.project || '' });
        }
        if (p === '/api/text') {
          const s = idx.sessions.find((x) => x.id === url.searchParams.get('id'));
          if (!s) return send(res, 404, 'not found');
          const scope = url.searchParams.get('scope') || 'dialog';
          const scoped = core.filterByScope(lines(s), scope);
          const total = scoped.length;
          // 分页：默认只给窗口（大会话整份可达 18MB JSON，会把浏览器卡死）
          const limit = clampInt(url.searchParams.get('limit'), 20, 1000, 300);
          const around = Number(url.searchParams.get('around') || 0);
          let offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);
          if (around) {
            let i = scoped.findIndex((l) => l.t >= around);
            if (i < 0) i = Math.max(total - 1, 0);
            offset = Math.max(Math.min(i - Math.floor(limit / 2), Math.max(total - limit, 0)), 0);
          }
          if (offset > Math.max(total - 1, 0)) offset = Math.max(total - limit, 0);
          const win = scoped.slice(offset, offset + limit);
          return json(res, {
            id: s.id, title: s.title, cwd: s.cwd, scope,
            total, offset, limit, returned: win.length,
            hasBefore: offset > 0, hasAfter: offset + win.length < total,
            lines: win,
          });
        }
        if (p === '/api/export') {
          const s = idx.sessions.find((x) => x.id === url.searchParams.get('id'));
          if (!s) return send(res, 404, 'not found');
          const scope = url.searchParams.get('scope') || 'dialog';
          const md = core.transcriptMarkdown(s, scope, Number(url.searchParams.get('tail') || 0));
          const fname = `${core.fmtTime(s.createdAt).slice(0, 10)}-${(s.title || core.safeName(s.id)).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}.md`;
          const buf = Buffer.from(md, 'utf8');
          res.writeHead(200, {
            'content-type': 'text/markdown; charset=utf-8',
            'content-length': buf.length,
            'content-disposition': 'attachment; filename*=UTF-8' + String.fromCharCode(39) + String.fromCharCode(39) + encodeURIComponent(fname),
          });
          return res.end(buf);
        }
        if (p === '/api/search') {
          const q = (url.searchParams.get('q') || '').trim();
          const perRaw = url.searchParams.get('per');
          const perSession = perRaw === 'all' || perRaw === '0' ? 1e9 : clampInt(perRaw, 1, 2000, 20);
          const limit = clampInt(url.searchParams.get('limit'), 1, 2000, 300);
          if (!q) return json(res, { hits: [], groups: [], sessions: 0, total: 0 });
          return json(res, core.searchSessions({ index: idx, focus, q, scope: url.searchParams.get('scope') || 'dialog', perSession, limit, loadLines: lines }));
        }
        if (p === '/api/reindex') {
          maybeRefresh(true);
          return json(res, { ok: true, building: true, sessions: (loadFromDisk() || { sessions: [] }).sessions.length });
        }
        return send(res, 404, 'not found');
      } catch (e) {
        const errId = crypto.randomBytes(4).toString('hex');
        log('warn', '请求失败 [' + errId + '] ' + (e && e.stack ? e.stack : e));
        if (res.headersSent) { try { res.end(); } catch { } return; }
        return send(res, 500, 'internal error (ref ' + errId + ')');
      }
    },
  });

  log('info', `已挂载 ${BASE}/（会话目录 ${path.join(home, 'sessions')}，缓存 ${dataDir}）`);
  ctx.effect(() => dispose);
  ctx.effect(() => () => {                     // 插件卸载/热重载时清干净，避免双写
    if (watchdog) clearTimeout(watchdog);
    if (activeWorker) { try { activeWorker.terminate(); } catch { } }
    building = false;
  });
}
