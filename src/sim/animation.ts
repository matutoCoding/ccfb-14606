// 熔接过程动画引擎：对芯 → 预熔 → 主放电 → 冷却 → 完成
// 放电电流/时间异常直接决定气泡与熔细（熔细量参与侧视图几何）
import type { DefectParams, SplicePhase } from '../types';
import type { ViewScene } from './renderer';
import { CLADDING_R } from './renderer';

export const PHASE_DURATIONS_MS: Record<SplicePhase, number> = {
  idle: 0,
  aligning: 3200,
  prefusion: 700,
  discharging: 2200,
  cooling: 1200,
  done: 0,
};
export const PHASE_ORDER: SplicePhase[] = ['idle', 'aligning', 'prefusion', 'discharging', 'cooling', 'done'];

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}
function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

export interface AnimationState {
  phase: SplicePhase;
  phaseProgress: number; // 0~1
  running: boolean;
  bubble: boolean;
  neck: boolean;
}

export class SpliceAnimation {
  phase: SplicePhase = 'idle';
  private phaseStart = 0;
  running = false;
  onTick: ((s: AnimationState) => void) | null = null;
  private raf = 0;

  constructor(private d: DefectParams) {}

  start(now: number): void {
    this.phase = 'aligning';
    this.phaseStart = now;
    this.running = true;
    this.loop(now);
  }
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
  reset(): void {
    this.stop();
    this.phase = 'idle';
  }

  /** 放电参数缺陷判定（供工单/损耗页面复用） */
  static arcDefects(d: DefectParams): { bubble: number; neck: number } {
    // 电流过大或时间过长 → 熔细；电流过小或时间过短 → 气泡/虚熔
    const over = Math.max(0, d.arcCurrent - 1.12) * 2.2 + Math.max(0, d.arcTime - 2300) / 900;
    const under = Math.max(0, 0.88 - d.arcCurrent) * 2.6 + Math.max(0, 1200 - d.arcTime) / 700;
    const bubble = clamp01(under + d.contamination * 0.5);
    const neck = clamp01(over);
    return { bubble, neck };
  }

  private loop = (now: number): void => {
    if (!this.running) return;
    const dur = PHASE_DURATIONS_MS[this.phase];
    let p = dur > 0 ? clamp01((now - this.phaseStart) / dur) : 1;
    if (p >= 1 && this.phase !== 'done') {
      const idx = PHASE_ORDER.indexOf(this.phase);
      this.phase = PHASE_ORDER[Math.min(idx + 1, PHASE_ORDER.length - 1)];
      this.phaseStart = now;
      p = 0;
      if (this.phase === 'done') {
        this.running = false;
      }
    }
    const { bubble, neck } = SpliceAnimation.arcDefects(this.d);
    this.onTick?.({ phase: this.phase, phaseProgress: p, running: this.running, bubble: bubble > 0.35, neck: neck > 0.35 });
    if (this.running) this.raf = requestAnimationFrame(this.loop);
  };

  /** 由当前动画时刻生成两个相机共用的场景参数（viewMode 决定取 X 还是 Y 分量） */
  buildScene(now: number, viewMode: 0 | 1): ViewScene {
    const d = this.d;
    const p = this.phase === 'idle' ? 0 : clamp01((now - this.phaseStart) / PHASE_DURATIONS_MS[this.phase]);
    const { bubble: bubbleAmt, neck: neckAmt } = SpliceAnimation.arcDefects(d);
    const eccRad = (d.coreEccDir * Math.PI) / 180;
    // X 相机看到 Y 向分量；Y 相机看到 X 向分量
    const eccComp = viewMode === 0 ? d.coreEcc * Math.sin(eccRad) : d.coreEcc * Math.cos(eccRad);
    const latComp = viewMode === 0 ? d.lateralY : d.lateralX;
    const cleave = viewMode === 0 ? d.cleaveAngleX : d.cleaveAngleY;

    // 马达步进：左纤不动、右纤按包层对芯，步进式逼近目标（保留偏心造成的残余错位）
    const steps = 24;
    const alignP = this.phase === 'aligning' ? Math.floor(smooth(p) * steps) / steps : this.phase === 'idle' ? 0 : 1;
    const targetRight = latComp; // 对芯目标：消除包层横向偏移
    const startRight = latComp + 14; // 初始错开 14μm
    const rightOffset = startRight + (targetRight - startRight) * alignP;
    const leftOffset = 0;

    // 间隙与融合
    let gap = d.gap;
    let fuse = 0;
    let arc = 0;
    let neck = 0;
    let bubble = 0;
    if (this.phase === 'prefusion') {
      arc = 0.35 * smooth(p);
      gap = d.gap * (1 - 0.4 * smooth(p));
    } else if (this.phase === 'discharging') {
      arc = 0.35 + 0.65 * Math.min(1, d.arcCurrent) * (0.85 + 0.15 * Math.sin(now * 0.05));
      fuse = smooth(p);
      gap = d.gap * (1 - p);
      neck = neckAmt * smooth(p);
      bubble = bubbleAmt * smooth(Math.max(0, p - 0.25) / 0.75);
    } else if (this.phase === 'cooling' || this.phase === 'done') {
      arc = this.phase === 'cooling' ? 0.25 * (1 - p) : 0;
      fuse = 1;
      gap = 0;
      neck = neckAmt;
      bubble = bubbleAmt;
    }

    const radiusScale = 1 + d.claddingDev / (CLADDING_R * 2);
    return {
      leftOffset,
      rightOffset,
      leftEcc: eccComp,
      rightEcc: 0,
      leftCladR: CLADDING_R * radiusScale,
      rightCladR: CLADDING_R,
      gap,
      cleaveDeg: cleave * (1 - fuse),
      contam: d.contamination,
      arc,
      neck,
      bubble,
      fuse,
      brightness: 1.05,
    };
  }
}
