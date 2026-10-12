/**
 * 索引重建 worker：把重活移出宿主主线程。
 *
 * 为什么必须这样：索引重建要解压/解析上百 MB 的会话日志（5~10 秒）。
 * 如果在宿主进程的事件循环里跑，会阻塞 DSH 自己的 HTTP/SSE 请求 —— 
 * 表现就是"整个 GUI 卡卡的"。放到 worker 线程后宿主始终响应。
 */
import { parentPort, workerData } from 'node:worker_threads';
import { buildIndex } from './core.js';

try {
  const index = buildIndex({
    home: workerData.home,
    dataDir: workerData.dataDir,
    onProgress: (done, total) => parentPort.postMessage({ type: 'progress', done, total }),
  });
  parentPort.postMessage({ type: 'done', sessions: index.sessions.length, generatedAt: index.generatedAt });
} catch (e) {
  parentPort.postMessage({ type: 'error', message: e && e.message ? e.message : String(e) });
}
