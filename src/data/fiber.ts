// 光纤光学参数、十二色色谱、缺陷默认值
import type { DefectParams, FiberKind } from '../types';

export const CLADDING_RADIUS_UM = 62.5; // 标准包层直径 125μm
export const WAVELENGTH_NM = 1550;

export interface FiberProfile {
  kind: FiberKind;
  label: string;
  /** 1550nm 附近包层折射率（石英玻璃） */
  nClad: number;
  /** 纤芯最大折射率（剖面中心） */
  nCore: number;
  /** 剖面层数（不含包层背景层）：2=阶跃双包层(G.657)，1=普通阶跃 */
  layerCount: number;
  /** 内层边界半径 μm（双包层的内包层/沟槽） */
  innerRadius: number;
  /** 内层折射率（G.657 沟槽为负Δ） */
  nInner: number;
  /** 纤芯半径 μm */
  coreRadius: number;
  /** 模场直径 μm（1550nm） */
  mfd: number;
  /** 多模阶跃纤芯半径（MM50 为 25μm） */
  multimode: boolean;
}

export const FIBER_PROFILES: Record<FiberKind, FiberProfile> = {
  // G.652D：标准阶跃单模，MFD≈10.4μm
  G652: {
    kind: 'G652',
    label: 'G.652D 标准单模',
    nClad: 1.4682,
    nCore: 1.4715,
    layerCount: 1,
    innerRadius: 0,
    nInner: 1.4682,
    coreRadius: 4.5,
    mfd: 10.4,
    multimode: false,
  },
  // G.657A2：弯曲不敏感，沟槽型双包层（凹陷包层）
  G657: {
    kind: 'G657',
    label: 'G.657A2 弯曲不敏感',
    nClad: 1.4682,
    nCore: 1.4720,
    layerCount: 2,
    innerRadius: 8.5,
    nInner: 1.4665, // 沟槽负 Δ
    coreRadius: 4.0,
    mfd: 9.6,
    multimode: false,
  },
  // 多模 50/125 阶跃近似
  MM50: {
    kind: 'MM50',
    label: 'OM4 多模 50/125',
    nClad: 1.4811,
    nCore: 1.4958,
    layerCount: 1,
    innerRadius: 0,
    nInner: 1.4811,
    coreRadius: 25,
    mfd: 50,
    multimode: true,
  },
};

/** 十二色全色谱（束管/纤芯通用），返回 [r,g,b] 0~255 */
export const CHROMATOGRAPHY_12: [number, number, number][] = [
  [0x1f, 0x6f, 0xeb], // 蓝
  [0xe8, 0x4d, 0x3d], // 橙
  [0x3a, 0x9e, 0x4f], // 绿
  [0x9b, 0x3d, 0xd9], // 棕
  [0x9d, 0xa3, 0xaf], // 灰
  [0xff, 0xff, 0xff], // 白
  [0xc0, 0x26, 0x26], // 红
  [0x111, 0x111, 0x111] as unknown as [number, number, number], // 黑（占位，下面修正）
  [0xe6, 0xb4, 0x22], // 黄
  [0xa1, 0x62, 0x07], // 紫
  [0xfb, 0xc7, 0xd4], // 粉红
  [0x06, 0xb6, 0xd4], // 青绿
];
CHROMATOGRAPHY_12[7] = [0x18, 0x18, 0x18];

export function fiberColor(index: number): [number, number, number] {
  return CHROMATOGRAPHY_12[((index % 12) + 12) % 12];
}

export function colorCss(c: [number, number, number]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export const DEFAULT_DEFECTS: DefectParams = {
  cleaveAngleX: 0.4,
  cleaveAngleY: 0.3,
  claddingDev: 0,
  coreEcc: 0,
  coreEccDir: 0,
  contamination: 0,
  gap: 8,
  lateralX: 0,
  lateralY: 0,
  arcCurrent: 1.0,
  arcTime: 1800,
};

/** 合格接头损耗阈值 dB，超过自动出返工单 */
export const LOSS_LIMIT_DB = 0.08;

export function cloneDefects(d: DefectParams): DefectParams {
  return { ...d };
}
