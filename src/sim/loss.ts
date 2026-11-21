// 接头损耗估算：模场失配 / 横向偏移 / 轴向倾角 / 间隙
// 全部公式与侧视图几何参数共用同一组微米单位，保证图像与数值对得上
import type { DefectParams, FiberKind, LossRecord } from '../types';
import { FIBER_PROFILES, WAVELENGTH_NM } from '../data/fiber';

const LN10 = Math.LN10;
function dB(x: number): number {
  return -10 * Math.log10(x);
}

/** 模场失配损耗 dB（单模高斯近似） */
export function mfdMismatchLoss(kindA: FiberKind, kindB: FiberKind): number {
  const w1 = FIBER_PROFILES[kindA].mfd / 2; // 半径
  const w2 = FIBER_PROFILES[kindB].mfd / 2;
  if (Math.abs(w1 - w2) < 1e-6) return 0;
  const eta = (4 * w1 * w1 * w2 * w2) / (w1 * w1 + w2 * w2) ** 2;
  return Math.max(0, dB(eta));
}

/**
 * 横向偏移损耗 dB
 * 单模：L = 4.343 · 2d²/(w1²+w2²)，同纤即 4.343(d/w)²
 * 多模（50/125 阶跃）：L = -10log10[2/π(acos q - q√(1-q²))], q = d/(2a)
 */
export function offsetLoss(kindA: FiberKind, kindB: FiberKind, dUm: number): number {
  if (dUm <= 0) return 0;
  const pA = FIBER_PROFILES[kindA];
  const pB = FIBER_PROFILES[kindB];
  if (pA.multimode || pB.multimode) {
    const a = Math.min(pA.coreRadius, pB.coreRadius);
    const q = Math.min(0.9999, dUm / (2 * a));
    const eta = (2 / Math.PI) * (Math.acos(q) - q * Math.sqrt(1 - q * q));
    return Math.max(0, dB(Math.max(eta, 1e-9)));
  }
  const w1 = pA.mfd / 2;
  const w2 = pB.mfd / 2;
  return 4.343 * ((2 * dUm * dUm) / (w1 * w1 + w2 * w2));
}

/** 轴向倾角损耗 dB（单模），thetaDeg 为有效倾角（度） */
export function angleLoss(kindA: FiberKind, kindB: FiberKind, thetaDeg: number): number {
  const pA = FIBER_PROFILES[kindA];
  const pB = FIBER_PROFILES[kindB];
  if (pA.multimode || pB.multimode) {
    // 多模对角度不敏感，给一个很弱的经验项
    return 0.15 * thetaDeg * thetaDeg;
  }
  const w = (pA.mfd + pB.mfd) / 4; // 平均模场半径
  const n = (pA.nClad + pB.nClad) / 2;
  const lambda = WAVELENGTH_NM / 1000; // μm
  const theta = (thetaDeg * Math.PI) / 180;
  const v = (Math.PI * n * w * theta) / lambda;
  return 4.343 * v * v;
}

/** 端面间隙损耗 dB（单模，小间隙近似，典型 ~0.002dB/μm） */
export function gapLoss(kindA: FiberKind, kindB: FiberKind, gapUm: number): number {
  const pA = FIBER_PROFILES[kindA];
  if (pA.multimode) return 0.0015 * gapUm;
  const w = pA.mfd / 2;
  const lambda = WAVELENGTH_NM / 1000;
  // 远场衍射发散小间隙近似，系数按工程实测 0.0015~0.003 dB/μm 标定
  return Math.max(0, (4.343 * gapUm * lambda) / (6 * Math.PI * pA.nClad * w * w));
}

/** 缺陷参数 → 两纤芯在接头处的有效横向错位（μm） */
export function effectiveCoreOffset(d: DefectParams): { dx: number; dy: number; d: number } {
  const rad = (d.coreEccDir * Math.PI) / 180;
  // 熔接机按包层对芯：左纤纤芯相对包层轴偏心 coreEcc，右纤理想同心
  const dx = d.lateralX + d.coreEcc * Math.cos(rad);
  const dy = d.lateralY + d.coreEcc * Math.sin(rad);
  return { dx, dy, d: Math.hypot(dx, dy) };
}

/** 有效端面倾角（度），X/Y 两路切割角合成 */
export function effectiveAngle(d: DefectParams): number {
  return Math.hypot(d.cleaveAngleX, d.cleaveAngleY);
}

export interface SimLoss {
  simMfd: number;
  simOffset: number;
  simAngle: number;
  simGap: number;
  simTotal: number;
  effectiveOffset: number;
  effectiveAngle: number;
}

/** 仿真估算总损耗（小损耗线性相加） */
export function simulateLoss(kindA: FiberKind, kindB: FiberKind, d: DefectParams): SimLoss {
  const simMfd = mfdMismatchLoss(kindA, kindB);
  const { d: off } = effectiveCoreOffset(d);
  const simOffset = offsetLoss(kindA, kindB, off);
  const ang = effectiveAngle(d);
  const simAngle = angleLoss(kindA, kindB, ang);
  const simGap = gapLoss(kindA, kindB, d.gap);
  const simTotal = Math.max(0, simMfd + simOffset + simAngle + simGap);
  return { simMfd, simOffset, simAngle, simGap, simTotal, effectiveOffset: off, effectiveAngle: ang };
}

/** 确定性伪随机（按字符串种子），用于熔接机/OTDR 测量噪声 */
function seededNoise(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000 - 0.5; // -0.5~0.5
}

/**
 * 由仿真值生成三列对照数据
 * @param seed 接头 id，保证同一接头噪声稳定
 */
export function buildLossRecord(
  kindA: FiberKind,
  kindB: FiberKind,
  d: DefectParams,
  seed: string,
): LossRecord {
  const sim = simulateLoss(kindA, kindB, d);
  // 熔接机图像估算：带正偏置与小噪声，测不出真实 MFD 失配的全部细节
  const splicerShown = Math.max(
    0,
    sim.simTotal * 0.85 + 0.008 + seededNoise(seed + '#sp') * 0.012,
  );
  // 双向 OTDR：背向散射差异造成单向增益假象。
  // 理论方向项 20log(wA/wB) 偏大，工程实测同档光纤 MFD 差异带来的表观增益约 0.05~0.2dB，按 0.25 系数收敛
  const wA = FIBER_PROFILES[kindA].mfd / 2;
  const wB = FIBER_PROFILES[kindB].mfd / 2;
  const directional = 20 * Math.log10(wA / wB) * 0.25;
  const nA = seededNoise(seed + '#ab') * 0.02;
  const nB = seededNoise(seed + '#ba') * 0.02;
  const otdrAtoB = sim.simTotal + directional + nA;
  const otdrBtoA = sim.simTotal - directional + nB;
  const otdrAvg = (otdrAtoB + otdrBtoA) / 2;
  return {
    simMfd: round(sim.simMfd),
    simOffset: round(sim.simOffset),
    simAngle: round(sim.simAngle),
    simTotal: round(sim.simTotal),
    splicerShown: round(splicerShown),
    otdrAtoB: round(otdrAtoB),
    otdrBtoA: round(otdrBtoA),
    otdrAvg: round(otdrAvg),
    gainFlag: otdrAtoB < 0 || otdrBtoA < 0,
  };
}

export function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
