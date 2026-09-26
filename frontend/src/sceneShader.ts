// Shaders for the landing scene: the StillHere sensor (public/models/sensor.bin, built by
// scripts/build-model.mjs), lit like a product shot with shadows on a floor that matches the page.

// Shared by the shadow pass and the main pass so parts move identically in both.
const placeVertex = `
attribute vec4 position;
attribute vec4 normal;
attribute vec4 color;
uniform mat3 rotation;
uniform vec3 offsets[6];
// The whole sensor turns as one; each part then moves by its own world-space offset.
vec3 placed() {
  float layer = floor(color.a * 255.0 + 0.5);
  vec3 offset = offsets[0];
  for (int i = 1; i < 6; i++) if (float(i) == layer) offset = offsets[i];
  return rotation * position.xyz + offset;
}
`;

// Depth packed into RGBA so plain WebGL 1 can render a shadow map without extensions.
const unpackDepth = `
float unpackDepth(vec4 c) {
  return dot(c, vec4(1.0 / 16777216.0, 1.0 / 65536.0, 1.0 / 256.0, 1.0));
}
`;

const shadowLookup = `
uniform sampler2D shadowMap;
uniform float shadowTexel;
${unpackDepth}
float litFraction(vec4 shadowCoord, float bias) {
  vec3 s = shadowCoord.xyz / shadowCoord.w * 0.5 + 0.5;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return 1.0;
  float lit = 0.0;
  for (int x = -2; x <= 2; x++)
    for (int y = -2; y <= 2; y++)
      lit += step(s.z - bias, unpackDepth(texture2D(shadowMap, s.xy + vec2(x, y) * shadowTexel)));
  return lit / 25.0;
}
`;

export const depthVertexShader = `
${placeVertex}
uniform mat4 lightViewProjection;
void main() {
  gl_Position = lightViewProjection * vec4(placed(), 1.0);
}
`;

export const depthFragmentShader = `
precision highp float;
void main() {
  vec4 bits = fract(gl_FragCoord.z * vec4(16777216.0, 65536.0, 256.0, 1.0));
  bits -= bits.xxyz * vec4(0.0, 1.0 / 256.0, 1.0 / 256.0, 1.0 / 256.0);
  gl_FragColor = bits;
}
`;

export const meshVertexShader = `
${placeVertex}
uniform mat4 viewProjection;
uniform mat4 lightViewProjection;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
varying vec4 vShadow;
varying float vMaterial;
void main() {
  vec3 p = placed();
  vWorld = p;
  vNormal = rotation * normal.xyz;
  vMaterial = floor(normal.w * 127.0 + 0.5);
  vColor = color.rgb;
  vShadow = lightViewProjection * vec4(p, 1.0);
  gl_Position = viewProjection * vec4(p, 1.0);
}
`;

export const meshFragmentShader = `
precision highp float;
uniform vec3 eye;
uniform vec3 lightDir;
varying vec3 vNormal;
varying vec3 vColor;
varying vec3 vWorld;
varying vec4 vShadow;
varying float vMaterial;
${shadowLookup}

// A photo studio: soft ceiling, one large softbox, and a darker floor for reflections.
vec3 studio(vec3 r, float rough) {
  vec3 c = mix(vec3(0.5, 0.5, 0.48), vec3(1.0, 1.0, 0.98), smoothstep(-0.1, 0.8, r.y));
  vec2 d = (r.xz - vec2(-0.35, 0.35)) * 2.2;
  c += exp(-dot(d, d)) * step(0.0, r.y) * mix(2.6, 0.6, rough);
  return mix(c, vec3(0.3, 0.3, 0.28), smoothstep(0.0, -0.5, r.y));
}
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(eye - vWorld);
  if (dot(n, v) < 0.0) n = -n;
  float rough = 0.55;
  float metal = 0.0;
  if (vMaterial == 1.0) { rough = 0.32; metal = 1.0; }
  if (vMaterial == 2.0) rough = 0.3;
  if (vMaterial == 3.0) rough = 0.62;
  vec3 albedo = pow(vColor, vec3(2.2));
  vec3 f0 = mix(vec3(0.04), albedo, metal);

  // Cook-Torrance (GGX) for the key light.
  vec3 l = lightDir;
  vec3 h = normalize(l + v);
  float nl = max(dot(n, l), 0.0);
  float nv = max(dot(n, v), 0.001);
  float nh = max(dot(n, h), 0.0);
  float a2 = pow(rough, 4.0);
  float denom = nh * nh * (a2 - 1.0) + 1.0;
  float distribution = a2 / (3.14159 * denom * denom);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float geometry = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
  vec3 fresnel = f0 + (1.0 - f0) * pow(1.0 - max(dot(v, h), 0.0), 5.0);
  vec3 specular = distribution * geometry * fresnel / (4.0 * nl * nv + 0.001);
  vec3 diffuse = (1.0 - fresnel) * (1.0 - metal) * albedo / 3.14159;
  float lit = litFraction(vShadow, 0.0015 + 0.004 * (1.0 - nl));
  vec3 direct = (diffuse + specular) * nl * lit * 3.4;

  // Image-based fill from the studio, dimmed where the key light is blocked.
  vec3 fresnelView = f0 + (max(vec3(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0);
  vec3 sky = mix(vec3(0.3, 0.3, 0.28), vec3(0.9, 0.92, 0.95), n.y * 0.5 + 0.5);
  float occlusion = 0.6 + 0.4 * lit;
  vec3 ambient = ((1.0 - metal) * albedo * sky + fresnelView * studio(reflect(-v, n), rough) * 0.55);
  vec3 color = aces((direct + ambient * occlusion) * 1.15);
  gl_FragColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}
`;

export const floorVertexShader = `
attribute vec2 corner;
uniform mat4 viewProjection;
uniform mat4 lightViewProjection;
uniform float floorY;
uniform float size;
varying vec2 vCorner;
varying vec4 vShadow;
void main() {
  vCorner = corner;
  vec4 p = vec4(corner.x * size, floorY, corner.y * size, 1.0);
  vShadow = lightViewProjection * p;
  gl_Position = viewProjection * p;
}
`;

// The floor is invisible except for the shadows it catches, so it blends into the page.
export const floorFragmentShader = `
precision highp float;
uniform float contact;
uniform float castStrength;
varying vec2 vCorner;
varying vec4 vShadow;
${shadowLookup}
void main() {
  float falloff = exp(-dot(vCorner, vCorner) * 3.0);
  float castShadow = (1.0 - litFraction(vShadow, 0.002)) * castStrength;
  float ambient = exp(-dot(vCorner, vCorner) * 9.0) * contact;
  gl_FragColor = vec4(vec3(0.05, 0.08, 0.06), (castShadow + ambient) * falloff);
}
`;
