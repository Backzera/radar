"use client";
/** Shrinks a phone photo before upload: max 1600px, WebP (JPEG where WebP can't be encoded). */
export async function compressPhoto(file: File, max = 1600): Promise<Blob> {
  if (!/^image\//.test(file.type)) throw new Error("Escolha um arquivo de imagem.");
  // createImageBitmap applies the EXIF orientation, so portrait photos stay upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
  const webp = await encode("image/webp", 0.84);
  const blob = webp?.type === "image/webp" ? webp : await encode("image/jpeg", 0.86);
  if (!blob) throw new Error("Não foi possível preparar a foto.");
  if (blob.size > 3 * 1024 * 1024) return compressPhoto(file, Math.round(max * 0.75));
  return blob;
}

/** A short burst of confetti from a point; skipped when motion is reduced. */
export function confetti(originX = window.innerWidth / 2, originY = window.innerHeight / 2) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const colors = ["#2be0a8", "#38bdf8", "#8b7bff", "#fbbf24", "#f472b6"];
  const pieces = Array.from({ length: 140 }, () => {
    const angle = Math.random() * Math.PI * 2,
      speed = 4 + Math.random() * 9;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      size: 5 + Math.random() * 6,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  });
  const start = performance.now();
  const frame = (now: number) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const p of pieces) {
      p.vy += 0.28;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 1800);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (elapsed < 1800) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
