// OTDR SOR (Bellcore/Telcordia TRC-TSV-000743) 二进制解析（容错实现）
// 结构：name map（块名→文件偏移）→ 各数据块。本模块只取曲线点、波长、IOR、事件表所需基础信息，
// 未知字段一律跳过；解析失败时由上层回退到手录/CSV。
import type { OtdrPoint } from '../types';

export interface SorResult {
  points: OtdrPoint[];
  wavelengthNm: number;
  ior: number;
  rangeM: number;
  ok: boolean;
  error?: string;
}

const DECODER = new TextDecoder('latin1');

function readCString(view: DataView, off: number, max = 64): string {
  let s = '';
  for (let i = 0; i < max; i++) {
    const c = view.getUint8(off + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

/** 解析 name map：返回 块名 → 绝对偏移 */
function parseMap(view: DataView): Map<string, number> {
  const map = new Map<string, number>();
  // map 头：签名 "Map" + 版本串 + 块数(int32 LE)
  let off = 0;
  const sig = readCString(view, 0, 3);
  if (sig !== 'Map') return map;
  off = 12; // 跳过 Map 名称与版本串的常见首部（不同厂商略有差异，下面做容错扫描）
  // 容错：直接扫描已知块名出现位置
  const known = ['Map', 'GenParams', 'SupParams', 'FxdParams', 'KeyEvents', 'LnkParams', 'DataPts', 'Cksum'];
  for (const name of known) {
    const bytes = name.split('').map((c) => c.charCodeAt(0));
    outer: for (let pos = 0; pos + bytes.length + 8 < view.buffer.byteLength; pos++) {
      for (let i = 0; i < bytes.length; i++) {
        if (view.getUint8(pos + i) !== bytes[i]) continue outer;
      }
      if (view.getUint8(pos + bytes.length) !== 0) continue;
      // 名称后通常紧跟版本串(2字节长度+内容)，再 int32 块大小；块起始即名称位置
      map.set(name, pos);
      break;
    }
  }
  return map;
}

/** 在 FxdParams 块内扫描 IOR、波长与量程（字段位置随厂商变化，按值域特征识别） */
function parseFxdParams(view: DataView, start: number, size: number): { ior: number; wavelength: number; rangeM: number } {
  const end = Math.min(view.buffer.byteLength, start + Math.max(size, 4096));
  let ior = 1.4677;
  let wavelength = 1550;
  let rangeM = 0;
  // 跳过块名/版本串
  let p = start;
  while (view.getUint8(p) !== 0) p++;
  p++;
  while (view.getUint8(p) !== 0) p++;
  p++;
  for (let q = p; q + 4 <= end; q += 4) {
    const f = view.getFloat32(q, true);
    if (f > 1.45 && f < 1.55) { ior = f; break; }
  }
  for (let q = p; q + 2 <= end; q += 2) {
    const u = view.getUint16(q, true);
    if ([850, 1300, 1310, 1490, 1550, 1625].includes(u)) { wavelength = u; break; }
  }
  // 量程通常在前 256 字节内，避免扫到数据区误判
  for (let q = p; q + 4 <= Math.min(end, start + 256); q += 4) {
    const u = view.getUint32(q, true);
    if (u >= 500 && u <= 100000) { rangeM = u; break; }
  }
  return { ior, wavelength, rangeM };
}

/** 解析 DataPts：块名(含\\0)+版本串(含\\0) 后为 hdrLen(int32) + N(int32) + N 个 ushort 反射值 */
function parseDataPts(view: DataView, start: number, ior: number, rangeM: number): OtdrPoint[] {
  const points: OtdrPoint[] = [];
  // 跳过块名与版本两个 NUL 结尾串
  let p = start;
  while (view.getUint8(p) !== 0) p++;
  p++;
  while (view.getUint8(p) !== 0) p++;
  p++;
  const hdrLen = view.getInt32(p, true);
  p += 4;
  const n = view.getInt32(p, true);
  p += 4;
  if (n <= 0 || n > 200000) throw new Error('DataPts 点数异常');
  // hdrLen>0 时数据数组在固定头之后；为 0/异常时数据紧随 N 字段
  if (hdrLen > 0 && hdrLen < 256) p = start + (p - start) + hdrLen - 8;
  const values: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    values[i] = view.getUint16(p, true);
    p += 2;
  }
  const spacingM = (rangeM || 5000) / n;
  const maxVal = Math.max(...values.slice(0, Math.min(n, 4000)), 1);
  for (let i = 0; i < n; i++) {
    const distanceM = Math.round(spacingM * i * 10) / 10;
    // 反射原始值 → dB（相对满量程），按 65535 映射 -65dB 动态范围
    const powerDb = Math.round(-65 * (1 - values[i] / maxVal) * 1000) / 1000;
    points.push({ distanceM, powerDb });
  }
  return points;
}

export function parseSor(buffer: ArrayBuffer): SorResult {
  try {
    const view = new DataView(buffer);
    if (buffer.byteLength < 128) return { points: [], wavelengthNm: 1550, ior: 1.4677, rangeM: 0, ok: false, error: '文件过小，不是有效 SOR' };
    const map = parseMap(view);
    const fxdStart = map.get('FxdParams') ?? 0;
    const { ior, wavelength, rangeM } = fxdStart ? parseFxdParams(view, fxdStart, 4096) : { ior: 1.4677, wavelength: 1550, rangeM: 0 };
    const dataStart = map.get('DataPts');
    if (!dataStart) return { points: [], wavelengthNm: wavelength, ior, rangeM, ok: false, error: '未找到 DataPts 块，请改用 CSV 或手录' };
    const points = parseDataPts(view, dataStart, ior, rangeM || 5000);
    if (points.length < 10) throw new Error('解析出的曲线点不足');
    return { points, wavelengthNm: wavelength, ior, rangeM, ok: true };
  } catch (e) {
    return { points: [], wavelengthNm: 1550, ior: 1.4677, rangeM: 0, ok: false, error: (e as Error).message };
  }
}

/** 简易 CSV：distance,power 两列 */
export function parseOtdrCsv(text: string): OtdrPoint[] {
  const pts: OtdrPoint[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/(-?\d+(?:\.\d+)?)\s*[,\t;]\s*(-?\d+(?:\.\d+)?)/);
    if (m) pts.push({ distanceM: Number(m[1]), powerDb: Number(m[2]) });
  }
  if (pts.length < 5) throw new Error('CSV 至少需要 distance,power 两列数据');
  return pts.sort((a, b) => a.distanceM - b.distanceM);
}
