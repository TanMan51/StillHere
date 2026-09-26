// Original procedural snow scene. No downloaded models, textures, or rendering libraries.
export const vertexShader = `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

export const fragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform vec2 pointer;
uniform float time;
uniform float darkStage;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float terrain(vec2 p) {
  float n = noise(p*.24)*1.7 + noise(p*.65)*.5 + noise(p*1.7)*.12;
  return -.3 + n * smoothstep(2.2, 8.0, length(p));
}
float box(vec3 p, vec3 b, float r) {
  vec3 q = abs(p)-b+r;
  return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0)-r;
}
mat2 rot(float a) { return mat2(cos(a),-sin(a),sin(a),cos(a)); }
vec2 scene(vec3 p) {
  vec2 result = vec2(100.0,1.0);
  if(darkStage < .5) result = vec2((p.y-terrain(p.xz))*.65, 1.0);
  vec3 q = p-vec3(0,.98,0);
  float outer = box(q, vec3(1.34,1.15,1.1), .085);
  float inner = box(q-vec3(0,-.02,.15), vec3(1.06,.9,1.2), .035);
  float walls = max(outer,-inner);
  // Courses of translucent blocks, with luminous seams.
  float seam = abs(mod(p.y+.04,.43)-.215)-.019;
  walls = max(walls,-seam);
  float blocks = abs(mod(p.x + floor(p.y/.43)*.38,.76)-.38)-.012;
  walls = max(walls,-blocks);
  float plinth = box(p-vec3(0,-.1,0),vec3(1.5,.13,1.28),.07);
  float frame = min(walls,plinth);
  vec3 left = p-vec3(-.74,2.35,0); left.xy=rot(.53)*left.xy;
  vec3 right = p-vec3(.74,2.35,0); right.xy=rot(-.53)*right.xy;
  float roof = min(box(left,vec3(.93,.105,1.22),.055),box(right,vec3(.93,.105,1.22),.055));
  frame=min(frame,roof);
  if(frame<result.x) result=vec2(frame,2.0);
  float glass = box(p-vec3(0,1.0,-.66),vec3(1.05,.9,.025),.015);
  if(glass<result.x) result=vec2(glass,3.0);
  float pedestal = box(p-vec3(0,.08,.08),vec3(.48,.08,.48),.06);
  if(pedestal<result.x) result=vec2(pedestal,2.0);
  float sensor = box(p-vec3(0,.92,.16),vec3(.33,.45,.11),.09);
  if(sensor<result.x) result=vec2(sensor,4.0);
  float led = length(p-vec3(0,1.11,.276))-.026;
  if(led<result.x) result=vec2(led,3.0);
  return result;
}
vec3 normal(vec3 p) {
  vec2 e=vec2(.003,0);
  return normalize(vec3(scene(p+e.xyy).x-scene(p-e.xyy).x,scene(p+e.yxy).x-scene(p-e.yxy).x,scene(p+e.yyx).x-scene(p-e.yyx).x));
}
float shadow(vec3 p,vec3 light) {
  float result=1.0, t=.06;
  for(int i=0;i<24;i++) { float h=scene(p+light*t).x; result=min(result,12.0*h/t); t+=clamp(h,.07,.32); }
  return clamp(result,.28,1.0);
}
void main() {
  vec2 uv=(gl_FragCoord.xy*2.0-resolution)/resolution.y;
  float angle=.48+pointer.x*.12+sin(time*.12)*.035;
  vec3 ro=vec3(sin(angle)*7.8,3.2+pointer.y*.25,cos(angle)*7.8);
  vec3 target=vec3(0,.95,0);
  vec3 forward=normalize(target-ro), right=normalize(cross(forward,vec3(0,1,0))), up=cross(right,forward);
  vec3 rd=normalize(forward*1.8+right*uv.x+up*uv.y);
  vec3 sky=mix(vec3(.63,.68,.73),vec3(.84,.87,.89),clamp(rd.y+.4,0.0,1.0));
  sky=mix(sky,vec3(0.0),darkStage);
  float t=0.0; vec2 hit;
  for(int i=0;i<100;i++) { hit=scene(ro+rd*t); if(hit.x<.002 || t>40.0) break; t+=hit.x*.85; }
  vec3 color=sky;
  if(t<40.0 && hit.x<.002) {
    vec3 p=ro+rd*t, n=normal(p), light=normalize(vec3(-3,5,4));
    float diffuse=max(dot(n,light),0.0), shade=shadow(p+n*.015,light);
    float grain=noise(p.xz*22.0)*.035;
    vec3 base=vec3(.70,.75,.80);
    if(hit.y<1.5) base=vec3(.79,.82,.85)-grain;
    if(hit.y>1.5 && hit.y<2.5) base=vec3(.72,.79,.84)-grain;
    if(hit.y>3.5) base=vec3(.2,.28,.33);
    color=base*(.52+diffuse*.5*shade);
    float spec=pow(max(dot(reflect(-light,n),-rd),0.0),hit.y<1.5?18.0:65.0);
    color+=vec3(.87,.94,1.0)*spec*.36;
    float interiorGlow=exp(-length(p-vec3(0,1,.2))*1.2);
    color+=vec3(.18,.28,.34)*interiorGlow;
    if(hit.y>2.5 && hit.y<3.5) color=vec3(.82,.96,1.0);
    color=mix(color,sky,(1.0-exp(-t*.024))*(1.0-darkStage));
  }
  // Fine deterministic grain avoids texture downloads.
  color+=(hash(gl_FragCoord.xy)-.5)*.004*step(.01,length(color));
  gl_FragColor=vec4(color,1.0);
}
`;
