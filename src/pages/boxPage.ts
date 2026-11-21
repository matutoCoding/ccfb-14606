// 接头盒页：按熔纤盘展示十二色色谱纤芯，拖拽建立熔接关系，直熔/跳接分标
import { h, clear, fmtDb } from '../ui/dom';
import { getAll, put, remove, uid } from '../data/db';
import type { CableSegment, FiberKind, JointBox, Splice, Splicer } from '../types';
import { CHROMATOGRAPHY_12, DEFAULT_DEFECTS, FIBER_PROFILES, LOSS_LIMIT_DB, colorCss, fiberColor } from '../data/fiber';
import { buildLossRecord } from '../sim/loss';
import { go } from '../ui/router';

interface PageParams {
  id?: string;
}

export async function renderBoxPage(view: HTMLElement, params: PageParams): Promise<void> {
  const [boxes, segments, splices, splicers] = await Promise.all([
    getAll('boxes'), getAll('routes').then((rs) => rs.flatMap((r) => r.segments)),
    getAll('splices'), getAll('splicers'),
  ]);
  clear(view);
  if (!boxes.length) {
    view.append(h('div', { class: 'card' }, '暂无接头盒，请先在光缆路由页新增接续点。'));
    return;
  }
  const box = boxes.find((b) => b.id === params.id) ?? boxes[0];
  const boxSplices = splices.filter((s) => s.boxId === box.id);
  let activeTray = box.trays[0]?.id ?? '';

  view.append(
    h('h2', { class: 'page-title' }, '接头盒 · ', box.name),
    h('p', { class: 'page-sub' }, '纤芯按十二色全色谱加色环显示；将右侧（出缆）纤芯拖到左侧（进缆）纤芯上建立熔接，点击接头可进入熔接台查看成像仿真。'),
  );

  const boxSelector = h('select', {
    onchange: (e: Event) => go(`/box/${(e.target as HTMLSelectElement).value}`),
  }, ...boxes.map((b) => h('option', { value: b.id }, b.name)));
  boxSelector.value = box.id;

  const segA = segments.find((s) => s.id === box.leftSegmentId);
  const segB = segments.find((s) => s.id === box.rightSegmentId);

  const body = h('div', {});
  view.append(
    h('div', { class: 'card row' },
      h('label', { class: 'field', style: 'margin:0;min-width:260px' }, h('span', {}, '切换接头盒'), boxSelector),
      h('div', {}, '进缆：', h('b', { class: 'mono' }, segA ? `${segA.name}（${segA.fiberCount}芯 ${FIBER_PROFILES[segA.kind].label}）` : '未配置')),
      h('div', {}, '出缆：', h('b', { class: 'mono' }, segB ? `${segB.name}（${segB.fiberCount}芯 ${FIBER_PROFILES[segB.kind].label}）` : '未配置')),
    ),
    body,
  );

  function fiberKey(segId: string, idx: number): string {
    return `${segId}#${idx}`;
  }
  function parseFiberKey(k: string): { segId: string; idx: number } {
    const [segId, idx] = k.split('#');
    return { segId, idx: Number(idx) };
  }

  function chip(seg: CableSegment | undefined, idx: number, side: 'A' | 'B', connectedKey?: string): HTMLElement {
    const color = fiberColor(idx);
    const ringColor = fiberColor(Math.floor(idx / 12)); // 超12芯用色环区分束管
    const el = h('div', {
      class: `fiber-chip ${connectedKey ? 'connected' : ''}`,
      draggable: side === 'B' ? 'true' : 'false',
      dataset: { fiber: seg ? fiberKey(seg.id, idx) : '', side },
    },
      h('div', { class: 'swatch', style: `background:${colorCss(color)}` }),
      h('div', { class: 'ring', style: `border-color:${colorCss(ringColor)};background:${idx >= 12 ? colorCss(color) : 'transparent'}` }),
      h('div', { style: 'flex:1' }, `#${idx + 1} ${colorName(idx)}${idx >= 12 ? `（环${Math.floor(idx / 12) + 1}）` : ''}`),
      connectedKey ? h('span', { class: 'tag info' }, '已接') : h('span', { class: 'muted' }, side === 'B' ? '可拖拽' : '拖放区'),
    );
    if (side === 'B') {
      el.addEventListener('dragstart', (e) => {
        (e as DragEvent).dataTransfer?.setData('text/plain', JSON.stringify({ from: (el as HTMLElement).dataset.fiber }));
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    } else {
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.style.outline = '1px dashed var(--accent)';
      });
      el.addEventListener('dragleave', () => (el.style.outline = ''));
      el.addEventListener('drop', async (e) => {
        e.preventDefault();
        el.style.outline = '';
        try {
          const data = JSON.parse((e as DragEvent).dataTransfer?.getData('text/plain') ?? '{}');
          if (!data.from) return;
          await createSplice((el as HTMLElement).dataset.fiber!, data.from);
        } catch {
          window.toast('拖放数据无效', 'bad');
        }
      });
    }
    return el;
  }

  async function createSplice(fiberA: string, fiberB: string): Promise<void> {
    if (!segA || !segB) {
      window.toast('该接头盒尚未配置进/出缆段', 'bad');
      return;
    }
    // 同芯位重复连接 → 覆盖
    const exist = boxSplices.find((s) => s.fiberA === fiberA || s.fiberB === fiberB);
    if (exist) {
      window.toast('该芯已存在熔接，请先删除旧接头', 'bad');
      return;
    }
    const splice: Splice = {
      id: uid('spl'),
      boxId: box.id,
      trayId: activeTray,
      fiberA,
      fiberB,
      method: 'direct',
      kindA: segA.kind,
      kindB: segB.kind,
      splicerId: splicers[0]?.id ?? '',
      defects: { ...DEFAULT_DEFECTS },
      loss: buildLossRecord(segA.kind, segB.kind, DEFAULT_DEFECTS, uid('spl')),
      phase: 'idle',
      updatedAt: Date.now(),
    };
    await put('splices', splice);
    window.toast(`已建立熔接 ${fiberA} ↔ ${fiberB}，默认直熔`, 'ok');
    renderBoxPage(view, { id: box.id });
  }

  function spliceRow(s: Splice): HTMLElement {
    const a = parseFiberKey(s.fiberA);
    const b = parseFiberKey(s.fiberB);
    const over = s.loss.simTotal >= LOSS_LIMIT_DB;
    return h('tr', { class: over ? 'event-row bad' : '' },
      h('td', { class: 'mono' }, `#${a.idx + 1} ${colorName(a.idx)}`),
      h('td', { style: 'text-align:center' }, s.method === 'direct'
        ? h('span', { class: 'tag info' }, '直熔')
        : h('span', { class: 'tag violet' }, '跳接')),
      h('td', { class: 'mono' }, `#${b.idx + 1} ${colorName(b.idx)}`),
      h('td', {}, splicers.find((p) => p.id === s.splicerId)?.name ?? '—'),
      h('td', { class: 'mono' }, fmtDb(s.loss.simTotal)),
      h('td', { class: 'mono' }, fmtDb(s.loss.splicerShown)),
      h('td', { class: 'mono' }, fmtDb(s.loss.otdrAvg)),
      h('td', {}, over ? h('span', { class: 'tag bad' }, '超标') : h('span', { class: 'tag ok' }, '合格')),
      h('td', {},
        h('button', { class: 'small primary', onclick: () => go(`/bench/${s.id}`), style: 'margin-right:5px' }, '熔接台'),
        h('button', {
          class: 'small',
          onclick: async () => {
            s.method = s.method === 'direct' ? 'jumper' : 'direct';
            await put('splices', s);
            renderBoxPage(view, { id: box.id });
          },
          style: 'margin-right:5px',
        }, '切换直熔/跳接'),
        h('button', {
          class: 'small danger',
          onclick: async () => {
            if (confirm('确认删除该熔接接头？')) {
              await remove('splices', s.id);
              renderBoxPage(view, { id: box.id });
            }
          },
        }, '删除'),
      ),
    );
  }

  function drawBody(): void {
    body.replaceChildren();
    const tray = box.trays.find((t) => t.id === activeTray) ?? box.trays[0];
    if (!tray) {
      body.append(h('div', { class: 'card' }, '该接头盒暂无熔纤盘。'));
      return;
    }
    const traySplices = boxSplices.filter((s) => s.trayId === tray.id);
    const cap = tray.capacity;
    const countA = Math.min(segA?.fiberCount ?? cap, cap);
    const countB = Math.min(segB?.fiberCount ?? cap, cap);

    const trayTabs = h('div', { class: 'row pill-nav' },
      ...box.trays.map((t) =>
        h('button', {
          class: `small ${t.id === activeTray ? 'primary' : ''}`,
          onclick: () => { activeTray = t.id; drawBody(); },
        }, `第 ${t.index} 盘`),
      ),
    );

    const leftCol = h('div', {},
      h('div', { class: 'muted', style: 'margin-bottom:6px' }, '进缆（A 端）', segA ? ` · ${segA.name}` : ''),
      ...Array.from({ length: countA }, (_, i) => {
        const key = segA ? fiberKey(segA.id, (tray.index - 1) * cap + i) : '';
        const used = traySplices.find((s) => s.fiberA.endsWith(`#${(tray.index - 1) * cap + i}`));
        return chip(segA, (tray.index - 1) * cap + i, 'A', used?.fiberA);
      }),
    );
    const rightCol = h('div', {},
      h('div', { class: 'muted', style: 'margin-bottom:6px' }, '出缆（B 端，拖向左侧）', segB ? ` · ${segB.name}` : ''),
      ...Array.from({ length: countB }, (_, i) => {
        const globalIdx = (tray.index - 1) * cap + i;
        const used = traySplices.find((s) => s.fiberB.endsWith(`#${globalIdx}`));
        return chip(segB, globalIdx, 'B', used?.fiberB);
      }),
    );

    const bodyRows: HTMLElement[] = traySplices.length
      ? traySplices.map(spliceRow)
      : [h('tr', {}, h('td', { colspan: '9', class: 'muted', style: 'text-align:center;padding:18px' }, '本盘暂无熔接，从右侧拖纤到左侧建立接头'))];

    body.append(
      h('div', { class: 'card' },
        h('h3', {}, '熔纤盘'),
        trayTabs,
        h('div', { class: 'grid grid-2', style: 'margin-top:10px' }, leftCol, rightCol),
      ),
      h('div', { class: 'card' },
        h('h3', {}, `第 ${tray.index} 盘熔接记录（${traySplices.length}/${cap} 芯）`),
        h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {},
              ...['A 端芯线', '接续', 'B 端芯线', '熔接员', '仿真损耗', '熔接机显示', 'OTDR均值', '判定', '操作'].map((c) => h('th', {}, c)),
            )),
            h('tbody', {}, ...bodyRows),
          ),
        ),
      ),
    );
  }
  drawBody();
}

function colorName(idx: number): string {
  return ['蓝', '橙', '绿', '棕', '灰', '白', '红', '黑', '黄', '紫', '粉', '青'][idx % 12];
}
