const FRAME_W = 720;
const FRAME_H = 960;
const PAD = 28;
const GAP = 18;
const FOOTER = 72;

function token(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function grabFrame(
  video: HTMLVideoElement,
  options: { mirror: boolean; filter: string },
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(FRAME_W / vw, FRAME_H / vh);
  const sw = FRAME_W / scale;
  const sh = FRAME_H / scale;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = options.filter || "none";
  ctx.save();
  if (options.mirror) {
    ctx.translate(FRAME_W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, FRAME_W, FRAME_H);
  ctx.restore();
  ctx.filter = "none";
  return canvas;
}

function stampNow() {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function composePrint(
  frames: HTMLCanvasElement[],
  meta: { filterName: string; frameCount: number },
): HTMLCanvasElement {
  const width = FRAME_W + PAD * 2;
  const height = PAD + frames.length * FRAME_H + Math.max(0, frames.length - 1) * GAP + GAP + FOOTER;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法导出照片");

  const bone = token("--color-fg", "#f4efe6");
  const ink = token("--color-bg", "#141210");
  const captionInk = token("--color-surface", "#221e1a");
  const vermillion = token("--color-primary", "#e23b2a");

  ctx.fillStyle = bone;
  ctx.fillRect(0, 0, width, height);

  frames.forEach((frame, index) => {
    const y = PAD + index * (FRAME_H + GAP);
    ctx.drawImage(frame, PAD, y, FRAME_W, FRAME_H);
  });

  const baseline = height - 28;
  ctx.fillStyle = vermillion;
  ctx.fillRect(PAD, baseline - 14, 10, 10);

  ctx.fillStyle = ink;
  ctx.font = '700 22px Outfit, "PingFang SC", sans-serif';
  ctx.textBaseline = "middle";
  ctx.fillText("咔嚓亭", PAD + 18, baseline - 8);

  const caption =
    meta.frameCount > 1
      ? `${stampNow()}  ·  ${meta.filterName} · 三条`
      : `${stampNow()}  ·  ${meta.filterName}`;
  ctx.fillStyle = captionInk;
  ctx.font = '500 16px Outfit, "PingFang SC", sans-serif';
  ctx.textAlign = "right";
  ctx.fillText(caption, width - PAD, baseline - 8);
  return canvas;
}

export function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("导出失败"))),
      "image/jpeg",
      0.86,
    );
  });
}
