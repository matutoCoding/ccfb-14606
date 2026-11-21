import './styles.css';
import { h, mount } from './ui/dom';
import { Router } from './ui/router';
import { seedIfEmpty } from './data/seed';
import { renderRoutePage } from './pages/routePage';
import { renderBoxPage } from './pages/boxPage';
import { renderBenchPage } from './pages/benchPage';
import { renderOtdrPage } from './pages/otdrPage';
import { renderOrdersPage } from './pages/ordersPage';

const NAV = [
  { path: '/route', label: '光缆路由' },
  { path: '/box', label: '接头盒' },
  { path: '/bench', label: '熔接台仿真' },
  { path: '/otdr', label: 'OTDR 曲线' },
  { path: '/orders', label: '工单统计' },
];

function shell(): void {
  const app = document.getElementById('app')!;
  const main = h('main', { class: 'content', id: 'view' });
  const header = h(
    'header',
    { class: 'topbar' },
    h('div', { class: 'logo' }, '光接', h('span', {}, '通真'), ' · 熔接成像仿真与接头管理'),
    h(
      'nav',
      { class: 'mainnav' },
      ...NAV.map((n) => h('a', { href: `#${n.path}`, dataset: { nav: n.path.slice(1) } }, n.label)),
    ),
  );
  mount(app, h('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:100vh' }, header, main));
}

function toast(msg: string, kind: 'info' | 'bad' | 'ok' = 'info'): void {
  const el = h('div', { class: `toast ${kind === 'info' ? '' : kind}` }, msg);
  document.body.append(el);
  setTimeout(() => el.remove(), 3600);
}
// 全局 toast 挂到 window 供页面复用
declare global {
  interface Window {
    toast: typeof toast;
  }
}
window.toast = toast;

async function boot(): Promise<void> {
  shell();
  await seedIfEmpty();
  const router = new Router();
  router
    .on('/route', () => renderRoutePage(document.getElementById('view')!))
    .on('/box', () => renderBoxPage(document.getElementById('view')!, {}))
    .on('/box/:id', (p) => renderBoxPage(document.getElementById('view')!, p))
    .on('/bench', () => renderBenchPage(document.getElementById('view')!, {}))
    .on('/bench/:spliceId', (p) => renderBenchPage(document.getElementById('view')!, p))
    .on('/otdr', () => renderOtdrPage(document.getElementById('view')!))
    .on('/orders', () => renderOrdersPage(document.getElementById('view')!));
  router.start();
}

boot();
