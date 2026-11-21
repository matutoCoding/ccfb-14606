// 首次启动写入演示数据：路由 / 接头盒 / 熔纤盘 / 熔接员 / 示例接头 / OTDR 曲线
import { getAll, getSetting, putMany, remove, setSetting, uid } from './db';
import type {
  CableSegment,
  JointBox,
  OtdrEvent,
  OtdrPoint,
  OtdrTrace,
  Route,
  RoutePoint,
  Splice,
  SpliceTray,
  Splicer,
  WorkOrder,
} from '../types';
import { DEFAULT_DEFECTS, LOSS_LIMIT_DB } from './fiber';
import { buildLossRecord } from '../sim/loss';

export async function seedIfEmpty(): Promise<void> {
  const seeded = await getSetting<boolean>('seeded', false);
  if (seeded) return;

  const splicers: Splicer[] = [
    { id: 'sp_li', name: '李建国', team: '熔接一班' },
    { id: 'sp_wang', name: '王海涛', team: '熔接一班' },
    { id: 'sp_zhao', name: '赵敏', team: '熔接二班' },
  ];

  // 路由：机房A → 井J1(接头盒) → 井J2(接头盒) → 机房B
  const route: Route = {
    id: 'rt_main',
    name: '城东主干环网 东环段',
    points: [
      { id: 'pt_a', routeId: 'rt_main', name: '城东机房 ODF-A', kind: 'endpoint', x: 60, y: 160 },
      { id: 'pt_j1', routeId: 'rt_main', name: '人井 J1（建国路）', kind: 'joint', boxId: 'bx_j1', x: 360, y: 110 },
      { id: 'pt_j2', routeId: 'rt_main', name: '人井 J2（滨河路）', kind: 'joint', boxId: 'bx_j2', x: 680, y: 180 },
      { id: 'pt_b', routeId: 'rt_main', name: '滨河机房 ODF-B', kind: 'endpoint', x: 960, y: 120 },
    ],
    segments: [],
  };

  const segDefs: Omit<CableSegment, 'routeId'>[] = [
    { id: 'sg_1', name: '段1 机房A→J1', fiberCount: 24, kind: 'G652', colorMode: '12', lengthM: 1850, reserveM: 40, ior: 1.4678, fromPoint: 'pt_a', toPoint: 'pt_j1' },
    { id: 'sg_2', name: '段2 J1→J2', fiberCount: 24, kind: 'G652', colorMode: '12', lengthM: 2620, reserveM: 55, ior: 1.4678, fromPoint: 'pt_j1', toPoint: 'pt_j2' },
    { id: 'sg_3', name: '段3 J2→机房B', fiberCount: 12, kind: 'G657', colorMode: '12', lengthM: 1340, reserveM: 30, ior: 1.4680, fromPoint: 'pt_j2', toPoint: 'pt_b' },
  ];
  const segments: CableSegment[] = segDefs.map((s) => ({ ...s, routeId: route.id }));
  route.segments = segments;

  const makeTrays = (boxId: string, count: number): SpliceTray[] =>
    Array.from({ length: count }, (_, i) => ({
      id: uid('tray'),
      boxId,
      index: i + 1,
      capacity: 12,
    }));

  const boxes: JointBox[] = [
    { id: 'bx_j1', routeId: route.id, name: 'J1 接头盒（48芯卧式）', pointId: 'pt_j1', trays: makeTrays('bx_j1', 2), leftSegmentId: 'sg_1', rightSegmentId: 'sg_2' },
    { id: 'bx_j2', routeId: route.id, name: 'J2 接头盒（24芯卧式）', pointId: 'pt_j2', trays: makeTrays('bx_j2', 2), leftSegmentId: 'sg_2', rightSegmentId: 'sg_3' },
  ];

  // 示例接头：J1 前 8 芯。以合格接头为主，仅 1.0μm 偏心样本超返工阈值
  const splices: Splice[] = [];
  const sampleDefects: Array<Partial<typeof DEFAULT_DEFECTS>> = [
    { coreEcc: 0, gap: 1, contamination: 0, cleaveAngleX: 0.1, cleaveAngleY: 0.1 },
    { coreEcc: 0.3, gap: 1, contamination: 0, cleaveAngleX: 0.15, cleaveAngleY: 0.1 },
    { coreEcc: 0.3, gap: 2, contamination: 0.15, cleaveAngleX: 0.2, cleaveAngleY: 0.15 },
    { coreEcc: 1.0, gap: 1, contamination: 0, cleaveAngleX: 0.1, cleaveAngleY: 0.1 }, // 超标：偏心 0.16dB
    { coreEcc: 0, gap: 2, contamination: 0.5, cleaveAngleX: 0.2, cleaveAngleY: 0.15 }, // 污染（图像可见，损耗合格）
    { coreEcc: 0.2, gap: 1, contamination: 0, cleaveAngleX: 0.1, cleaveAngleY: 0.1 },
    { coreEcc: 0.4, gap: 1, contamination: 0.1, arcCurrent: 0.82, cleaveAngleX: 0.15, cleaveAngleY: 0.1 },
    { coreEcc: 0, gap: 1, contamination: 0, arcCurrent: 1.28, arcTime: 2600, cleaveAngleX: 0.1, cleaveAngleY: 0.1 }, // 熔细（几何缺陷，损耗合格）
  ];
  const splicerIds = splicers.map((s) => s.id);
  sampleDefects.forEach((extra, i) => {
    const defects = { ...DEFAULT_DEFECTS, ...extra };
    const kindB = 'G652' as const;
    const loss = buildLossRecord('G652', kindB, defects, `seed_splice_${i}`);
    splices.push({
      id: uid('spl'),
      boxId: 'bx_j1',
      trayId: boxes[0].trays[0].id,
      fiberA: `sg_1#${i}`,
      fiberB: `sg_2#${i}`,
      method: i === 7 ? 'jumper' : 'direct',
      kindA: 'G652',
      kindB,
      splicerId: splicerIds[i % splicers.length],
      defects,
      loss,
      phase: 'done',
      updatedAt: Date.now() - (8 - i) * 3600_000,
    });
  });

  // 超标接头返工单
  const orders: WorkOrder[] = [];
  splices
    .filter((s) => s.loss.simTotal >= LOSS_LIMIT_DB)
    .forEach((s) => {
      orders.push({
        id: uid('wo'),
        boxId: s.boxId,
        spliceId: s.id,
        splicerId: s.splicerId,
        kind: 'rework',
        reason: `估算损耗 ${s.loss.simTotal.toFixed(3)}dB ≥ 阈值 ${LOSS_LIMIT_DB}dB，自动生成返工单`,
        status: 'open',
        createdAt: Date.now(),
      });
    });

  // 合成一条 A→B OTDR 曲线（瑞利背向散射线性下降 + 事件台阶 + 噪声）
  const points: OtdrPoint[] = [];
  const totalM = segments.reduce((a, s) => a + s.lengthM + s.reserveM, 0);
  const j1Dist = segments[0].lengthM + segments[0].reserveM;
  const j2Dist = j1Dist + segments[1].lengthM + segments[1].reserveM;
  const slope = 0.00019; // dB/m，1550nm 约 0.19dB/km
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed % 1000) / 1000 - 0.5;
  };
  const j1Loss = splices[3]?.loss.otdrAtoB ?? 0.18;
  const j2Loss = 0.06;
  for (let m = 0; m <= totalM; m += 8) {
    let p = -1.2 - slope * m;
    if (m >= j1Dist) p -= j1Loss;
    if (m >= j2Dist) p -= j2Loss;
    p += rand() * 0.012;
    points.push({ distanceM: m, powerDb: Math.round(p * 1000) / 1000 });
  }
  const events: OtdrEvent[] = [
    {
      id: uid('ev'), distanceM: j1Dist, type: 'splice', lossDb: splices[3]?.loss.otdrAvg ?? 0.16,
      lossAtoB: j1Loss, lossBtoA: splices[3]?.loss.otdrBtoA ?? 0.14, boxId: 'bx_j1', gainFlag: false, note: 'J1 第4芯（1μm偏心样本）',
    },
    {
      id: uid('ev'), distanceM: j2Dist, type: 'splice', lossDb: j2Loss,
      lossAtoB: j2Loss + 0.03, lossBtoA: j2Loss - 0.03, boxId: 'bx_j2', gainFlag: false, note: 'J2 成端接头',
    },
    {
      id: uid('ev'), distanceM: j2Dist + 620, type: 'bend', lossDb: 0.22,
      lossAtoB: 0.22, lossBtoA: 0.21, gainFlag: false, note: '盘留收紧宏弯',
    },
  ];
  const trace: OtdrTrace = {
    id: uid('tr'),
    name: '东环段 A→B 1550nm 竣工测试',
    routeId: route.id,
    segmentId: 'sg_2',
    direction: 'AtoB',
    wavelengthNm: 1550,
    ior: 1.4678,
    points,
    events,
    source: 'manual',
    importedAt: Date.now(),
  };

  await putMany('splicers', splicers);
  await putMany('routes', [route]);
  await putMany('boxes', boxes);
  await putMany('splices', splices);
  await putMany('orders', orders);
  await putMany('traces', [trace]);
  await setSetting('seeded', true);
}

export async function reseed(): Promise<void> {
  await setSetting('seeded', false);
  // 清库后重新播种
  const stores = ['routes', 'boxes', 'splices', 'splicers', 'orders', 'traces'] as const;
  for (const s of stores) {
    const rows = await getAll(s);
    for (const r of rows) {
      await remove(s, (r as { id: string }).id);
    }
  }
  await seedIfEmpty();
}
