// 熔接机侧视光线追迹着色器（GLSL ES 3.00）
// 成像原理：远心照明 + 远心相机。对每个传感器像素反向追迹一条平行光，
// 穿过圆柱形包层/纤芯时按 Snell 定律折射、Fresnel 反射，
// 亮纤芯线 = 纤芯柱透镜会聚（出射光线雅可比收缩 → 辐照度升高），
// 两侧暗边 = 光线被圆柱棱镜偏转出远心孔径 + 辐照度展宽，
// 全部在片元着色器逐光线计算，无任何贴图。

export const VERT_SRC = `#version 300 es
layout(location=0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

// —— 场景几何（微米）——
uniform vec2  u_resolution;
uniform float u_umPerPixel;      // 微米/像素
uniform float u_leftOffset;      // 左纤包层轴在该视图的横向偏移
uniform float u_rightOffset;     // 右纤包层轴横向偏移
uniform float u_leftEcc;         // 左纤纤芯在该视图方向的偏心投影
uniform float u_rightEcc;
uniform float u_leftCladR;       // 左纤包层半径（含直径偏差）
uniform float u_rightCladR;
uniform float u_gap;             // 端头间隙
uniform float u_cleaveDeg;       // 该视图方向切割角（度）
uniform float u_contam;          // 污染 0~1
// —— 折射率剖面 ————
uniform float u_nClad;
uniform float u_nCore;
uniform float u_nInner;
uniform float u_coreR;
uniform float u_innerR;
uniform int   u_layerCount;      // 1=普通阶跃 2=沟槽双包层
uniform int   u_multimode;
// —— 放电/熔融 ————
uniform float u_arc;             // 电弧强度 0~1
uniform float u_neck;            // 熔细量 0~1
uniform float u_bubble;          // 气泡 0~1
uniform float u_fuse;            // 融合程度 0~1
uniform float u_brightness;

const float PI = 3.14159265359;
const float MAX_D = 1.0e6;
const float N_AIR = 1.000273;

// 端头局部熔细：越靠端面半径收缩越多
float tipScale(float x, bool inLeft) {
  float base = inLeft ? u_leftOffset : u_rightOffset;
  float endX = inLeft ? -u_gap * 0.5 * (1.0 - u_fuse) : u_gap * 0.5 * (1.0 - u_fuse);
  float d = inLeft ? (endX - x) : (x - endX);
  float zone = 24.0;
  if (d > zone || d < 0.0) return 1.0;
  float t = 1.0 - d / zone;
  return 1.0 - u_neck * 0.30 * t * t;
}

float leftEndX(float y) {
  // 融合后切割角消失，两端共面
  float c = tan(u_cleaveDeg * PI / 180.0);
  return -u_gap * 0.5 * (1.0 - u_fuse) + c * (1.0 - u_fuse) * (y - u_leftOffset);
}
float rightEndX(float y) {
  float c = tan(u_cleaveDeg * PI / 180.0);
  return u_gap * 0.5 * (1.0 - u_fuse) + c * (1.0 - u_fuse) * (y - u_rightOffset);
}

// 点 p 是否在玻璃内
bool insideFiber(vec2 p, out bool inLeft) {
  bool inL = p.x < 0.0 && abs(p.y - u_leftOffset) <= u_leftCladR * tipScale(p.x, true);
  bool inR = p.x >= 0.0 && abs(p.y - u_rightOffset) <= u_rightCladR * tipScale(p.x, false);
  if (!inL && !inR) { inLeft = true; return false; }
  inLeft = inL;
  if (inL) return p.x <= leftEndX(p.y);
  return p.x >= rightEndX(p.y);
}

float bubbleR() { return 6.0 * u_bubble + 1.2; }
vec2 bubbleC() { return vec2(0.0, (u_leftOffset + u_rightOffset) * 0.5); }

// 玻璃内某点折射率（含气泡空腔）
float iorAt(vec2 p, bool inLeft) {
  if (u_bubble > 0.001 && length(p - bubbleC()) < bubbleR()) return N_AIR;
  float axis = inLeft ? u_leftOffset : u_rightOffset;
  float ec = inLeft ? u_leftEcc : u_rightEcc;
  float rc = length(p - vec2(p.x, axis + ec));
  if (rc < u_coreR) return u_nCore;
  if (u_layerCount == 2 && rc < u_innerR) return u_nInner;
  return u_nClad;
}

// 最近界面距离；返回界面类型 0=包层外壁 1=纤芯 2=沟槽 3=端头 4=气泡
float hitInterface(vec2 ro, vec2 rd, bool inLeft, out int kind) {
  kind = 3;
  float best = MAX_D;
  float axis = inLeft ? u_leftOffset : u_rightOffset;
  float ec = inLeft ? u_leftEcc : u_rightEcc;
  float cr = inLeft ? u_leftCladR : u_rightCladR;

  // 通用圆求交
  // 包层外壁
  {
    vec2 o = ro - vec2(ro.x, axis);
    float b = dot(o, rd);
    float k = dot(o, o) - cr * cr;
    float disc = b * b - k;
    if (disc > 0.0) {
      float sq = sqrt(disc);
      float t1 = -b - sq, t2 = -b + sq;
      float t = t1 > 0.001 ? t1 : (t2 > 0.001 ? t2 : MAX_D);
      if (t < best) { best = t; kind = 0; }
    }
  }
  // 纤芯 / 沟槽
  for (int i = 0; i < 2; i++) {
    float rr = i == 0 ? u_coreR : u_innerR;
    if (i == 1 && u_layerCount != 2) continue;
    vec2 o = ro - vec2(ro.x, axis + ec);
    float b = dot(o, rd);
    float k = dot(o, o) - rr * rr;
    float disc = b * b - k;
    if (disc > 0.0) {
      float sq = sqrt(disc);
      float t1 = -b - sq, t2 = -b + sq;
      float t = t1 > 0.001 ? t1 : (t2 > 0.001 ? t2 : MAX_D);
      if (t < best) { best = t; kind = i == 0 ? 1 : 2; }
    }
  }
  // 端头平面（仅朝端头前进时）
  if (rd.x > 0.0001 && inLeft) {
    float t = (leftEndX(ro.y) - ro.x) / rd.x;
    if (t > 0.001 && t < best) { best = t; kind = 3; }
  }
  if (rd.x < -0.0001 && !inLeft) {
    float t = (rightEndX(ro.y) - ro.x) / rd.x;
    if (t > 0.001 && t < best) { best = t; kind = 3; }
  }
  // 气泡
  if (u_bubble > 0.001) {
    vec2 o = ro - bubbleC();
    float b = dot(o, rd);
    float k = dot(o, o) - bubbleR() * bubbleR();
    float disc = b * b - k;
    if (disc > 0.0) {
      float sq = sqrt(disc);
      float t1 = -b - sq, t2 = -b + sq;
      float t = t1 > 0.001 ? t1 : (t2 > 0.001 ? t2 : MAX_D);
      if (t < best) { best = t; kind = 4; }
    }
  }
  return best;
}

// 单条反向光线。返回相对透过率；exitY=出射到空气时的横向位置；
// coreCross=穿越纤芯次数；glassPath=玻璃内光程
float traceRay(vec2 ro, vec2 rd, out float exitY, out float coreCross,
               out float glassPath, out float bubbleCross) {
  exitY = ro.y;
  coreCross = 0.0;
  glassPath = 0.0;
  bubbleCross = 0.0;
  bool inLeft;
  if (!insideFiber(ro, inLeft)) return 1.0; // 未入纤：满照度

  float n1 = iorAt(ro, inLeft);
  float trans = 1.0;
  vec2 p = ro;
  vec2 d = rd;
  bool wasCore = false;

  for (int i = 0; i < 30; i++) {
    int kind;
    float t = hitInterface(p, d, inLeft, kind);
    if (t >= MAX_D * 0.5) { exitY = p.y; break; }
    vec2 pn = p + d * t;
    glassPath += t;

    // 界面法线
    vec2 normal;
    float axis = inLeft ? u_leftOffset : u_rightOffset;
    float ec = inLeft ? u_leftEcc : u_rightEcc;
    if (kind == 4) {
      normal = normalize(pn - bubbleC());
    } else if (kind == 3) {
      normal = vec2(inLeft ? 1.0 : -1.0, 0.0);
    } else if (kind == 0) {
      normal = normalize(vec2(pn.x, pn.y - axis));
    } else {
      normal = normalize(vec2(pn.x, pn.y - (axis + ec)));
    }
    if (dot(normal, d) > 0.0) normal = -normal;

    // 下一介质折射率
    float n2;
    if (kind == 4) {
      bool inBub = length(pn - bubbleC()) < bubbleR();
      n2 = inBub ? N_AIR : iorAt(pn + d * 0.02, inLeft);
      if (!inBub) bubbleCross += 1.0;
    } else if (kind == 3) {
      n2 = N_AIR;
    } else {
      bool nl;
      vec2 probe = pn + normal * 0.02;
      if (!insideFiber(probe, nl)) n2 = N_AIR;
      else { inLeft = nl; n2 = iorAt(probe, nl); }
    }

    float eta = n1 / n2;
    float cosi = -dot(d, normal);
    float sint2 = eta * eta * max(0.0, 1.0 - cosi * cosi);
    vec2 refr = refract(d, normal, eta);
    if (sint2 >= 1.0 || length(refr) < 0.01) {
      // 全反射
      d = reflect(d, normal);
      p = pn + d * 0.02;
      continue;
    }
    // Fresnel（s/p 平均）
    float cost = sqrt(max(0.0, 1.0 - sint2));
    float rs = (n1 * cosi - n2 * cost) / (n1 * cosi + n2 * cost);
    float rp = (n2 * cosi - n1 * cost) / (n2 * cosi + n1 * cost);
    float R = 0.5 * (rs * rs + rp * rp);
    trans *= max(0.0, 1.0 - R);

    // 纤芯穿越计数
    bool inCore = length(pn - vec2(pn.x, axis + ec)) < u_coreR && kind != 4;
    if (inCore && !wasCore) { coreCross += 1.0; wasCore = true; }
    if (!inCore) wasCore = false;

    d = refr;
    p = pn + d * 0.02;
    n1 = n2;
    if (n2 < 1.01) { exitY = p.y; break; } // 已出射到空气
    if (trans < 0.02) { exitY = p.y; break; }
  }
  return trans;
}

void main() {
  vec2 px = v_uv * u_resolution;
  float xUm = (px.x - u_resolution.x * 0.5) * u_umPerPixel;
  float yUm = (u_resolution.y * 0.5 - px.y) * u_umPerPixel;
  vec2 ro = vec2(xUm, yUm);
  vec2 rd = vec2(1.0, 0.0);

  float eps = max(u_umPerPixel * 0.5, 0.05);
  float ey0, cc0, gp0, bc0;
  float I0 = traceRay(ro, rd, ey0, cc0, gp0, bc0);
  float ey1, cc1, gp1, bc1;
  float I1 = traceRay(ro + vec2(0.0, eps), rd, ey1, cc1, gp1, bc1);

  // 辐照度雅可比：出射光线横向间距 / 入射间距。<1 会聚（亮），>1 发散（暗）
  bool inL0;
  bool inGlass = insideFiber(ro, inL0);
  vec3 col;
  vec3 bg = vec3(0.045, 0.055, 0.075);

  if (!inGlass) {
    col = bg;
  } else {
    // 雅可比在界面掠射处会出现极值，先做空间平滑再钳制，避免散粒噪声
    float jac = abs(ey1 - ey0) / eps;
    float jacS = clamp(jac, 0.35, 2.6);
    float flux = clamp(1.0 / jacS, 0.35, 2.2);
    // 远心孔径拦光：出射方向偏转越大越暗（圆柱棱镜两侧暗边）
    float deflect = abs((ey1 - ey0) - eps) / eps;
    float aperture = exp(-deflect * deflect * 7.0);
    float irradiance = clamp(I0 * flux * aperture, 0.0, 2.0);

    // 玻璃基底：中心略亮、靠包层外壁渐暗，把两侧暗边做实
    float axis = inL0 ? u_leftOffset : u_rightOffset;
    float ec = inL0 ? u_leftEcc : u_rightEcc;
    float cladR = inL0 ? u_leftCladR : u_rightCladR;
    float edgeT = clamp(abs(ro.y - axis) / cladR, 0.0, 1.0);
    float edgeShade = 1.0 - 0.55 * smoothstep(0.55, 1.0, edgeT);
    vec3 glass = vec3(0.24, 0.36, 0.47);
    float atten = exp(-gp0 * 0.0004);
    col = glass * (0.22 + 0.85 * irradiance) * edgeShade * atten;

    // 纤芯中心亮线：高 Δn 柱透镜聚焦（雅可比已贡献，再补模场高斯增强）
    float distCore = abs(ro.y - (axis + ec));
    float coreLine = exp(-(distCore * distCore) / (2.0 * u_coreR * u_coreR * 0.45));
    float dN = u_nCore - u_nClad;
    col *= 1.0 + coreLine * (u_multimode == 1 ? 0.55 : 1.25) * (0.5 + dN * 260.0);

    // G.657 沟槽暗环
    if (u_layerCount == 2) {
      float rc = length(ro - vec2(ro.x, axis + ec));
      float ring = smoothstep(u_coreR, u_coreR + 1.5, rc)
                 * (1.0 - smoothstep(u_innerR - 1.5, u_innerR, rc));
      col *= 1.0 - ring * 0.3;
    }
    // 端面污染：散射变暗 + 柔和颗粒（hash 做低频化处理）
    if (u_contam > 0.001) {
      float endD = inL0 ? abs(ro.x - leftEndX(ro.y)) : abs(ro.x - rightEndX(ro.y));
      float nearEnd = exp(-endD * 0.2);
      float g1 = fract(sin(dot(floor(ro * 0.8) + 0.5, vec2(12.9898, 78.233))) * 43758.5453);
      col *= 1.0 - u_contam * nearEnd * (0.35 + 0.3 * g1);
    }
    if (bc0 > 0.5) col *= 0.5;
  }

  // 电弧辉光
  if (u_arc > 0.001) {
    float endZone = exp(-abs(ro.x) * 0.16)
                  * exp(-(ro.y * ro.y) / (2.0 * 62.5 * 62.5 * 1.5));
    float flicker = 0.85 + 0.15 * fract(sin(dot(ro + u_arc * 60.0, vec2(3.1, 7.7))) * 1234.0);
    vec3 arcCol = mix(vec3(0.55, 0.78, 1.0), vec3(1.0, 0.6, 0.28), u_arc);
    col += arcCol * u_arc * endZone * 1.7 * flicker;
  }

  col *= u_brightness;
  col = pow(max(col, vec3(0.0)), vec3(0.85));
  outColor = vec4(col, 1.0);
}`;
