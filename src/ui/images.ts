import { uid } from '../core/ids';
import type { Photo } from '../core/types';

export interface LoadedPhoto {
  photo: Photo;
  img: HTMLImageElement;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Nie udało się wczytać obrazu'));
    img.src = src;
  });
}

export async function loadFiles(files: FileList | File[]): Promise<LoadedPhoto[]> {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|avif)$/i.test(f.name));
  const results = await Promise.allSettled(
    list.map(async (file) => {
      const src = URL.createObjectURL(file);
      const img = await loadImage(src);
      return { photo: { id: uid('p'), src, width: img.naturalWidth, height: img.naturalHeight }, img };
    }),
  );
  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

function demoSvg(text: string, c1: string, c2: string, w: number, h: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <circle cx="${w / 2}" cy="${h / 2 - 30}" r="${Math.min(w, h) / 8}" fill="rgba(255,255,255,0.22)"/>
  <path d="M0 ${h} L${w * 0.35} ${h * 0.6} L${w * 0.55} ${h * 0.78} L${w * 0.75} ${h * 0.55} L${w} ${h * 0.85} L${w} ${h} Z" fill="rgba(0,0,0,0.18)"/>
  <text x="${w / 2}" y="${h / 2 + Math.min(w, h) / 8 + 30}" font-family="sans-serif" font-weight="700" font-size="${Math.round(Math.min(w, h) / 14)}" fill="#fff" text-anchor="middle">${text}</text>
</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const DEMO = [
  { text: 'Krajobraz', c1: '#2563eb', c2: '#1e3a8a', w: 1200, h: 800 },
  { text: 'Portret', c1: '#db2777', c2: '#831843', w: 800, h: 1200 },
  { text: 'Natura', c1: '#059669', c2: '#064e3b', w: 1000, h: 800 },
  { text: 'Miasto', c1: '#d97706', c2: '#7c2d12', w: 800, h: 1000 },
];

export async function loadDemoPhotos(): Promise<LoadedPhoto[]> {
  return Promise.all(
    DEMO.map(async (d, i) => {
      const src = demoSvg(d.text, d.c1, d.c2, d.w, d.h);
      const img = await loadImage(src);
      return { photo: { id: `demo${i}`, src, width: d.w, height: d.h }, img };
    }),
  );
}
