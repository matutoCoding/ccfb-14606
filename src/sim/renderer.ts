// WebGL2 渲染器：编译光线追迹程序，向两个侧视画布上绘制
import { VERT_SRC, FRAG_SRC } from './shaders';
import type { FiberKind } from '../types';
import { FIBER_PROFILES } from '../data/fiber';

export interface ViewScene {
  leftOffset: number;
  rightOffset: number;
  leftEcc: number;
  rightEcc: number;
  leftCladR: number;
  rightCladR: number;
  gap: number;
  cleaveDeg: number;
  contam: number;
  arc: number;
  neck: number;
  bubble: number;
  fuse: number;
  brightness: number;
}

export const CLADDING_R = 62.5;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('着色器编译失败: ' + log);
  }
  return sh;
}

export class SpliceRenderer {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('程序链接失败: ' + gl.getProgramInfoLog(prog));
    }
    this.program = prog;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
    gl.useProgram(prog);
    const names = [
      'u_resolution', 'u_umPerPixel', 'u_viewMode', 'u_leftOffset', 'u_rightOffset',
      'u_leftEcc', 'u_rightEcc', 'u_leftCladR', 'u_rightCladR', 'u_gap', 'u_cleaveDeg',
      'u_contam', 'u_nClad', 'u_nCore', 'u_nInner', 'u_coreR', 'u_innerR',
      'u_layerCount', 'u_multimode', 'u_arc', 'u_neck', 'u_bubble', 'u_fuse', 'u_brightness',
    ];
    for (const n of names) this.uniforms[n] = gl.getUniformLocation(prog, n);
  }

  render(scene: ViewScene, kind: FiberKind, viewMode: 0 | 1, umPerPixel: number): void {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    const p = FIBER_PROFILES[kind];
    const u = (n: string) => this.uniforms[n];
    gl.uniform2f(u('u_resolution'), w, h);
    gl.uniform1f(u('u_umPerPixel'), umPerPixel / dpr);
    gl.uniform1i(u('u_viewMode'), viewMode);
    gl.uniform1f(u('u_leftOffset'), scene.leftOffset);
    gl.uniform1f(u('u_rightOffset'), scene.rightOffset);
    gl.uniform1f(u('u_leftEcc'), scene.leftEcc);
    gl.uniform1f(u('u_rightEcc'), scene.rightEcc);
    gl.uniform1f(u('u_leftCladR'), scene.leftCladR);
    gl.uniform1f(u('u_rightCladR'), scene.rightCladR);
    gl.uniform1f(u('u_gap'), scene.gap);
    gl.uniform1f(u('u_cleaveDeg'), scene.cleaveDeg);
    gl.uniform1f(u('u_contam'), scene.contam);
    gl.uniform1f(u('u_nClad'), p.nClad);
    gl.uniform1f(u('u_nCore'), p.nCore);
    gl.uniform1f(u('u_nInner'), p.nInner);
    gl.uniform1f(u('u_coreR'), p.coreRadius);
    gl.uniform1f(u('u_innerR'), p.innerRadius);
    gl.uniform1i(u('u_layerCount'), p.layerCount);
    gl.uniform1i(u('u_multimode'), p.multimode ? 1 : 0);
    gl.uniform1f(u('u_arc'), scene.arc);
    gl.uniform1f(u('u_neck'), scene.neck);
    gl.uniform1f(u('u_bubble'), scene.bubble);
    gl.uniform1f(u('u_fuse'), scene.fuse);
    gl.uniform1f(u('u_brightness'), scene.brightness);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** 读取某一行像素的亮度（用于自检偏心是否可见） */
  readRowBrightness(normalizedY: number): number[] {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const y = Math.floor((1 - normalizedY) * h);
    const data = new Uint8Array(w * 4);
    gl.readPixels(0, y, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const out: number[] = [];
    for (let x = 0; x < w; x++) out.push((data[x * 4] + data[x * 4 + 1] + data[x * 4 + 2]) / 3);
    return out;
  }
}
