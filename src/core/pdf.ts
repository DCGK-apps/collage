/**
 * Minimal single-page PDF writer embedding one JPEG (DCTDecode) that fills the
 * page. Enough for printing a collage at its physical size, with no
 * dependencies.
 */
export function mmToPt(mm: number): number {
  return (mm / 25.4) * 72;
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

export function buildPdf(jpeg: Uint8Array, imgW: number, imgH: number, pageWmm: number, pageHmm: number): Uint8Array {
  const enc = new TextEncoder();
  const W = fmt(mmToPt(pageWmm));
  const H = fmt(mmToPt(pageHmm));
  const content = `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;

  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (data: Uint8Array | string): void => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string | (() => void)): void => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === 'string') push(body);
    else body();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  obj(4, () => {
    push(
      `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    );
    push(jpeg);
    push('\nendstream');
  });
  obj(5, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream`);

  const xrefAt = length;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
