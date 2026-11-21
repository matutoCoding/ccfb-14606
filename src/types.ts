// ====== 全局数据模型 ======

/** 光纤类型：决定折射率剖面与模场直径 */
export type FiberKind = 'G652' | 'G657' | 'MM50';

/** 接续方式 */
export type SpliceMethod = 'direct' | 'jumper'; // 直熔 | 跳接

/** 熔接阶段（熔接台动画状态机） */
export type SplicePhase =
  | 'idle' // 待开始
  | 'aligning' // 马达对芯
  | 'prefusion' // 预熔
  | 'discharging' // 主放电
  | 'cooling' // 冷却成型
  | 'done'; // 完成

/** 缺陷与几何参数（单位均为微米，角度为度） */
export interface DefectParams {
  cleaveAngleX: number; // 左纤 X 向切割角
  cleaveAngleY: number; // 左纤 Y 向切割角
  claddingDev: number; // 包层直径偏差（相对125μm的偏差量，左右对称施加）
  coreEcc: number; // 纤芯偏心量（模，0~3μm）
  coreEccDir: number; // 偏心方向角（度），0=沿X轴
  contamination: number; // 端面污染 0~1
  gap: number; // 端头间隙 μm
  lateralX: number; // 对芯横向偏移 X μm
  lateralY: number; // 对芯横向偏移 Y μm
  arcCurrent: number; // 放电电流（相对标准，0.6~1.4）
  arcTime: number; // 放电时间 ms
}

/** 仿真与实测损耗对照（dB） */
export interface LossRecord {
  simMfd: number; // 模场失配损耗
  simOffset: number; // 横向偏移损耗
  simAngle: number; // 轴向倾角损耗
  simTotal: number; // 估算总损耗
  splicerShown: number; // 熔接机显示值
  otdrAtoB: number; // OTDR A→B 单向
  otdrBtoA: number; // OTDR B→A 单向
  otdrAvg: number; // 双向平均
  gainFlag: boolean; // 是否出现单向增益假象
}

/** 一芯熔接记录 */
export interface Splice {
  id: string;
  boxId: string;
  trayId: string;
  fiberA: string; // 光缆段A内芯线全局编号（segmentId#fiberIndex）
  fiberB: string;
  method: SpliceMethod;
  kindA: FiberKind;
  kindB: FiberKind;
  splicerId: string; // 熔接员
  defects: DefectParams;
  loss: LossRecord;
  phase: SplicePhase;
  updatedAt: number;
}

/** 光缆段 */
export interface CableSegment {
  id: string;
  routeId: string;
  name: string;
  fiberCount: number; // 芯数
  kind: FiberKind;
  colorMode: '12'; // 十二色色谱
  lengthM: number; // 段长（米）
  reserveM: number; // 盘留余量（米）
  ior: number; // 折射率系数（OTDR测距用）
  fromPoint: string; // 接续点/端点 id
  toPoint: string;
}

/** 路由节点（端点或接续点） */
export interface RoutePoint {
  id: string;
  routeId: string;
  name: string;
  kind: 'endpoint' | 'joint';
  boxId?: string; // 接续点关联接头盒
  x: number; // 示意图坐标（归一化 0~1000）
  y: number;
}

export interface Route {
  id: string;
  name: string;
  points: RoutePoint[];
  segments: CableSegment[];
}

/** 熔纤盘 */
export interface SpliceTray {
  id: string;
  boxId: string;
  index: number; // 盘号
  capacity: number; // 每盘芯数（通常12/24）
}

export interface JointBox {
  id: string;
  routeId: string;
  name: string;
  pointId: string; // 路由上的接续点
  trays: SpliceTray[];
  leftSegmentId: string; // 进缆段
  rightSegmentId: string; // 出缆段
}

export interface Splicer {
  id: string;
  name: string;
  team: string;
}

export type WorkOrderStatus = 'open' | 'rework' | 'closed';

export interface WorkOrder {
  id: string;
  boxId: string;
  spliceId?: string; // 返工单关联具体接头；普通派工可为空
  splicerId: string;
  kind: 'assign' | 'rework';
  reason: string;
  status: WorkOrderStatus;
  createdAt: number;
  closedAt?: number;
}

/** OTDR 曲线点 */
export interface OtdrPoint {
  distanceM: number;
  powerDb: number;
}

export type OtdrEventType = 'splice' | 'bend' | 'break' | 'connector' | 'other';

export interface OtdrEvent {
  id: string;
  distanceM: number;
  type: OtdrEventType;
  lossDb: number; // 该事件损耗（双向平均后写入）
  lossAtoB: number;
  lossBtoA: number;
  boxId?: string; // 与接头盒距离核对
  note?: string;
  gainFlag: boolean;
}

export interface OtdrTrace {
  id: string;
  name: string;
  routeId: string;
  segmentId?: string;
  direction: 'AtoB' | 'BtoA' | 'bidirectional';
  wavelengthNm: number;
  ior: number;
  points: OtdrPoint[];
  events: OtdrEvent[];
  source: 'sor' | 'manual' | 'csv';
  importedAt: number;
}

export interface DBSchema {
  routes: Route[];
  boxes: JointBox[];
  splices: Splice[];
  splicers: Splicer[];
  orders: WorkOrder[];
  traces: OtdrTrace[];
  settings: { key: string; value: unknown }[];
}

export type StoreName = keyof DBSchema;
