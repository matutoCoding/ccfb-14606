// 工单统计页：按接头盒派工、超标自动返工单、熔接员平均损耗/返工率、成端表与测试记录导出
import { h, clear, download, fmtDate, fmtDb } from '../ui/dom';
import { getAll, put, remove, uid } from '../data/db';
import type { JointBox, Splice, Splicer, WorkOrder } from '../types';
import { FIBER_PROFILES, LOSS_LIMIT_DB } from '../data/fiber';
import { go } from '../ui/router';

export async function renderOrdersPage(view: HTMLElement): Promise<void> {
  const [orders, boxes, splices, splicers] = await Promise.all([
    getAll('orders'), getAll('boxes'), getAll('splices'), getAll('splicers'),
  ]);
  clear(view);
  view.append(
    h('h2', { class: 'page-title' }, '工单与质量统计'),
    h('p', { class: 'page-sub' }, `损耗 ≥ ${LOSS_LIMIT_DB}dB 的接头在熔接台保存时自动生成返工单；绩效按熔接员统计平均损耗与返工率，验收资料可导出成端表和测试记录。`),
  );

  // —— KPI ——
  const overCount = splices.filter((s) => s.loss.simTotal >= LOSS_LIMIT_DB).length;
  const avgLoss = splices.length ? splices.reduce((a, s) => a + s.loss.simTotal, 0) / splices.length : 0;
  const openRework = orders.filter((o) => o.kind === 'rework' && o.status === 'open').length;
  view.append(
    h('div', { class: 'grid grid-4' },
      kpi('接头总数', String(splices.length), '已熔接芯数'),
      kpi('平均仿真损耗', `${avgLoss.toFixed(3)} dB`, '全部接头算术平均'),
      kpi('超标接头', String(overCount), `阈值 ${LOSS_LIMIT_DB}dB`),
      kpi('待处理返工单', String(openRework), '自动 + 手工'),
    ),
  );

  // —— 派工 ——
  const boxSel = h('select', {}, ...boxes.map((b) => h('option', { value: b.id }, b.name)));
  const spSel = h('select', {}, ...splicers.map((p) => h('option', { value: p.id }, `${p.name}（${p.team}）`)));
  const reasonInput = h('input', { placeholder: '派工说明（可选）' });
  const createOrder = async (kind: WorkOrder['kind']) => {
    const order: WorkOrder = {
      id: uid('wo'),
      boxId: boxSel.value,
      splicerId: spSel.value,
      kind,
      reason: reasonInput.value || (kind === 'rework' ? '手工返工派工' : '接头盒熔接派工'),
      status: 'open',
      createdAt: Date.now(),
    };
    await put('orders', order);
    window.toast('工单已创建', 'ok');
    renderOrdersPage(view);
  };

  // —— 工单表 ——
  const orderTable = h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, ...['类型', '接头盒', '熔接员', '原因', '状态', '创建时间', '操作'].map((c) => h('th', {}, c)))),
      h('tbody', {}, ...orders.map((o) => {
        const box = boxes.find((b) => b.id === o.boxId);
        const sp = splicers.find((p) => p.id === o.splicerId);
        return h('tr', {},
          h('td', {}, o.kind === 'rework' ? h('span', { class: 'tag bad' }, '返工单') : h('span', { class: 'tag info' }, '派工单')),
          h('td', {}, box?.name ?? o.boxId),
          h('td', {}, sp?.name ?? '—'),
          h('td', { style: 'white-space:normal;min-width:200px' }, o.reason),
          h('td', {}, o.status === 'open' ? h('span', { class: 'tag warn' }, '待处理') : h('span', { class: 'tag ok' }, '已闭环')),
          h('td', { class: 'mono' }, fmtDate(o.createdAt)),
          h('td', {},
            o.status === 'open'
              ? h('button', {
                  class: 'small primary', style: 'margin-right:5px',
                  onclick: async () => {
                    o.status = 'closed'; o.closedAt = Date.now();
                    await put('orders', o); renderOrdersPage(view);
                  },
                }, '闭环')
              : '—',
            h('button', {
              class: 'small danger', style: 'margin-left:5px',
              onclick: async () => { if (confirm('删除该工单？')) { await remove('orders', o.id); renderOrdersPage(view); } },
            }, '删除'),
          ),
        );
      })),
    ),
  );

  // —— 熔接员绩效 ——
  const stats = splicers.map((p) => {
    const mine = splices.filter((s) => s.splicerId === p.id);
    const rework = mine.filter((s) => s.loss.simTotal >= LOSS_LIMIT_DB).length;
    const avg = mine.length ? mine.reduce((a, s) => a + s.loss.simTotal, 0) / mine.length : 0;
    const otdrAvg = mine.length ? mine.reduce((a, s) => a + s.loss.otdrAvg, 0) / mine.length : 0;
    return { p, count: mine.length, avg, rework, rate: mine.length ? rework / mine.length : 0, otdrAvg };
  });
  const statsTable = h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, ...['熔接员', '班组', '熔接芯数', '平均仿真损耗', '平均OTDR损耗', '返工数', '返工率'].map((c) => h('th', {}, c)))),
      h('tbody', {}, ...stats.map((r) => h('tr', {},
        h('td', {}, r.p.name),
        h('td', {}, r.p.team),
        h('td', { class: 'mono' }, String(r.count)),
        h('td', { class: `mono ${r.avg >= LOSS_LIMIT_DB ? 'loss-col-bad' : 'loss-col-good'}` }, fmtDb(r.avg)),
        h('td', { class: 'mono' }, fmtDb(r.otdrAvg)),
        h('td', { class: 'mono' }, String(r.rework)),
        h('td', {}, h('span', { class: `tag ${r.rate > 0.2 ? 'bad' : r.rate > 0 ? 'warn' : 'ok'}` }, (r.rate * 100).toFixed(1) + '%')),
      ))),
    ),
  );

  // —— 导出 ——
  const exportBox = h('select', {}, ...boxes.map((b) => h('option', { value: b.id }, b.name)));
  const exportTerm = h('button', { class: 'primary', onclick: () => downloadTermination(boxes.find((b) => b.id === exportBox.value)!, splices, splicers) }, '导出成端表 CSV');
  const exportTest = h('button', { class: 'primary', onclick: () => downloadTestRecords(splices, splicers) }, '导出全部损耗测试记录 CSV');

  view.append(
    h('div', { class: 'card' },
      h('h3', {}, '派工 / 返工'),
      h('div', { class: 'grid grid-4' },
        h('label', { class: 'field' }, h('span', {}, '接头盒'), boxSel),
        h('label', { class: 'field' }, h('span', {}, '指派熔接员'), spSel),
        h('label', { class: 'field' }, h('span', {}, '说明'), reasonInput),
        h('div', { class: 'row', style: 'align-self:end' },
          h('button', { onclick: () => createOrder('assign') }, '派工'),
          h('button', { class: 'danger', onclick: () => createOrder('rework') }, '开返工单'),
        ),
      ),
      orderTable,
    ),
    h('div', { class: 'card' },
      h('h3', {}, '熔接员质量绩效'),
      statsTable,
    ),
    h('div', { class: 'card' },
      h('h3', {}, '验收资料导出'),
      h('div', { class: 'row' },
        h('label', { class: 'field', style: 'margin:0;min-width:260px' }, h('span', {}, '选择接头盒'), exportBox),
        exportTerm, exportTest,
        h('span', { class: 'spacer' }),
        h('button', { onclick: () => go('/route') }, '返回路由'),
      ),
    ),
  );
}

function kpi(label: string, value: string, sub: string): HTMLElement {
  return h('div', { class: 'card', style: 'margin:0 0 14px' },
    h('div', { class: 'kpi' }, value, h('small', {}, label)),
    h('div', { class: 'muted', style: 'font-size:11.5px' }, sub),
  );
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

function downloadTermination(box: JointBox, splices: Splice[], splicers: Splicer[]): void {
  const rows: (string | number)[][] = [
    ['接头盒成端表', box.name],
    ['接头盒编号', box.id, '进缆段', box.leftSegmentId, '出缆段', box.rightSegmentId],
    [],
    ['序号', 'A端纤芯编号', 'B端纤芯编号', '接续方式', '光纤类型A', '光纤类型B', '熔接员', '仿真损耗dB', '熔接机显示dB', 'OTDR均值dB', '判定'],
  ];
  const mine = splices.filter((s) => s.boxId === box.id);
  mine.forEach((s, i) => {
    rows.push([
      i + 1, s.fiberA, s.fiberB, s.method === 'direct' ? '直熔' : '跳接',
      FIBER_PROFILES[s.kindA].label, FIBER_PROFILES[s.kindB].label,
      splicers.find((p) => p.id === s.splicerId)?.name ?? '',
      s.loss.simTotal, s.loss.splicerShown, s.loss.otdrAvg,
      s.loss.simTotal >= LOSS_LIMIT_DB ? '不合格-返工' : '合格',
    ]);
  });
  download(`${box.name}_成端表.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}

function downloadTestRecords(splices: Splice[], splicers: Splicer[]): void {
  const rows: (string | number)[][] = [[
    '接头ID', '接头盒', 'A纤芯', 'B纤芯', '模场失配dB', '偏移损耗dB', '倾角损耗dB',
    '仿真合计dB', '熔接机显示dB', 'OTDR A→B dB', 'OTDR B→A dB', '双向均值dB',
    '单向增益假象', '偏心μm', '切割角°', '熔接员', '更新时间',
  ]];
  for (const s of splices) {
    rows.push([
      s.id, s.boxId, s.fiberA, s.fiberB,
      s.loss.simMfd, s.loss.simOffset, s.loss.simAngle,
      s.loss.simTotal, s.loss.splicerShown, s.loss.otdrAtoB, s.loss.otdrBtoA, s.loss.otdrAvg,
      s.loss.gainFlag ? '是' : '否',
      s.defects.coreEcc, Math.hypot(s.defects.cleaveAngleX, s.defects.cleaveAngleY).toFixed(2),
      splicers.find((p) => p.id === s.splicerId)?.name ?? '',
      fmtDate(s.updatedAt),
    ]);
  }
  download(`损耗测试记录_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}
