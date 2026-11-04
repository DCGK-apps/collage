import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createDoc } from '../../src/core/doc';
import { createFloat } from '../../src/core/floats';
import {
  packProject,
  photoPath,
  projectFileName,
  ProjectError,
  unpackProject,
  type ProjectPhotoAsset,
} from '../../src/core/project';
import { sha256Hex } from '../../src/core/sha256';
import { crc32, createZip, readZip } from '../../src/core/zip';
import type { Doc } from '../../src/core/types';
import { cell, split } from './helpers';

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);

describe('sha256', () => {
  it('matches the standard test vectors', () => {
    expect(sha256Hex(bytes(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('handles a block-boundary length and larger input', () => {
    expect(sha256Hex(new Uint8Array(64))).toBe('f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b');
    expect(sha256Hex(new Uint8Array(1_000_000).fill(97))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('zip', () => {
  it('crc32 of "123456789" is cbf43926', () => {
    expect(crc32(bytes('123456789')).toString(16)).toBe('cbf43926');
  });

  it('round-trips files including UTF-8 names and binary data', async () => {
    const bin = new Uint8Array(1000).map((_, i) => (i * 7) & 255);
    const zip = createZip([
      { name: 'project.json', data: bytes('{"a":1}') },
      { name: 'photos/zdjęcie.bin', data: bin },
    ]);
    expect(String.fromCharCode(zip[0]!, zip[1]!)).toBe('PK');
    const files = await readZip(zip);
    expect(new TextDecoder().decode(files.get('project.json'))).toBe('{"a":1}');
    expect(files.get('photos/zdjęcie.bin')).toEqual(bin);
  });

  it('reads deflated entries (archives re-zipped by the system)', async () => {
    const data = bytes('hello '.repeat(200));
    const zip = deflatedZip('a.txt', data);
    expect((await readZip(zip)).get('a.txt')).toEqual(data);
  });

  it('rejects non-zip input and corrupted entries', async () => {
    await expect(readZip(bytes('not a zip at all, sorry'))).rejects.toThrow();
    const zip = createZip([{ name: 'x', data: bytes('abcdef') }]);
    zip[32] = zip[32]! ^ 0xff; // flip a data byte → CRC mismatch
    await expect(readZip(zip)).rejects.toThrow(/Uszkodzony/);
  });
});

/** Build a ZIP with one deflated entry (method 8), as an OS archiver would. */
function deflatedZip(name: string, data: Uint8Array): Uint8Array {
  const comp = new Uint8Array(deflateRawSync(data));
  const n = enc.encode(name);
  const crc = crc32(data);
  const local = new Uint8Array(30 + n.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true);
  lv.setUint32(14, crc, true);
  lv.setUint32(18, comp.length, true);
  lv.setUint32(22, data.length, true);
  lv.setUint16(26, n.length, true);
  local.set(n, 30);
  const central = new Uint8Array(46 + n.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, 8, true);
  cv.setUint32(16, crc, true);
  cv.setUint32(20, comp.length, true);
  cv.setUint32(24, data.length, true);
  cv.setUint16(28, n.length, true);
  cv.setUint32(42, 0, true);
  central.set(n, 46);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + comp.length, true);
  const out = new Uint8Array(local.length + comp.length + central.length + 22);
  out.set(local, 0);
  out.set(comp, local.length);
  out.set(central, local.length + comp.length);
  out.set(end, local.length + comp.length + central.length);
  return out;
}

/* ------------------------------------------------------------------ project */

function sample(): { doc: Doc; assets: ProjectPhotoAsset[] } {
  const doc = createDoc();
  doc.tree = split('s', 'v', 0.37, cell('c1', 'a'), split('t', 'h', 0.6, cell('c2', 'b'), cell('c3', 'dup')));
  doc.floats = [createFloat({ id: 'c', src: '', width: 300, height: 200 }, { w: 210, h: 297 }, 0)];
  doc.library = ['a', 'b', 'c', 'dup'];
  doc.style.gapMm = 7;
  const img = (s: string) => bytes(`fake-image-${s}`);
  return {
    doc,
    assets: [
      { id: 'a', bytes: img('A'), mime: 'image/jpeg', width: 400, height: 300, name: 'IMG_0001.jpg' },
      { id: 'b', bytes: img('B'), mime: 'image/png', width: 300, height: 400 },
      { id: 'c', bytes: img('C'), mime: 'image/webp', width: 300, height: 200 },
      { id: 'dup', bytes: img('A'), mime: 'image/jpeg', width: 400, height: 300 }, // same content as "a"
    ],
  };
}

describe('packProject / unpackProject', () => {
  it('round-trips the document and photos', async () => {
    const { doc, assets } = sample();
    const opened = await unpackProject(packProject(doc, assets));
    expect(opened.doc).toEqual(doc);
    expect(opened.missing).toBe(0);
    expect(opened.photos.map((p) => [p.id, p.mime, p.width, p.height])).toEqual(assets.map((a) => [a.id, a.mime, a.width, a.height]));
    expect(opened.photos[0]!.name).toBe('IMG_0001.jpg');
    expect(new TextDecoder().decode(opened.photos[3]!.bytes)).toBe('fake-image-A');
  });

  it('stores identical photos once, named by content hash, with relative paths', async () => {
    const { doc, assets } = sample();
    const files = await readZip(packProject(doc, assets));
    const photoFiles = [...files.keys()].filter((k) => k.startsWith('photos/'));
    expect(photoFiles).toHaveLength(3);
    expect(photoFiles).toContain(photoPath(assets[0]!.bytes, 'image/jpeg'));
    const manifest = JSON.parse(new TextDecoder().decode(files.get('project.json')));
    expect(manifest).toMatchObject({ type: 'collage-project', version: 1, app: 'Collage' });
    for (const p of manifest.photos) expect(p.path).toMatch(/^photos\/[0-9a-f]{64}\.(jpg|png|webp)$/);
  });

  it('a missing or tampered photo leaves an empty cell instead of failing', async () => {
    const { doc, assets } = sample();
    const files = await readZip(packProject(doc, assets));
    const bPath = photoPath(assets[1]!.bytes, 'image/png');
    files.set(bPath, bytes('changed!')); // content no longer matches its hash
    const rezipped = createZip([...files].map(([name, data]) => ({ name, data })));
    const opened = await unpackProject(rezipped);
    expect(opened.missing).toBe(1);
    expect((opened.doc.tree as any).second.first.photoId).toBeNull();
    expect(opened.doc.library).not.toContain('b');
  });

  it('refuses paths outside photos/ (no ../ tricks)', async () => {
    const { doc } = sample();
    const manifest = {
      type: 'collage-project', version: 1, app: 'Collage', savedAt: '', doc,
      photos: [{ id: 'a', path: '../../etc/passwd', mime: 'image/jpeg', width: 1, height: 1 }],
    };
    const zip = createZip([
      { name: 'project.json', data: bytes(JSON.stringify(manifest)) },
      { name: '../../etc/passwd', data: bytes('x') },
    ]);
    const opened = await unpackProject(zip);
    expect(opened.photos).toEqual([]);
    expect(opened.missing).toBe(1);
  });

  it('gives clear errors for files that are not projects', async () => {
    await expect(unpackProject(bytes('hello'))).rejects.toBeInstanceOf(ProjectError);
    await expect(unpackProject(createZip([{ name: 'readme.txt', data: bytes('x') }]))).rejects.toThrow(/project.json/);
    await expect(unpackProject(createZip([{ name: 'project.json', data: bytes('{') }]))).rejects.toThrow(/Uszkodzony/);
    const newer = createZip([{ name: 'project.json', data: bytes('{"type":"collage-project","version":9,"photos":[]}') }]);
    await expect(unpackProject(newer)).rejects.toThrow(/nowszej wersji/);
    const badDoc = createZip([{ name: 'project.json', data: bytes('{"type":"collage-project","version":1,"photos":[],"doc":{"tree":5}}') }]);
    await expect(unpackProject(badDoc)).rejects.toBeInstanceOf(ProjectError);
  });

  it('suggests a dated file name', () => {
    expect(projectFileName(new Date(2026, 10, 4))).toBe('kolaz-2026-11-04.collage');
  });
});
