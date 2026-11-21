// 熔接台仿真页：X/Y 双相机 WebGL2 光线追迹侧视图 + 对芯/放电动画 + 损耗对照
import { h, clear } from '../ui/dom';
import { get, put, uid, getAll } from '../data/db';
import type { DefectParams, FiberKind, LossRecord, Splice, WorkOrder } from '../types';
import { DEFAULT_DEFECTS, FIBER_PROFILES, LOSS_LIMIT_DB, cloneDefects } from '../data/fiber';
import { SpliceRenderer } from '../sim/renderer';
import { SpliceAnimation, PHASE_ORDER, PHASE_DURATIONS_MS } from '../sim/animation';
import { buildLossRecord, effectiveCoreOffset } from '../sim/loss';
import { defectControls, fiberSelect, lossPanel } from '../ui/benchControls';
import { go } from '../ui/router';

interface PageParams {
  spliceId?: string;
}

const PHASE_LABEL: Record<string, string> = {
  idle: '待开始', aligning: '马达对芯', prefusion: '预熔', discharging: '主放电', cooling: '冷却', done: '完成',
};

export async function renderBenchPage(view: HTMLElement, params: PageParams): Promise<void> {
  clear(view);
  const splicers = await getAll('splicers');
  let splice: Splice | null = null;
  let practice = false;
  if (params.spliceId) splice = (await get('splices', params.spliceId)) ?? null;
  if (!splice) {
    practice = true;
    splice = makePracticeSplice();
  }
  const working: Splice = JSON.parse(JSON.stringify(splice));
  let kindA: FiberKind = working.kindA;
  let kindB: FiberKind = working.kindB;
  const d: DefectParams = cloneDefects(working.defects);

  view.append(
    h('h2', { class: 'page-title' }, '熔接台 · 光线追迹成像仿真', practice ? h('span', { class: 'tag info' }, '练习模式（不入库）') : h('span', { class: 'tag violet' }, '接头档案模式')),
    h('p', { class: 'page-sub' },
      'X / Y 两路侧视图均由片元着色器逐光线 Snell 折射 + Fresnel 反射算出：中间亮纤芯线是纤芯柱透镜会聚，两侧暗边是包层棱镜偏转被远心孔径拦光，无贴图。调偏心量观察亮线位置与下方偏移损耗同步变化。'),
  );

  // —— 画布区 ——
  const canvasX = h('canvas', {}) as HTMLCanvasElement;
  const canvasY = h('canvas', {}) as HTMLCanvasElement;
  let rX: SpliceRenderer, rY: SpliceRenderer;
  try {
    rX = new SpliceRenderer(canvasX);
    rY = new SpliceRenderer(canvasY);
  } catch (e) {
    view.append(h('div', { class: 'card' }, `WebGL2 初始化失败：${(e as Error).message}`));
    return;
  }

  let zoom = 1;
  const baseUmPerPx = 0.55;
  const umPerPx = () => baseUmPerPx / zoom;

  const anim = new SpliceAnimation(d);
  const phaseBar = h('div', { class: 'phase-bar' });
  const arcStatus = h('div', { class: 'muted', style: 'font-size:12px' }, '放电状态：待机');

  function drawPhaseBar(phase: string): void {
    phaseBar.replaceChildren(...PHASE_ORDER.filter((p) => p !== 'idle').map((p) => {
      const idx = PHASE_ORDER.indexOf(p as never);
      const cur = PHASE_ORDER.indexOf(phase as never);
      const cls = idx < cur ? 'done' : idx === cur ? 'on' : '';
      return h('div', { class: `phase-step ${cls}` }, PHASE_LABEL[p]);
    }));
  }
  drawPhaseBar('idle');

  const viewBlock = (title: string, sub: string, canvas: HTMLCanvasElement) =>
    h('div', { class: 'bench-view' },
      h('div', { class: 'view-head' }, h('span', {}, title), h('span', {}, sub)),
      canvas,
    );

  const canvases = h('div', { class: 'bench-canvas-wrap' },
    viewBlock('X 方向侧视相机（看 Y 向偏心 / X 向切割角）', '照明→包层柱面→纤芯聚焦', canvasX),
    viewBlock('Y 方向侧视相机（看 X 向偏心 / Y 向切割角）', '正交 90° 第二路成像', canvasY),
  );

  // —— 损耗面板容器（参数变化即重算）——
  const lossHost = h('div', {});
  function currentLoss(): LossRecord {
    return buildLossRecord(kindA, kindB, d, working.id || uid('tmp'));
  }
  function refreshLoss(): void {
    lossHost.replaceChildren(lossPanel(kindA, kindB, d, currentLoss()));
  }

  // —— 渲染循环 ——
  let raf = 0;
  function frame(now: number): void {
    const sX = anim.buildScene(now, 0);
    const sY = anim.buildScene(now, 1);
    rX.render(sX, kindA, 0, umPerPx());
    rY.render(sY, kindB, 1, umPerPx());
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  anim.onTick = (s) => {
    drawPhaseBar(s.phase);
    const def = SpliceAnimation.arcDefects(d);
    arcStatus.innerHTML = '';
    arcStatus.append(
      h('span', {}, `阶段：${PHASE_LABEL[s.phase]}（${(s.phaseProgress * 100).toFixed(0)}%）　`),
      def.bubble > 0.35 ? h('span', { class: 'tag bad', style: 'margin-right:6px' }, `气泡风险 ${(def.bubble * 100).toFixed(0)}%`) : h('span', { class: 'tag ok', style: 'margin-right:6px' }, '无气泡'),
      def.neck > 0.35 ? h('span', { class: 'tag bad' }, `熔细风险 ${(def.neck * 100).toFixed(0)}%`) : h('span', { class: 'tag ok' }, '无熔细'),
    );
    if (s.phase === 'done') {
      window.toast('熔接完成，损耗对照已按最终几何参数更新', 'ok');
      refreshLoss();
    }
  };

  // —— 控制区 ——
  const spliceSel = h('select', {},
    ...splicers.map((p) => h('option', { value: p.id }, `${p.name}（${p.team}）`)),
  );
  spliceSel.value = working.splicerId || splicers[0]?.id || '';

  const controls = defectControls(d, () => refreshLoss());
  const kindASel = fiberSelect(kindA, (k) => { kindA = k; refreshLoss(); refreshProfile(); });
  const kindBSel = fiberSelect(kindB, (k) => { kindB = k; refreshLoss(); refreshProfile(); });

  const btnStart = h('button', { class: 'primary', onclick: () => anim.start(performance.now()) }, '开始熔接动画');
  const btnReset = h('button', { onclick: () => { anim.reset(); drawPhaseBar('idle'); refreshLoss(); } }, '复位');
  const btnSave = h('button', {
    onclick: async () => {
      const loss = currentLoss();
      working.defects = { ...d };
      working.kindA = kindA;
      working.kindB = kindB;
      working.splicerId = spliceSel.value;
      working.loss = loss;
      working.phase = anim.phase;
      working.updatedAt = Date.now();
      if (practice) {
        working.id = uid('spl');
        await put('splices', working);
        window.toast('练习接头已保存到档案', 'ok');
        go(`/bench/${working.id}`);
        return;
      }
      await put('splices', working);
      if (loss.simTotal >= LOSS_LIMIT_DB) await ensureReworkOrder(working);
      window.toast(loss.simTotal >= LOSS_LIMIT_DB ? '已保存，并自动生成返工单' : '接头档案已保存', loss.simTotal >= LOSS_LIMIT_DB ? 'bad' : 'ok');
    },
  }, practice ? '存入接头档案' : '保存接头档案');

  // 偏心可视化自检：读回画布像素，找亮纤芯线中心
  const eccReadout = h('div', { class: 'mono muted', style: 'font-size:12px' }, '偏心自检：—');
  const btnMeasure = h('button', {
    class: 'small',
    onclick: () => {
      // 取中部行亮度，加权质心即亮纤芯线位置
      const measure = (r: SpliceRenderer, name: string) => {
        const row = r.readRowBrightness(0.5);
        const w = row.length;
        let sum = 0, wsum = 0;
        for (let x = 0; x < w; x++) { sum += row[x] * x; wsum += row[x]; }
        const centroidX = sum / wsum;
        return { name, centroidX, w };
      };
      const mX = measure(rX, 'X相机');
      const mY = measure(rY, 'Y相机');
      const off = effectiveCoreOffset(d);
      eccReadout.textContent =
        `亮线质心 X相机 ${(mX.centroidX / mX.w).toFixed(4)}（归一化）｜Y相机 ${(mY.centroidX / mY.w).toFixed(4)}｜` +
        `物理偏心 d=${off.d.toFixed(2)}μm (X=${off.dx.toFixed(2)}, Y=${off.dy.toFixed(2)}) → 估算偏移损耗 ${currentLoss().simOffset.toFixed(3)}dB`;
    },
  }, '读像素自检偏心');

  const zoomSel = h('select', {
    onchange: (e: Event) => { zoom = Number((e.target as HTMLSelectElement).value); },
  }, ...[1, 2, 4].map((z) => h('option', { value: z }, `数字放大 ${z}×`)));

  const profileHost = h('div', {});
  function refreshProfile(): void {
    profileHost.replaceChildren(profileInfo(kindA, kindB));
  }

  refreshLoss();
  refreshProfile();

  view.append(
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('strong', {}, '熔接过程'),
        btnStart, btnReset,
        h('span', { class: 'spacer' }),
        h('label', { class: 'field', style: 'margin:0;min-width:180px' }, h('span', {}, '熔接员'), spliceSel),
        h('label', { class: 'field', style: 'margin:0;width:130px' }, h('span', {}, '放大'), zoomSel),
      ),
      phaseBar, arcStatus,
      canvases,
      h('div', { class: 'row', style: 'margin-top:8px' }, btnMeasure, eccReadout),
    ),
    h('div', { class: 'grid grid-2' },
      h('div', { class: 'card' },
        h('h3', {}, '缺陷与放电参数'),
        controls,
      ),
      h('div', { class: 'card' },
        h('h3', {}, '光纤折射率剖面（影响追迹与模场）'),
        h('label', { class: 'field' }, h('span', {}, 'A 端光纤'), kindASel),
        h('label', { class: 'field' }, h('span', {}, 'B 端光纤'), kindBSel),
        profileHost,
        h('hr', { class: 'sep' }),
        h('h3', {}, '损耗三列对照'),
        lossHost,
        h('div', { class: 'row', style: 'margin-top:10px' }, btnSave,
          practice ? '' : h('button', { onclick: () => go(`/box/${working.boxId}`) }, '返回接头盒')),
      ),
    ),
  );

  window.addEventListener('hashchange', function unload() {
    cancelAnimationFrame(raf);
    anim.stop();
    window.removeEventListener('hashchange', unload);
  }, { once: true });
}

function profileInfo(kindA: FiberKind, kindB: FiberKind): HTMLElement {
  const row = (k: FiberKind) => {
    const p = FIBER_PROFILES[k];
    return h('tr', {},
      h('td', {}, p.label),
      h('td', { class: 'mono' }, p.nCore.toFixed(4)),
      h('td', { class: 'mono' }, p.nClad.toFixed(4)),
      h('td', { class: 'mono' }, p.layerCount === 2 ? `阶跃+沟槽(n=${p.nInner})` : '普通阶跃'),
      h('td', { class: 'mono' }, `${p.mfd}μm`),
    );
  };
  return h('div', { class: 'table-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, ...['光纤', 'n纤芯', 'n包层', '剖面', 'MFD'].map((c) => h('th', {}, c)))),
      h('tbody', {}, row(kindA), row(kindB)),
    ),
  );
}

function makePracticeSplice(): Splice {
  return {
    id: '',
    boxId: '',
    trayId: '',
    fiberA: 'practice#0',
    fiberB: 'practice#0',
    method: 'direct',
    kindA: 'G652',
    kindB: 'G652',
    splicerId: '',
    defects: { ...DEFAULT_DEFECTS, gap: 10 },
    loss: buildLossRecord('G652', 'G652', DEFAULT_DEFECTS, 'practice'),
    phase: 'idle',
    updatedAt: Date.now(),
  };
}

async function ensureReworkOrder(s: Splice): Promise<void> {
  const orders = await getAll('orders');
  if (orders.some((o) => o.spliceId === s.id && o.status === 'open')) return;
  const order: WorkOrder = {
    id: uid('wo'),
    boxId: s.boxId,
    spliceId: s.id,
    splicerId: s.splicerId,
    kind: 'rework',
    reason: `仿真损耗 ${s.loss.simTotal.toFixed(3)}dB ≥ 阈值 ${LOSS_LIMIT_DB}dB，保存时自动生成`,
    status: 'open',
    createdAt: Date.now(),
  };
  await put('orders', order);
}
