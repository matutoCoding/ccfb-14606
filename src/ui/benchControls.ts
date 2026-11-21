// 熔接台缺陷参数控件 + 三列损耗对照面板
import { h } from '../ui/dom';
import type { DefectParams, FiberKind, LossRecord } from '../types';
import { FIBER_PROFILES, LOSS_LIMIT_DB } from '../data/fiber';
import { effectiveAngle, effectiveCoreOffset, simulateLoss } from '../sim/loss';
import { fmtDb } from './dom';

export interface SliderSpec {
  key: keyof DefectParams;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint?: string;
}

export const DEFECT_SLIDERS: SliderSpec[] = [
  { key: 'coreEcc', label: '纤芯偏心量', min: 0, max: 3, step: 0.1, unit: 'μm', hint: '偏心方向决定 X/Y 两路可见分量' },
  { key: 'coreEccDir', label: '偏心方向角', min: 0, max: 360, step: 5, unit: '°' },
  { key: 'cleaveAngleX', label: 'X 向切割角', min: 0, max: 3, step: 0.1, unit: '°' },
  { key: 'cleaveAngleY', label: 'Y 向切割角', min: 0, max: 3, step: 0.1, unit: '°' },
  { key: 'claddingDev', label: '包层直径偏差', min: -3, max: 3, step: 0.1, unit: 'μm' },
  { key: 'lateralX', label: '对芯横向偏移 X', min: -5, max: 5, step: 0.1, unit: 'μm' },
  { key: 'lateralY', label: '对芯横向偏移 Y', min: -5, max: 5, step: 0.1, unit: 'μm' },
  { key: 'gap', label: '端头间隙', min: 0, max: 40, step: 1, unit: 'μm' },
  { key: 'contamination', label: '端面污染', min: 0, max: 1, step: 0.05, unit: '' },
  { key: 'arcCurrent', label: '放电电流(相对值)', min: 0.6, max: 1.4, step: 0.02, unit: '×', hint: '<0.88 易气泡，>1.12 易熔细' },
  { key: 'arcTime', label: '放电时间', min: 600, max: 3200, step: 50, unit: 'ms', hint: '<1200ms 虚熔，>2300ms 熔细' },
];

export function defectControls(d: DefectParams, onChange: () => void): HTMLElement {
  const rows = DEFECT_SLIDERS.map((spec) => {
    const out = h('output', {}, fmtSlider(d[spec.key], spec));
    const input = h('input', {
      type: 'range', min: spec.min, max: spec.max, step: spec.step, value: d[spec.key],
      oninput: () => {
        d[spec.key] = Number((input as HTMLInputElement).value);
        out.textContent = fmtSlider(d[spec.key], spec);
        onChange();
      },
    }) as HTMLInputElement;
    return h('label', { class: 'range-row', title: spec.hint ?? '' },
      h('span', {}, spec.label),
      input,
      out,
    );
  });
  return h('div', {}, ...rows);
}

function fmtSlider(v: number, spec: SliderSpec): string {
  const dec = spec.step < 1 ? (spec.step < 0.1 ? 2 : 1) : 0;
  return `${v.toFixed(dec)}${spec.unit}`;
}

export function fiberSelect(value: FiberKind, onChange: (k: FiberKind) => void): HTMLElement {
  const sel = h('select', { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value as FiberKind) },
    ...Object.values(FIBER_PROFILES).map((p) => h('option', { value: p.kind }, `${p.label}｜MFD ${p.mfd}μm｜芯径 ${p.coreRadius * 2}μm`)),
  );
  sel.value = value;
  return sel;
}

function lossClass(v: number): string {
  if (v >= LOSS_LIMIT_DB) return 'loss-col-bad';
  if (v >= LOSS_LIMIT_DB * 0.6) return 'loss-col-warn';
  return 'loss-col-good';
}

/** 三列对照：仿真估算 / 熔接机显示 / OTDR 实测（双向） */
export function lossPanel(kindA: FiberKind, kindB: FiberKind, d: DefectParams, loss: LossRecord): HTMLElement {
  const sim = simulateLoss(kindA, kindB, d);
  const off = effectiveCoreOffset(d);
  const ang = effectiveAngle(d);

  const cell = (title: string, v: number, cls = true) =>
    h('td', { class: `mono ${cls ? lossClass(v) : ''}`, title }, fmtDb(v));

  return h('div', {},
    h('div', { class: 'grid grid-4', style: 'margin-bottom:10px' },
      kpi('有效纤芯错位', `${off.d.toFixed(2)} μm`, `X ${off.dx.toFixed(2)} / Y ${off.dy.toFixed(2)}`),
      kpi('有效端面倾角', `${ang.toFixed(2)} °`, `切割角 X ${d.cleaveAngleX}° Y ${d.cleaveAngleY}°`),
      kpi('仿真总损耗', `${sim.simTotal.toFixed(3)} dB`, sim.simTotal >= LOSS_LIMIT_DB ? '超过返工阈值' : '合格范围'),
      kpi('返工阈值', `${LOSS_LIMIT_DB.toFixed(2)} dB`, '超标自动出返工单'),
    ),
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', {}, '模场失配'), h('th', {}, '横向偏移'), h('th', {}, '轴向倾角'), h('th', {}, '间隙项'),
          h('th', {}, '仿真合计'), h('th', {}, '熔接机显示'), h('th', {}, 'OTDR A→B'), h('th', {}, 'OTDR B→A'),
          h('th', {}, '双向平均'), h('th', {}, '增益假象'),
        )),
        h('tbody', {}, h('tr', {},
          cell('模场失配损耗', loss.simMfd, false),
          cell('横向偏移损耗', loss.simOffset),
          cell('轴向倾角损耗', loss.simAngle),
          cell('间隙损耗', Math.max(0, sim.simGap), false),
          cell('仿真估算总损耗', loss.simTotal),
          cell('熔接机屏幕显示值', loss.splicerShown),
          cell('OTDR A→B 单向', loss.otdrAtoB, !loss.gainFlag),
          cell('OTDR B→A 单向', loss.otdrBtoA, !loss.gainFlag),
          cell('双向测试平均值', loss.otdrAvg),
          h('td', {}, loss.gainFlag ? h('span', { class: 'tag bad' }, '单向增益/负值') : h('span', { class: 'tag ok' }, '正常')),
        )),
      ),
    ),
    h('p', { class: 'muted', style: 'margin:8px 0 0;font-size:12px' },
      '偏移损耗按高斯模场 4.343·2d²/(w₁²+w₂²) 计算：同纤 G.652 偏心 0.5μm≈0.040dB、1.0μm≈0.161dB，与侧视图亮纤芯线的偏移像素一一对应。'),
  );
}

function kpi(label: string, value: string, sub: string): HTMLElement {
  return h('div', { class: 'card', style: 'margin:0' },
    h('div', { class: 'kpi' }, value, h('small', {}, label)),
    h('div', { class: 'muted', style: 'font-size:11.5px' }, sub),
  );
}
