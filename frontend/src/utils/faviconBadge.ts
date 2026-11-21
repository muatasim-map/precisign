/**
 * Adds a small amber dot to the browser-tab icon while something needs the user's action,
 * and restores the original icon when the count returns to zero. Purely cosmetic; failures
 * (no canvas, cross-origin icon) leave the original icon in place.
 */
let original: string | null = null;
let badged: string | null = null;

export function setFaviconBadge(active: boolean) {
  if (typeof document === 'undefined') return;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  original ??= link.href;
  if (!active) { link.href = original; return; }
  if (badged) { link.href = badged; return; }
  const image = new Image();
  image.onload = () => {
    try {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0, size, size);
      context.beginPath();
      context.arc(size - 13, 13, 12, 0, Math.PI * 2);
      context.fillStyle = '#fff';
      context.fill();
      context.beginPath();
      context.arc(size - 13, 13, 9, 0, Math.PI * 2);
      context.fillStyle = '#f59e0b';
      context.fill();
      badged = canvas.toDataURL('image/png');
      link.href = badged;
    } catch { /* keep the original icon */ }
  };
  image.src = original;
}
