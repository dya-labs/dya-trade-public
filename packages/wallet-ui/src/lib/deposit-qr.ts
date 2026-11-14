import QRCode from "qrcode";

/** Preserve a four-module quiet zone and square finder patterns. */
export async function depositQrDataUrl(address: string): Promise<string> {
  const qr = QRCode.create(address, { errorCorrectionLevel: "H" });
  const size = qr.modules.size, margin = 4;
  const modules: string[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    if (!qr.modules.get(row, col)) continue;
    const finder = (row < 7 && col < 7) || (row < 7 && col >= size - 7) || (row >= size - 7 && col < 7);
    modules.push(`<rect x="${col + margin}" y="${row + margin}" width="1" height="1" rx="${finder ? 0 : 0.22}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + margin * 2} ${size + margin * 2}" fill="#e8f0ed">${modules.join("")}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
