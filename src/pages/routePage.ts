// 光缆路由页：按段录入芯数/色谱/接续点，SVG 线路示意图，点接续点进入接头盒
import { h, clear } from '../ui/dom';
import { getAll, put, uid } from '../data/db';
import type { CableSegment, JointBox, Route, RoutePoint, SpliceTray } from '../types';
import { go } from '../ui/router';
import { FIBER_PROFILES } from '../data/fiber';

export async function renderRoutePage(view: HTMLElement): Promise<void> {
  const [routes, boxes] = await Promise.all([getAll('routes'), getAll('boxes')]);
  const route = routes[0];
  if (!route) {
    clear(view);
    view.append(h('div', { class: 'card' }, '暂无路由数据，请点击右上角“重置演示数据”。'));
    return;
  }

  const wrap = h('div', {});
  clear(view);
  view.append(
    h('h2', { class: 'page-title' }, '光缆路由 · ', route.name),
    h('p', { class: 'page-sub' }, '按段录入芯数、色谱与接续点位置；点击示意图上的接续点可直接进入对应接头盒。'),
    wrap,
  );

  // —— SVG 示意图 ——
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'route-map');
  svg.setAttribute('viewBox', '0 0 1020 300');

  function drawMap(): void {
    svg.replaceChildren();
    // 光缆连线
    for (const seg of route.segments) {
      const a = route.points.find((p) => p.id === seg.fromPoint)!;
      const b = route.points.find((p) => p.id === seg.toPoint)!;
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      line.setAttribute('stroke', '#38bdf8');
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-dasharray', '2 0');
      svg.append(line);
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', String((a.x + b.x) / 2));
      label.setAttribute('y', String((a.y + b.y) / 2 - 12));
      label.setAttribute('class', 'seg-label');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = `${seg.name}｜${seg.fiberCount}芯｜${(seg.lengthM / 1000).toFixed(2)}km`;
      svg.append(label);
    }
    // 节点
    for (const pt of route.points) {
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', 'route-point');
      g.setAttribute('transform', `translate(${pt.x},${pt.y})`);
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('class', 'pt');
      c.setAttribute('r', pt.kind === 'joint' ? '11' : '8');
      c.setAttribute('fill', pt.kind === 'joint' ? '#fbbf24' : '#34d399');
      c.setAttribute('stroke', '#0d1117');
      c.setAttribute('stroke-width', '2');
      g.append(c);
      const t = document.createElementNS(svgNS, 'text');
      t.setAttribute('y', '32');
      t.setAttribute('text-anchor', 'middle');
      t.textContent = pt.name;
      g.append(t);
      if (pt.kind === 'joint' && pt.boxId) {
        g.style.cursor = 'pointer';
        g.addEventListener('click', () => go(`/box/${pt.boxId}`));
        const hint = document.createElementNS(svgNS, 'title');
        hint.textContent = '点击进入接头盒';
        g.append(hint);
      }
      svg.append(g);
    }
  }
  drawMap();

  // —— 段列表与编辑 ——
  const segTable = h('div', { class: 'table-wrap' });
  function drawSegTable(): void {
    segTable.replaceChildren(
      h('table', {},
        h('thead', {}, h('tr', {},
          ...['段名', '芯数', '色谱', '光纤类型', '长度(m)', '盘留(m)', 'IOR 折射率', '操作'].map((c) => h('th', {}, c)),
        )),
        h('tbody', {},
          ...route.segments.map((seg) =>
            h('tr', {},
              h('td', {}, seg.name),
              h('td', {}, String(seg.fiberCount)),
              h('td', {}, '十二色全色谱'),
              h('td', {}, FIBER_PROFILES[seg.kind].label),
              h('td', { class: 'mono' }, String(seg.lengthM)),
              h('td', { class: 'mono' }, String(seg.reserveM)),
              h('td', { class: 'mono' }, String(seg.ior)),
              h('td', {}, h('button', {
                class: 'small',
                onclick: () => editSegment(seg),
              }, '编辑')),
            ),
          ),
        ),
      ),
    );
  }

  function editSegment(seg: CableSegment): void {
    const fields: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    const mkNum = (label: string, key: keyof CableSegment, val: number) =>
      h('label', { class: 'field' }, h('span', {}, label), Object.assign(
        h('input', { type: 'number' }), { value: String(val), dataset: { key } },
      ));
    const dialog = h('div', { class: 'card', style: 'border-color:var(--accent)' },
      h('h3', {}, '编辑段：', seg.name),
      (() => {
        const fCount = h('input', { type: 'number', min: '4', max: '144', step: '4' });
        fCount.value = String(seg.fiberCount);
        const fLen = h('input', { type: 'number', min: '0' });
        fLen.value = String(seg.lengthM);
        const fRes = h('input', { type: 'number', min: '0' });
        fRes.value = String(seg.reserveM);
        const fIor = h('input', { type: 'number', step: '0.0001', min: '1.4', max: '1.6' });
        fIor.value = String(seg.ior);
        const fKind = h('select', {},
          ...Object.values(FIBER_PROFILES).map((p) => h('option', { value: p.kind }, p.label)),
        );
        fKind.value = seg.kind;
        fields.fCount = fCount; fields.fLen = fLen; fields.fRes = fRes; fields.fIor = fIor; fields.fKind = fKind;
        return h('div', { class: 'grid grid-3' },
          h('label', { class: 'field' }, h('span', {}, '芯数'), fCount),
          h('label', { class: 'field' }, h('span', {}, '段长 (m)'), fLen),
          h('label', { class: 'field' }, h('span', {}, '盘留余量 (m)'), fRes),
          h('label', { class: 'field' }, h('span', {}, '折射率系数 IOR'), fIor),
          h('label', { class: 'field' }, h('span', {}, '光纤类型'), fKind),
        );
      })(),
      h('div', { class: 'row' },
        h('button', {
          class: 'primary',
          onclick: async () => {
            seg.fiberCount = Number(fields.fCount.value);
            seg.lengthM = Number(fields.fLen.value);
            seg.reserveM = Number(fields.fRes.value);
            seg.ior = Number(fields.fIor.value);
            seg.kind = fields.fKind.value as CableSegment['kind'];
            await put('routes', route);
            window.toast('段信息已保存', 'ok');
            drawMap();
            drawSegTable();
            dialog.remove();
          },
        }, '保存'),
        h('button', { onclick: () => dialog.remove() }, '取消'),
      ),
    );
    wrap.append(dialog);
  }

  // —— 接续点管理（新增接续点并自动创建接头盒）——
  async function addJoint(): Promise<void> {
    const name = prompt('接续点名称（如：人井 J3）');
    if (!name) return;
    const idx = route.points.length - 1;
    const pt: RoutePoint = {
      id: uid('pt'), routeId: route.id, name, kind: 'joint',
      x: 120 + idx * 220, y: 150 + (idx % 2) * 60,
    };
    const boxId = uid('bx');
    pt.boxId = boxId;
    const trays: SpliceTray[] = Array.from({ length: 2 }, (_, i) => ({ id: uid('tray'), boxId, index: i + 1, capacity: 12 }));
    const box: JointBox = {
      id: boxId, routeId: route.id, name: `${name} 接头盒`, pointId: pt.id,
      trays, leftSegmentId: '', rightSegmentId: '',
    };
    route.points.splice(route.points.length - 1, 0, pt);
    await put('routes', route);
    await put('boxes', box);
    window.toast('已新增接续点与空接头盒，可在接头盒页配置进/出缆段', 'ok');
    renderRoutePage(view);
  }

  drawSegTable();
  wrap.append(
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('h3', { style: 'margin:0;flex:1' }, '线路示意图'),
        h('button', { class: 'small', onclick: addJoint }, '新增接续点'),
      ),
      svg,
    ),
    h('div', { class: 'card' },
      h('h3', {}, '光缆段台账（', route.segments.length, ' 段）'),
      segTable,
    ),
    h('div', { class: 'card' },
      h('h3', {}, '接续点与接头盒'),
      h('div', { class: 'table-wrap' },
        h('table', {},
          h('thead', {}, h('tr', {}, ...['接续点', '类型', '关联接头盒', '操作'].map((c) => h('th', {}, c)))),
          h('tbody', {}, ...route.points.map((pt) => {
            const box = boxes.find((b) => b.id === pt.boxId);
            return h('tr', {},
              h('td', {}, pt.name),
              h('td', {}, pt.kind === 'joint' ? h('span', { class: 'tag warn' }, '接续点') : h('span', { class: 'tag ok' }, '端点')),
              h('td', {}, box ? box.name : '—'),
              h('td', {}, box ? h('button', { class: 'small', onclick: () => go(`/box/${box.id}`) }, '进入接头盒') : '—'),
            );
          })),
        ),
      ),
    ),
  );
}
