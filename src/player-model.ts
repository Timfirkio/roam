import { MercatorCoordinate, type CustomLayerInterface, type Map } from 'maplibre-gl';

export const PLAYER_MODEL_LAYER = 'roam-player-model';
type PlayerModelState = { lng: number; lat: number; heading: number; arrow: boolean };
type Vec3 = [number, number, number];

// Mesh coordinates are map pixels: modest geometry, consistent size at any zoom.
function mesh(arrow: boolean): Float32Array {
  const vertices: number[] = [];
  const pale: Vec3 = [0.94, 1, 0.99];
  const teal: Vec3 = [0.17, 0.72, 0.69];
  const triangle = (a: Vec3, b: Vec3, c: Vec3, color: Vec3) => {
    for (const p of [a, b, c]) vertices.push(...p, ...color);
  };
  const polygon: [number, number][] = arrow
    ? [[0, -19], [14, 15], [0, 9], [-14, 15]]
    : Array.from({ length: 32 }, (_, i) => [Math.cos(i * Math.PI / 16) * 7, Math.sin(i * Math.PI / 16) * 7]);
  const height = arrow ? 5 : 6;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const bottomA: Vec3 = [...a, 0], bottomB: Vec3 = [...b, 0];
    const topA: Vec3 = [...a, height], topB: Vec3 = [...b, height];
    const shade = 0.45 + 0.25 * (1 + Math.cos(Math.atan2(b[1] - a[1], b[0] - a[0])));
    const side = teal.map(v => v * shade) as Vec3;
    triangle(bottomA, bottomB, topB, side);
    triangle(bottomA, topB, topA, side);
    // Arrow's inset point is also its fan centre, so the concave notch stays open.
    const centre: Vec3 = arrow ? [0, 9, height] : [0, 0, height];
    triangle(centre, topA, topB, arrow ? (i < 2 ? pale : [0.73, 0.9, 0.88]) : teal);
    if (arrow) {
      const insetA: Vec3 = [a[0] * 0.86, 9 + (a[1] - 9) * 0.86, height + 0.02];
      const insetB: Vec3 = [b[0] * 0.86, 9 + (b[1] - 9) * 0.86, height + 0.02];
      triangle(topA, topB, insetB, teal);
      triangle(topA, insetB, insetA, teal);
    }
    if (!arrow) {
      const innerA: Vec3 = [a[0] * 0.72, a[1] * 0.72, height + 0.02];
      const innerB: Vec3 = [b[0] * 0.72, b[1] * 0.72, height + 0.02];
      triangle(topA, topB, innerB, pale);
      triangle(topA, innerB, innerA, pale);
    }
  }
  return new Float32Array(vertices);
}

export function createPlayerModel(readState: () => PlayerModelState | null): CustomLayerInterface {
  let map: Map;
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let buffer: WebGLBuffer | null = null;
  let haloBuffer: WebGLBuffer | null = null;
  let matrixUniform: WebGLUniformLocation | null = null;
  let opacityUniform: WebGLUniformLocation | null = null;
  const dot = mesh(false), arrow = mesh(true);
  let currentArrow: boolean | undefined;
  return {
    id: PLAYER_MODEL_LAYER, type: 'custom', renderingMode: '3d',
    onAdd(instance, gl) {
      map = instance;
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(error ?? 'Player shader failed');
        }
        return shader;
      };
      const vertex = compile(gl.VERTEX_SHADER, '#version 300 es\nin vec3 a_position; in vec3 a_color; uniform mat4 u_matrix; out vec3 v_color; void main(){gl_Position=u_matrix*vec4(a_position,1.0);v_color=a_color;}');
      const fragment = compile(gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float; in vec3 v_color; uniform float u_opacity; out vec4 color; void main(){color=vec4(v_color*u_opacity,u_opacity);}');
      program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Player program failed');
      matrixUniform = gl.getUniformLocation(program, 'u_matrix');
      opacityUniform = gl.getUniformLocation(program, 'u_opacity');
      vao = gl.createVertexArray(); buffer = gl.createBuffer();
      gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [name, offset] of [['a_position', 0], ['a_color', 12]] as const) {
        const attribute = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 24, offset);
      }
      gl.bindVertexArray(null);
      const halo: number[] = [];
      for (let i = 0; i < 64; i++) {
        const a = i * Math.PI / 32, b = (i + 1) * Math.PI / 32;
        const add = (x: number, y: number, color: Vec3) => halo.push(x, y, 0, ...color);
        add(0, 0, [0.04, 0.14, 0.16]);
        add(Math.cos(a)*15, Math.sin(a)*15, [0.04, 0.14, 0.16]);
        add(Math.cos(b)*15, Math.sin(b)*15, [0.04, 0.14, 0.16]);
      }
      for (let i = 0; i < 64; i++) {
        const a = i * Math.PI / 32, b = (i + 1) * Math.PI / 32;
        for (const [angle, radius] of [[a,15],[b,15],[b,16],[a,15],[b,16],[a,16]]) {
          halo.push(Math.cos(angle)*radius, Math.sin(angle)*radius, 0, 0.17, 0.72, 0.69);
        }
      }
      haloBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, haloBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(halo), gl.STATIC_DRAW);
    },
    render(gl, input) {
      const state = readState();
      if (!state || !program) return;
      const altitude = map.queryTerrainElevation([state.lng, state.lat]) ?? 0;
      const origin = MercatorCoordinate.fromLngLat([state.lng, state.lat], altitude);
      const scale = 1 / (512 * 2 ** map.getZoom());
      const angle = state.heading * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
      const model = [scale*c, scale*s, 0, 0, -scale*s, scale*c, 0, 0, 0, 0, scale, 0, origin.x, origin.y, origin.z + scale * 0.5, 1];
      const projection = input.defaultProjectionData.mainMatrix;
      const matrix = new Float32Array(16);
      for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
        let value = 0;
        for (let k = 0; k < 4; k++) value += projection[k*4+row] * model[col*4+k];
        matrix[col*4+row] = value;
      }
      gl.useProgram(program); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      if (currentArrow !== state.arrow) { gl.bufferData(gl.ARRAY_BUFFER, state.arrow ? arrow : dot, gl.STATIC_DRAW); currentArrow = state.arrow; }
      gl.uniformMatrix4fv(matrixUniform, false, matrix);
      gl.bindBuffer(gl.ARRAY_BUFFER, haloBuffer);
      for (const [name, offset] of [['a_position', 0], ['a_color', 12]] as const) {
        gl.vertexAttribPointer(gl.getAttribLocation(program, name), 3, gl.FLOAT, false, 24, offset);
      }
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE); gl.disable(gl.STENCIL_TEST);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(opacityUniform, 0.65); gl.drawArrays(gl.TRIANGLES, 0, 64*3);
      gl.uniform1f(opacityUniform, 0.55); gl.drawArrays(gl.TRIANGLES, 64*3, 64*6);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const [name, offset] of [['a_position', 0], ['a_color', 12]] as const) {
        gl.vertexAttribPointer(gl.getAttribLocation(program, name), 3, gl.FLOAT, false, 24, offset);
      }
      gl.uniform1f(opacityUniform, 1);
      // Keep the navigation indicator readable through buildings. Its own depth
      // buffer still resolves front/back faces correctly at every camera bearing.
      gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
      gl.drawArrays(gl.TRIANGLES, 0, (state.arrow ? arrow : dot).length / 6);
      gl.bindVertexArray(null);
    },
    onRemove(_map, gl) { gl.deleteBuffer(buffer); gl.deleteBuffer(haloBuffer); gl.deleteVertexArray(vao); gl.deleteProgram(program); },
  };
}
