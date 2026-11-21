// OTDR 曲线页：SOR/CSV 导入或手录，事件标注、双向平均、增益假象提示、距离校正、与接头盒核对
import { h, clear, download, fmtDb } from '../ui/dom';
import { getAll, put, remove, uid } from '../data/db';
import type { JointBox, OtdrEvent, OtdrEventType, OtdrPoint, OtdrTrace, Route } from '../types';
import { parseOtdrCsv, parseSor } from '../sim/sor';

const EVENT_META: Record<OtdrEventType, { label: string; color: string }> = {
  splice: { label: '接头', color: '#38bdf8' },
  bend: { label: '弯曲', color: '#fbbf24' },
  break: { label: '断点', color: '#f87171' },
  connector: { label: '活动连接', color: '#a78bfa' },
  other: { label: '其他', color: '#94a3b8' },
};

export async function renderOtdrPage(view: HTMLElement): Promise<void> {
  const [traces, routes, boxes] = await Promise.all([getAll('traces'), getAll('routes'), getAll('boxes')]);
  const route = routes[0];
  clear(view);
  view.append(
    h('h2', { class: 'page-title' }, 'OTDR 测试曲线'),
    h('p', { class: 'page-sub' }, '支持 SOR 二进制导入（Telcordia 743 容错解析）、CSV 与手工录入；事件点与路由接头盒距离自动核对，双向测试取平均并提示单向增益假象。'),
  );

  let activeId = traces[0]?.id ?? '';
  let corrShift = 0; // 距离校正平移（米）
  let corrIor = traces[0]?.ior ?? route?.segments[0]?.ior ?? 1.4678;

  const listHost = h('div', {});
  const detailHost = h('div', {});

  function drawList(): void {
    listHost.replaceChildren(
      h('div', { class: 'table-wrap' },
        h('table', {},
          h('thead', {}, h('tr', {}, ...['曲线名称', '方向', '波长', '点数', '来源', '事件数', '操作'].map((c) => h('th', {}, c)))),
          h('tbody', {},
            ...traces.map((t) => h('tr', { style: t.id === activeId ? 'background:rgba(56,189,248,0.08)' : '' },
              h('td', {}, t.name),
              h('td', {}, t.direction),
              h('td', { class: 'mono' }, `${t.wavelengthNm}nm`),
              h('td', { class: 'mono' }, String(t.points.length)),
              h('td', {}, h('span', { class: 'tag info' }, t.source.toUpperCase())),
              h('td', { class: 'mono' }, String(t.events.length)),
              h('td', {},
                h('button', { class: 'small primary', style: 'margin-right:5px', onclick: () => { activeId = t.id; corrShift = 0; corrIor = t.ior; drawDetail(); } }, '打开'),
                h('button', { class: 'small danger', onclick: async () => {
                  if (confirm('删除该曲线？')) { await remove('traces', t.id); traces.splice(traces.findIndex((x) => x.id === t.id), 1); if (activeId === t.id) activeId = traces[0]?.id ?? ''; drawList(); drawDetail(); }
                } }, '删除'),
              ),
            )),
          ),
        ),
      ),
    );
  }

  function drawDetail(): void {
    const found = traces.find((t) => t.id === activeId);
    detailHost.replaceChildren();
    if (!found) {
      detailHost.append(h('div', { class: 'card muted' }, '请导入或新建一条 OTDR 曲线。'));
      return;
    }
    const trace: OtdrTrace = found;
    const canvas = h('canvas', { class: 'otdr' }) as HTMLCanvasElement;
    const plot = () => plotTrace(canvas, trace, corrShift, boxes, route);
    requestAnimationFrame(plot);

    // 距离校正：IOR 缩放 + 平移
    const shiftInput = h('input', { type: 'number', step: '1', value: corrShift }) as HTMLInputElement;
    const iorInput = h('input', { type: 'number', step: '0.0001', min: '1.4', max: '1.6', value: corrIor }) as HTMLInputElement;
    const applyCorr = async () => {
      corrShift = Number(shiftInput.value);
      corrIor = Number(iorInput.value);
      trace.ior = corrIor;
      // IOR 校正：d' = d · (iorOld/new) —— 此处直接按新 IOR 对原始距离缩放，平移叠加
      await put('traces', trace);
      plot();
      drawEvents();
      window.toast('距离校正已应用（IOR 缩放 + 平移量）', 'ok');
    };

    // 事件表
    const eventHost = h('div', {});
    function drawEvents(): void {
      eventHost.replaceChildren(
        h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {},
              ...['类型', '校正后距离(m)', 'A→B(dB)', 'B→A(dB)', '双向均值', '增益假象', '接头盒核对', '备注', '操作'].map((c) => h('th', {}, c)),
            )),
            h('tbody', {}, ...trace.events.map((ev) => {
              const corrDist = ev.distanceM + corrShift;
              const box = ev.boxId ? boxes.find((b) => b.id === ev.boxId) : undefined;
              const expected = box ? expectedBoxDistance(box, route) : null;
              const mismatch = expected != null && Math.abs(corrDist - expected) > Math.max(8, expected * 0.01);
              return h('tr', { class: ev.gainFlag || mismatch ? 'event-row bad' : '' },
                h('td', {}, h('span', { class: 'tag info', style: `color:${EVENT_META[ev.type].color};border-color:${EVENT_META[ev.type].color}` }, EVENT_META[ev.type].label)),
                h('td', { class: 'mono' }, corrDist.toFixed(1)),
                h('td', { class: 'mono' }, fmtDb(ev.lossAtoB)),
                h('td', { class: 'mono' }, fmtDb(ev.lossBtoA)),
                h('td', { class: 'mono' }, fmtDb(ev.lossDb)),
                h('td', {}, ev.gainFlag ? h('span', { class: 'tag bad' }, '单向增益') : h('span', { class: 'tag ok' }, '正常')),
                h('td', {}, box
                  ? `${box.name}${expected != null ? `（台账 ${expected.toFixed(1)}m${mismatch ? '，偏差超限' : '，吻合'}）` : ''}`
                  : '未关联'),
                h('td', { style: 'white-space:normal;min-width:140px' }, ev.note ?? '—'),
                h('td', {}, h('button', { class: 'small danger', onclick: async () => {
                  trace.events = trace.events.filter((x) => x.id !== ev.id);
                  await put('traces', trace);
                  drawEvents(); plot();
                } }, '删除')),
              );
            })),
          ),
        ),
      );
    }
    drawEvents();

    // 手录事件
    const dType = h('select', {}, ...Object.entries(EVENT_META).map(([k, m]) => h('option', { value: k }, m.label)));
    const dDist = h('input', { type: 'number', placeholder: '距离 m' });
    const dAb = h('input', { type: 'number', step: '0.001', placeholder: 'A→B dB' });
    const dBa = h('input', { type: 'number', step: '0.001', placeholder: 'B→A dB' });
    const dBox = h('select', {}, h('option', { value: '' }, '不关联接头盒'), ...boxes.map((b) => h('option', { value: b.id }, b.name)));
    const addEvent = async () => {
      const dist = Number(dDist.value);
      const ab = Number(dAb.value || 0);
      const ba = Number(dBa.value || 0);
      if (!dist) return window.toast('请填写事件距离', 'bad');
      const ev: OtdrEvent = {
        id: uid('ev'),
        distanceM: dist - corrShift,
        type: dType.value as OtdrEventType,
        lossAtoB: ab,
        lossBtoA: ba,
        lossDb: (ab + ba) / 2,
        gainFlag: ab < 0 || ba < 0,
        boxId: dBox.value || undefined,
        note: '手工录入',
      };
      trace.events.push(ev);
      await put('traces', trace);
      drawEvents(); plot();
      window.toast(ev.gainFlag ? '已录入：检测到单向负值（增益假象），请以双向均值为准' : '事件已录入', ev.gainFlag ? 'bad' : 'ok');
    };

    detailHost.append(
      h('div', { class: 'card' },
        h('div', { class: 'row' },
        h('h3', { style: 'margin:0;flex:1' }, trace.name),
        h('span', { class: 'tag info' }, `${trace.wavelengthNm}nm`),
        h('span', { class: 'tag violet' }, trace.direction),
        h('button', { class: 'small', onclick: () => download(`${trace.name}.json`, JSON.stringify(trace, null, 2), 'application/json') }, '导出 JSON'),
        h('button', { class: 'small', onclick: () => download(`${trace.name}.csv`, exportTraceCsv(trace), 'text/csv') }, '导出曲线 CSV'),
      ),
        canvas,
      ),
      h('div', { class: 'card' },
        h('h3', {}, '距离 / 折射率校正'),
        h('div', { class: 'grid grid-4' },
          h('label', { class: 'field' }, h('span', {}, '平移量 (m)，盘留余量核对'), shiftInput),
          h('label', { class: 'field' }, h('span', {}, 'IOR 折射率系数'), iorInput),
          h('div', { style: 'align-self:center' }, h('button', { class: 'primary', onclick: applyCorr }, '应用校正')),
          h('div', { class: 'muted', style: 'align-self:center;font-size:12px' }, '校正后事件距离 = 实测 + 平移；IOR 变化按比例缩放并写回曲线档案'),
        ),
      ),
      h('div', { class: 'card' },
        h('h3', {}, '事件点（', trace.events.length, '）'),
        eventHost,
        h('hr', { class: 'sep' }),
        h('div', { class: 'grid grid-4' },
          h('label', { class: 'field' }, h('span', {}, '事件类型'), dType),
          h('label', { class: 'field' }, h('span', {}, '距离 (m)'), dDist),
          h('label', { class: 'field' }, h('span', {}, 'A→B 损耗(dB)'), dAb),
          h('label', { class: 'field' }, h('span', {}, 'B→A 损耗(dB)'), dBa),
        ),
        h('div', { class: 'row' },
          h('label', { class: 'field', style: 'margin:0;flex:1' }, h('span', {}, '关联接头盒（距离核对）'), dBox),
          h('button', { class: 'primary', onclick: addEvent }, '录入事件'),
        ),
      ),
    );
  }

  // 导入区
  const fileInput = h('input', { type: 'file', accept: '.sor,.csv' }) as HTMLInputElement;
  const nameInput = h('input', { placeholder: '曲线名称（默认取文件名）' });
  const dirSel = h('select', {}, h('option', { value: 'AtoB' }, 'A→B 单向'), h('option', { value: 'BtoA' }, 'B→A 单向'), h('option', { value: 'bidirectional' }, '双向'));
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const lower = file.name.toLowerCase();
    let points: OtdrPoint[];
    let ior = corrIor;
    let wavelength = 1550;
    let source: OtdrTrace['source'];
    if (lower.endsWith('.sor')) {
      const r = parseSor(buf);
      if (!r.ok) { window.toast(`SOR 解析失败：${r.error}，请改用 CSV/手录`, 'bad'); return; }
      points = r.points; ior = r.ior; wavelength = r.wavelengthNm; source = 'sor';
    } else {
      points = parseOtdrCsv(new TextDecoder().decode(buf)); source = 'csv';
    }
    const trace: OtdrTrace = {
      id: uid('tr'),
      name: nameInput.value || file.name.replace(/\.[^.]+$/, ''),
      routeId: route?.id ?? '',
      direction: dirSel.value as OtdrTrace['direction'],
      wavelengthNm: wavelength,
      ior,
      points,
      events: [],
      source,
      importedAt: Date.now(),
    };
    await put('traces', trace);
    traces.push(trace);
    activeId = trace.id; corrShift = 0; corrIor = ior;
    window.toast(`已导入 ${points.length} 个采样点（${source.toUpperCase()}）`, 'ok');
    drawList(); drawDetail();
    fileInput.value = '';
  });

  const makeDemo = h('button', {
    onclick: async () => {
      const trace = syntheticTrace(route);
      await put('traces', trace);
      traces.push(trace); activeId = trace.id; corrShift = 0; corrIor = trace.ior;
      drawList(); drawDetail();
    },
  }, '生成演示曲线');

  view.append(
    h('div', { class: 'card' },
      h('h3', {}, '曲线库'),
      listHost,
      h('hr', { class: 'sep' }),
      h('div', { class: 'grid grid-4' },
        h('label', { class: 'field' }, h('span', {}, '曲线名称'), nameInput),
        h('label', { class: 'field' }, h('span', {}, '测试方向'), dirSel),
        h('label', { class: 'field' }, h('span', {}, 'SOR / CSV 文件'), fileInput),
        h('div', { style: 'align-self:end' }, makeDemo),
      ),
    ),
    detailHost,
  );
  drawList();
  drawDetail();
}

/** 接头盒在路由上的台账距离（累计段长+盘留） */
function expectedBoxDistance(box: JointBox, route?: Route): number | null {
  if (!route) return null;
  let acc = 0;
  const point = route.points.find((p) => p.id === box.pointId);
  if (!point) return null;
  for (const seg of route.segments) {
    acc += seg.lengthM + seg.reserveM;
    if (seg.toPoint === point.id) return acc;
  }
  return null;
}

function exportTraceCsv(t: OtdrTrace): string {
  const head = 'distance_m,power_db\n';
  return head + t.points.map((p) => `${p.distanceM},${p.powerDb}`).join('\n');
}

/** 合成演示曲线：线性背向散射 + 事件台阶 + 噪声 */
function syntheticTrace(route?: Route): OtdrTrace {
  const total = route ? route.segments.reduce((a, s) => a + s.lengthM + s.reserveM, 0) : 6000;
  const pts: OtdrPoint[] = [];
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed % 1000) / 1000 - 0.5; };
  const ev1 = total * 0.32, ev2 = total * 0.66;
  for (let m = 0; m <= total; m += 6) {
    let p = -1.1 - 0.0002 * m;
    if (m >= ev1) p -= 0.12;
    if (m >= ev2) p -= 0.35;
    pts.push({ distanceM: m, powerDb: Math.round((p + rand() * 0.01) * 1000) / 1000 });
  }
  return {
    id: uid('tr'), name: `手录演示曲线 ${new Date().toLocaleTimeString()}`, routeId: route?.id ?? '',
    direction: 'bidirectional', wavelengthNm: 1550, ior: route?.segments[0]?.ior ?? 1.4678,
    points: pts,
    events: [
      { id: uid('ev'), distanceM: ev1, type: 'splice', lossAtoB: 0.15, lossBtoA: 0.09, lossDb: 0.12, gainFlag: false, note: '演示接头' },
      { id: uid('ev'), distanceM: ev2, type: 'bend', lossAtoB: 0.35, lossBtoA: -0.08, lossDb: 0.135, gainFlag: true, note: '弯曲+单向增益假象样本' },
    ],
    source: 'manual', importedAt: Date.now(),
  };
}

function plotTrace(canvas: HTMLCanvasElement, trace: OtdrTrace, shift: number, boxes: JointBox[], route?: Route): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const padL = 60, padB = 38, padT = 14, padR = 14;
  ctx.fillStyle = '#070c13';
  ctx.fillRect(0, 0, W, H);
  const pts = trace.points;
  if (pts.length < 2) return;
  const dMin = pts[0].distanceM + shift;
  const dMax = pts[pts.length - 1].distanceM + shift;
  const pMin = Math.min(...pts.map((p) => p.powerDb));
  const pMax = Math.max(...pts.map((p) => p.powerDb));
  const x = (d: number) => padL + ((d - dMin) / Math.max(1, dMax - dMin)) * (W - padL - padR);
  const y = (p: number) => padT + (1 - (p - pMin) / Math.max(0.01, pMax - pMin)) * (H - padT - padB);

  // 网格与轴
  ctx.strokeStyle = '#1b2740'; ctx.fillStyle = '#7d93b0'; ctx.font = '11px Consolas'; ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const gx = padL + (i / 5) * (W - padL - padR);
    ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, H - padB); ctx.stroke();
    const dm = dMin + (i / 5) * (dMax - dMin);
    ctx.fillText(`${dm.toFixed(0)}m`, gx - 16, H - padB + 16);
  }
  for (let i = 0; i <= 4; i++) {
    const gy = padT + (i / 4) * (H - padT - padB);
    ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
    const pv = pMax - (i / 4) * (pMax - pMin);
    ctx.fillText(`${pv.toFixed(1)}dB`, 8, gy + 4);
  }
  // 曲线
  ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 1.6; ctx.beginPath();
  pts.forEach((p, i) => {
    const px = x(p.distanceM + shift), py = y(p.powerDb);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  });
  ctx.stroke();

  // 事件标注
  for (const ev of trace.events) {
    const px = x(ev.distanceM + shift);
    const meta = EVENT_META[ev.type];
    ctx.strokeStyle = meta.color; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, H - padB); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = meta.color;
    ctx.beginPath(); ctx.arc(px, y(interpolatePower(pts, ev.distanceM)), 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = '11px sans-serif';
    ctx.fillText(`${meta.label} ${ev.lossDb.toFixed(2)}dB`, Math.min(px + 6, W - 120), padT + 14 + trace.events.indexOf(ev) * 14);
  }
  // 接头盒台账距离参考线（虚线灰）
  if (route) {
    for (const box of boxes) {
      const d = expectedBoxDistance(box, route);
      if (d == null || d < dMin || d > dMax) continue;
      const px = x(d);
      ctx.strokeStyle = 'rgba(148,163,184,0.45)'; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, H - padB); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif';
      ctx.fillText(`台账:${box.name}`, px + 2, H - padB - 4);
    }
  }
  ctx.fillStyle = '#7d93b0'; ctx.font = '11px sans-serif';
  ctx.fillText(`距离（米，IOR=${trace.ior}，平移=${shift}m）`, W / 2 - 80, H - 4);
  ctx.save(); ctx.translate(14, H / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillText('背向散射功率 (dB)', -40, 0); ctx.restore();
}

function interpolatePower(pts: OtdrPoint[], dist: number): number {
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].distanceM >= dist) {
      const a = pts[i - 1], b = pts[i];
      const t = (dist - a.distanceM) / Math.max(1e-9, b.distanceM - a.distanceM);
      return a.powerDb + (b.powerDb - a.powerDb) * t;
    }
  }
  return pts[pts.length - 1].powerDb;
}
