/**
 * 本地 CONNECT 代理：只做一件事 —— 把被污染解析的 github.com 定向到实测可用的 IP。
 * 仅监听 127.0.0.1，不做任何转发之外的持久化，不修改系统 hosts / 不需要管理员权限。
 */
const net = require('node:net');
const http = require('node:http');

const PORT = Number(process.env.GH_PROXY_PORT || 18888);
// 实测：这些 IP 可直连（20.205.243.166 是当前 DNS 返回的、被墙的地址）
const OVERRIDE = {
  'github.com': '140.82.113.3',
  'www.github.com': '140.82.113.3',
  'gist.github.com': '140.82.113.3',
};

const server = http.createServer((req, res) => {
  res.writeHead(405, { 'content-type': 'text/plain' });
  res.end('CONNECT only');
});

server.on('connect', (req, clientSocket, head) => {
  const [host, portRaw] = String(req.url).split(':');
  const port = Number(portRaw) || 443;
  const target = OVERRIDE[host] || host;
  const upstream = net.connect(port, target, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
    console.log(`[proxy] ${host}:${port} -> ${target}  (established)`);
  });
  const bye = (who) => () => { try { upstream.destroy(); } catch { } try { clientSocket.destroy(); } catch { } console.log(`[proxy] ${host} closed by ${who}`); };
  upstream.on('error', bye('upstream'));
  clientSocket.on('error', bye('client'));
});

server.listen(PORT, '127.0.0.1', () => console.log(`[proxy] listening on http://127.0.0.1:${PORT}`));
