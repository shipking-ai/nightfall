/**
 * Develops a plate off the main thread: the rendered pixels (bottom row
 * first, as the GPU gives them) flipped, drawn and encoded as a JPEG data URL.
 */
self.onmessage = async (e: MessageEvent<{ id: number; px: Uint8Array; w: number; h: number; q: number }>) => {
  const { id, px, w, h, q } = e.data;
  try {
    const img = new ImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d')!.putImageData(img, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: q });
    const url = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
    (self as unknown as Worker).postMessage({ id, url });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, url: null, err: String(err) });
  }
};
