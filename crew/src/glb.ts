// A one-quad textured GLB, so any image (generated, uploaded or texted) can stand in the set as a poster, sign, mural,
// screen or cut-out. glTF is Y-up with the front facing +Z (the studio stands it up and turns the front to the row's facing).
// The quad is built at real size in metres with its bottom edge at y = 0.

const pad4 = (b: Buffer, fill = 0) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);

export function planeGlb(image: Buffer, mime: 'image/jpeg' | 'image/png', widthM: number, heightM: number): Buffer {
  const x = widthM / 2, y = heightM;
  const pos = new Float32Array([-x, 0, 0, x, 0, 0, x, y, 0, -x, y, 0]);
  const nrm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uv = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]); // glTF UVs start at the top-left
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const parts = [pos, nrm, uv, idx].map(a => pad4(Buffer.from(a.buffer, a.byteOffset, a.byteLength)));
  const img = pad4(image);
  const views: { buffer: number; byteOffset: number; byteLength: number; target?: number }[] = [];
  let off = 0;
  for (const [i, p] of parts.entries()) { views.push({ buffer: 0, byteOffset: off, byteLength: [pos, nrm, uv, idx][i].byteLength, target: i === 3 ? 34963 : 34962 }); off += p.length; }
  views.push({ buffer: 0, byteOffset: off, byteLength: image.length });
  off += img.length;
  const json = {
    asset: { version: '2.0', generator: 'Tessera crew planeGlb' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'image' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: true }],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: 4, mimeType: mime }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-x, 0, 0], max: [x, y, 0] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' },
    ],
    bufferViews: views, buffers: [{ byteLength: off }],
  };
  const jsonBuf = pad4(Buffer.from(JSON.stringify(json)), 0x20);
  const bin = Buffer.concat([...parts, img]);
  const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  jh.writeUInt32LE(jsonBuf.length, 0); jh.write('JSON', 4);
  bh.writeUInt32LE(bin.length, 0); bh.write('BIN\0', 4);
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}

/** The JSON chunk of a GLB, for checks. */
export function glbJson(glb: Buffer): any {
  if (glb.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB');
  const len = glb.readUInt32LE(12);
  return JSON.parse(glb.toString('utf8', 20, 20 + len));
}
