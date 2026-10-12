/**
 * DSH History Viewer — Client 半体
 *
 * 1) 侧边栏底部动作区（sidebar.footer.action）加一个「历史」按钮
 * 2) 点开在应用内浮层（shell.overlay）里显示历史查看界面；浮层里也能"在新标签页打开"
 *
 * 界面本体由 Host 半体通过 /plugins/dsh-history-viewer/ 提供。
 * 约束（遵循官方 practices）：不 require 任何 @deepseek-ai/dsh-client-* 包，
 * 只从 module table 取 React；颜色用主题 token + 兜底值。
 */
window.__ModuleLoader__.load({
  id: 'dsh-history-viewer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const BASE = '/plugins/dsh-history-viewer';

    // 极简共享状态：按钮在侧栏，浮层在 overlay 槽，两边要联动
    let open = false;
    const subs = new Set();
    const setOpen = (v) => { open = v; for (const f of subs) f(v); };
    function useOpen() {
      const [v, setV] = React.useState(open);
      React.useEffect(() => { subs.add(setV); setV(open); return () => { subs.delete(setV); }; }, []);
      return v;
    }
    const token = (name, fallback) => `var(--dsw-alias-${name}, ${fallback})`;

    function HistoryEntry({ className }) {
      return h('button', {
        type: 'button',
        className,
        title: '历史查看 History',
        'aria-label': '历史查看 History',
        style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
        onClick: () => setOpen(true),
      }, h('span', { 'aria-hidden': true, style: { fontSize: 15, lineHeight: 1 } }, '🕘'));
    }

    function HistoryPanel() {
      const isOpen = useOpen();
      React.useEffect(() => {
        if (!isOpen) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [isOpen]);
      if (!isOpen) return null;
      const btn = { fontSize: 12, cursor: 'pointer', padding: '4px 8px' };
      return h('div', {
        onClick: () => setOpen(false),
        style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 2147483000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
      }, h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': '历史查看',
        onClick: (e) => e.stopPropagation(),
        style: {
          width: 'min(1320px, 95vw)', height: '93vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: token('bg-base', '#14161a'), color: token('label-primary', '#e6e6e6'),
          border: '1px solid ' + token('border-l2', '#2a2f37'), borderRadius: 10,
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid ' + token('border-l2', '#2a2f37') } },
          h('b', { style: { fontSize: 13 } }, '历史查看'),
          h('span', { style: { flex: 1 } }),
          h('button', { type: 'button', style: btn, 'aria-label': '在新标签页打开', onClick: () => window.open(BASE + '/', '_blank', 'noopener') }, '在新标签页打开'),
          h('button', { type: 'button', style: btn, 'aria-label': '关闭', onClick: () => setOpen(false) }, '关闭')),
        h('iframe', { src: BASE + '/', title: 'DSH 历史查看', style: { flex: 1, width: '100%', border: 0, background: token('bg-base', '#14161a') } })));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: 'dsh-history-viewer.entry', order: 40,
        }, HistoryEntry));
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-history-viewer.panel', order: 40,
        }, HistoryPanel));
      },
    };
  },
});
