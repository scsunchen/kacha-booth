import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  Aperture,
  Camera,
  Download,
  FlipHorizontal2,
  RefreshCw,
  SwitchCamera,
  Trash2,
  X,
} from "lucide-react";
import {
  classifyCameraError,
  countCameras,
  openCamera,
  stopStream,
  type CamStatus,
  type Facing,
} from "@/lib/booth/camera";
import { canvasToJpeg, composePrint, grabFrame } from "@/lib/booth/capture";
import { FILTERS, type FilterPreset } from "@/lib/booth/filters";
import {
  addShot,
  downloadShot,
  listShots,
  MAX_SHOTS,
  removeShot,
  toShot,
  type Shot,
  type ShotRecord,
} from "@/lib/booth/gallery";

type Mode = "single" | "strip";
type Seconds = 0 | 3 | 5;

const STATUS_COPY: Record<CamStatus, { title: string; detail: string }> = {
  idle: { title: "摄像头未开启", detail: "点取景框里的按钮，并允许使用摄像头" },
  requesting: { title: "正在请求权限", detail: "请在浏览器提示里选择允许" },
  live: { title: "实时预览", detail: "" },
  denied: { title: "权限被拒绝", detail: "到浏览器设置里允许摄像头，然后重试" },
  missing: { title: "未检测到摄像头", detail: "请连接摄像头，或换一台有镜头的设备" },
  busy: { title: "摄像头被占用", detail: "关闭其他正在使用镜头的应用后重试" },
  unsupported: { title: "浏览器不支持", detail: "请换用最新版 Chrome、Safari 或 Edge" },
  insecure: { title: "无法使用摄像头", detail: "镜头只在安全连接下可用" },
  error: { title: "打开失败", detail: "请重试。若一直失败，检查系统是否允许浏览器使用摄像头" },
};

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbort(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

export function PhotoBooth() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const opRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef<(next: Facing) => Promise<void>>(async () => {});
  const shutterRef = useRef<() => void>(() => {});
  const activeRef = useRef<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const shotsRef = useRef<Shot[]>([]);

  const [status, setStatus] = useState<CamStatus>("idle");
  const [switching, setSwitching] = useState(false);
  const [ready, setReady] = useState(false);
  const [streamToken, setStreamToken] = useState(0);
  const [facing, setFacing] = useState<Facing>("user");
  const [facingKnown, setFacingKnown] = useState(false);
  const [camCount, setCamCount] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [mirror, setMirror] = useState(true);
  const [filter, setFilter] = useState<FilterPreset>(FILTERS[0]);
  const [seconds, setSeconds] = useState<Seconds>(3);
  const [mode, setMode] = useState<Mode>("single");
  const [shooting, setShooting] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [burstStep, setBurstStep] = useState(0);
  const [flash, setFlash] = useState(0);
  const [shots, setShots] = useState<Shot[]>([]);
  const [lastId, setLastId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  activeRef.current = activeId;
  shotsRef.current = shots;

  async function start(next: Facing) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    if (!window.isSecureContext) {
      setStatus("insecure");
      return;
    }
    const op = ++opRef.current;
    const hadStream = streamRef.current !== null;
    if (!hadStream) setStatus("requesting");
    setSwitching(hadStream);
    try {
      const stream = await openCamera(next);
      if (op !== opRef.current) {
        stopStream(stream);
        return;
      }
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      const actual = settings?.facingMode;
      const nextId = settings?.deviceId;
      const prevId = streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId;
      if (actual && actual !== next) {
        stopStream(stream);
        setSwitching(false);
        setNotice(next === "environment" ? "没有后置摄像头" : "没有前置摄像头");
        setStatus(streamRef.current ? "live" : "missing");
        return;
      }
      if (hadStream && prevId && nextId && prevId === nextId) {
        stopStream(stream);
        setSwitching(false);
        setStatus("live");
        setNotice("没有可切换的另一侧摄像头");
        return;
      }
      stopStream(streamRef.current);
      streamRef.current = stream;
      const known = actual === "user" || actual === "environment";
      const resolved: Facing = actual === "environment" ? "environment" : actual === "user" ? "user" : next;
      setFacing(resolved);
      setFacingKnown(known);
      setMirror(resolved !== "environment");
      setReady(false);
      setDims(null);
      setStatus("live");
      setSwitching(false);
      setStreamToken((n) => n + 1);
      track?.addEventListener("ended", () => {
        if (streamRef.current?.getVideoTracks()[0] !== track) return;
        streamRef.current = null;
        setStatus("missing");
        setReady(false);
        setNotice("摄像头已断开");
      });
      try {
        const countCam = await countCameras();
        if (op === opRef.current) setCamCount(countCam);
      } catch {
        /* device list is optional */
      }
    } catch (err) {
      if (op !== opRef.current) return;
      setSwitching(false);
      if (streamRef.current) {
        setStatus("live");
        setNotice("切换失败，仍使用当前摄像头");
        return;
      }
      setStatus(classifyCameraError(err));
    }
  }

  startRef.current = start;

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (!stream) return;
    const mark = () => {
      if (!video.videoWidth) return;
      setDims({ w: video.videoWidth, h: video.videoHeight });
      setReady(true);
      setSwitching(false);
    };
    video.addEventListener("loadedmetadata", mark);
    void video.play().then(mark).catch(() => {});
    return () => video.removeEventListener("loadedmetadata", mark);
  }, [streamToken]);

  useEffect(() => {
    let dead = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("unsupported");
        return;
      }
      if (!window.isSecureContext) {
        setStatus("insecure");
        return;
      }
      try {
        const countCam = await countCameras();
        if (!dead && countCam > 0) setCamCount(countCam);
      } catch {
        /* ignore */
      }
      try {
        const perm = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (dead) return;
        if (perm.state === "granted") void startRef.current("user");
        else if (perm.state === "denied") setStatus("denied");
        perm.onchange = () => {
          if (perm.state === "denied") {
            stopStream(streamRef.current);
            streamRef.current = null;
            setReady(false);
            setStatus("denied");
          }
        };
      } catch {
        /* Permissions API missing — wait for the button */
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      opRef.current += 1;
      abortRef.current?.abort();
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    let dead = false;
    listShots()
      .then((items) => {
        if (dead) {
          items.forEach((item) => URL.revokeObjectURL(item.url));
          return;
        }
        setShots((prev) => {
          const ids = new Set(prev.map((item) => item.id));
          const fresh = items.filter((item) => !ids.has(item.id));
          items.filter((item) => ids.has(item.id)).forEach((item) => URL.revokeObjectURL(item.url));
          return [...prev, ...fresh].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_SHOTS);
        });
      })
      .catch(() => {
        if (!dead) setNotice("相册暂时读不出来，新照片仍可下载");
      });
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      shotsRef.current.forEach((shot) => URL.revokeObjectURL(shot.url));
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (activeId) closeRef.current?.focus();
  }, [activeId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveId(null);
        return;
      }
      if (event.key !== " " || event.repeat || activeRef.current) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "BUTTON" || tag === "INPUT" || tag === "A") return;
      event.preventDefault();
      shutterRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function runShoot() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setNotice("画面还没准备好");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    const plan = {
      seconds,
      total: mode === "strip" ? 3 : 1,
      filter,
      mirror,
    };
    setShooting(true);
    setBurstStep(0);
    try {
      const frames: HTMLCanvasElement[] = [];
      for (let index = 0; index < plan.total; index += 1) {
        setBurstStep(index + 1);
        for (let n = plan.seconds; n >= 1; n -= 1) {
          setCount(n);
          await delay(1000, signal);
        }
        if (plan.seconds > 0) {
          setCount(-1);
          await delay(220, signal);
        }
        setCount(null);
        setFlash((n) => n + 1);
        const liveVideo = videoRef.current;
        if (!liveVideo || liveVideo.videoWidth === 0) throw new Error("画面还没准备好");
        frames.push(grabFrame(liveVideo, { mirror: plan.mirror, filter: plan.filter.css }));
        if (index < plan.total - 1) await delay(680, signal);
      }
      const print = composePrint(frames, {
        filterName: plan.filter.name,
        frameCount: plan.total,
      });
      const blob = await canvasToJpeg(print);
      const record: ShotRecord = {
        id: crypto.randomUUID(),
        blob,
        filterName: plan.filter.name,
        createdAt: Date.now(),
        frameCount: plan.total,
      };
      const shot = toShot(record);
      setShots((prev) => {
        const next = [shot, ...prev].slice(0, MAX_SHOTS);
        [shot, ...prev].slice(MAX_SHOTS).forEach((item) => URL.revokeObjectURL(item.url));
        return next;
      });
      setLastId(shot.id);
      setNotice(plan.total > 1 ? "三条连拍好了" : "拍好了，可以下载");
      try {
        await addShot(record);
      } catch {
        setNotice("拍好了。本地空间不足，建议马上下载");
      }
    } catch (err) {
      if (isAbort(err)) setNotice("已取消");
      else setNotice(err instanceof Error ? err.message : "拍摄失败");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setShooting(false);
      setCount(null);
      setBurstStep(0);
    }
  }

  function onShutter() {
    if (shooting) {
      abortRef.current?.abort();
      return;
    }
    if (status !== "live" || !ready || switching) {
      if (status !== "live") void start(facing);
      else setNotice("画面还在准备，请稍等");
      return;
    }
    void runShoot();
  }

  shutterRef.current = onShutter;

  async function onDelete(shot: Shot) {
    URL.revokeObjectURL(shot.url);
    setShots((prev) => prev.filter((item) => item.id !== shot.id));
    if (activeId === shot.id) setActiveId(null);
    if (lastId === shot.id) setLastId(null);
    try {
      await removeShot(shot.id);
    } catch {
      setNotice("删除没有写进本地相册");
    }
  }

  const canShoot = status === "live" && ready && !switching;
  const sideLabel = facingKnown ? (facing === "user" ? "前置" : "后置") : "主摄像头";
  let title = STATUS_COPY[status].title;
  let detail = STATUS_COPY[status].detail;
  if (status === "live") {
    if (switching) {
      title = "正在切换摄像头";
      detail = "马上就好";
    } else if (!ready) {
      title = "正在连接画面";
      detail = "镜头已授权";
    } else if (shooting && count !== null) {
      title = "倒计时";
      detail = count < 0 ? "看镜头" : `${count} 秒后拍摄`;
    } else if (shooting) {
      title = mode === "strip" ? "连拍中" : "拍摄中";
      detail = mode === "strip" ? `第 ${burstStep} 张，共 3 张` : "保持不动";
    } else {
      title = "实时预览";
      const res = dims ? `${dims.w}×${dims.h}` : "等待分辨率";
      const onlyOne = camCount === 1 ? " · 仅一个摄像头" : "";
      detail = `${sideLabel} · ${res}${onlyOne}`;
    }
  }

  const active = shots.find((shot) => shot.id === activeId) ?? null;
  const latest = shots[0];
  const showOpen = status !== "live" && status !== "unsupported";

  return (
    <main className="booth-shell mx-auto w-full max-w-6xl px-4 pt-4 lg:px-8">
      <header className="shrink-0">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-display text-sm font-extrabold tracking-widest text-primary">KACHA</p>
            <h1 className="text-2xl font-semibold leading-tight">咔嚓亭</h1>
          </div>
          <p className="hidden pb-1 text-sm text-muted sm:block">三、二、一，定格</p>
        </div>
        <div
          role="status"
          aria-live="polite"
          className="mt-3 flex items-center gap-3 rounded-2xl bg-surface px-3 py-2"
        >
          <span
            className={
              status === "live" && ready && !shooting
                ? "live-dot size-2.5 shrink-0 rounded-full bg-primary"
                : "size-2.5 shrink-0 rounded-full bg-line"
            }
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">{title}</p>
            <p className="truncate text-xs text-muted">{detail}</p>
          </div>
        </div>
      </header>

      <div className="booth-body">
        <div className="finder-slot">
          <div className="finder-frame">
            <video
              ref={videoRef}
              className={
                "absolute inset-0 h-full w-full object-cover " + (mirror ? "mirror-x" : "")
              }
              style={{ filter: filter.css }}
              playsInline
              muted
              autoPlay
              aria-hidden="true"
            />
            {flash > 0 && (
              <div key={flash} className="flash-burst pointer-events-none absolute inset-0 bg-fg" />
            )}
            <div className="vignette pointer-events-none absolute inset-0" />
            {status === "live" && shooting && mode === "strip" && burstStep > 0 && (
              <p className="absolute top-4 left-4 rounded-full bg-bg/80 px-3 py-1 text-sm tabular-nums">
                {burstStep}/3
              </p>
            )}
            {count !== null && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-bg/25">
                <span key={count} className="count-num count-pop text-fg">
                  {count < 0 ? "拍" : count}
                </span>
              </div>
            )}
            {status !== "live" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
                <span className="grid size-16 place-items-center rounded-full bg-surface-2 text-primary">
                  <Aperture className="size-8" />
                </span>
                <div>
                  <p className="text-lg font-semibold">{title}</p>
                  <p className="mt-1 text-sm text-pretty text-muted">{detail}</p>
                </div>
                {showOpen && (
                  <button
                    type="button"
                    onClick={() => void start(facing)}
                    disabled={status === "requesting"}
                    className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 font-medium text-primary-ink transition-transform duration-150 ease-out active:scale-[0.96] disabled:opacity-50"
                  >
                    {status === "requesting" ? (
                      <RefreshCw className="size-4" />
                    ) : (
                      <Camera className="size-4" />
                    )}
                    {status === "idle" ? "打开摄像头" : status === "requesting" ? "正在连接" : "重试"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <section className="booth-panel flex min-w-0 flex-col gap-3">
          <div>
            <p className="mb-2 text-xs text-muted" id="filter-label">
              滤镜
            </p>
            <div
              className="scroller flex gap-2 overflow-x-auto"
              role="radiogroup"
              aria-labelledby="filter-label"
            >
              {FILTERS.map((item) => {
                const on = item.id === filter.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={shooting}
                    onClick={() => setFilter(item)}
                    className="flex w-16 shrink-0 flex-col items-center gap-1 disabled:opacity-50"
                  >
                    <span
                      className={
                        "swatch block size-11 rounded-full " +
                        (on
                          ? "ring-2 ring-primary ring-offset-2 ring-offset-bg"
                          : "ring-1 ring-line")
                      }
                      style={{ filter: item.css }}
                    />
                    <span className={"text-xs " + (on ? "text-fg" : "text-muted")}>{item.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Segment
              label="倒计时"
              value={String(seconds)}
              disabled={shooting}
              options={[
                { value: "0", label: "关" },
                { value: "3", label: "3秒" },
                { value: "5", label: "5秒" },
              ]}
              onChange={(value) => setSeconds(Number(value) as Seconds)}
            />
            <Segment
              label="拍摄"
              value={mode}
              disabled={shooting}
              options={[
                { value: "single", label: "单张" },
                { value: "strip", label: "三条" },
              ]}
              onChange={(value) => setMode(value as Mode)}
            />
          </div>

          {notice && (
            <p role="status" className="rounded-2xl bg-surface-2 px-3 py-2 text-sm">
              {notice}
            </p>
          )}

          <div className="grid grid-cols-[1fr_auto_1fr] items-center">
            <div className="flex gap-2">
              <IconButton
                label={mirror ? "关闭镜像" : "打开镜像"}
                pressed={mirror}
                disabled={!canShoot || shooting}
                onClick={() => setMirror((value) => !value)}
              >
                <FlipHorizontal2 className="size-5" />
              </IconButton>
              <IconButton
                label={camCount === 1 ? "切换摄像头，此设备只有一个" : "切换前后摄像头"}
                disabled={!canShoot || shooting || camCount === 1}
                onClick={() => void start(facing === "user" ? "environment" : "user")}
              >
                <SwitchCamera className="size-5" />
              </IconButton>
            </div>
            <button
              type="button"
              onClick={onShutter}
              disabled={!shooting && !canShoot}
              aria-label={shooting ? "取消拍摄" : "拍摄"}
              className="grid size-20 place-items-center rounded-full bg-primary text-primary-ink transition-transform duration-150 ease-out active:scale-[0.96] disabled:opacity-40"
            >
              <span className="grid size-16 place-items-center rounded-full border-2 border-primary-ink/40">
                {shooting ? <X className="size-7" /> : <span className="size-12 rounded-full bg-primary-ink" />}
              </span>
            </button>
            <span className="sr-only">{shooting ? "拍摄进行中，再按一次取消" : "按空格也可拍摄"}</span>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">最近拍摄</h2>
              {latest && (
                <button
                  type="button"
                  onClick={() => downloadShot(latest)}
                  className="inline-flex h-11 items-center gap-1 rounded-full bg-primary px-4 text-sm font-medium text-primary-ink transition-transform duration-150 ease-out active:scale-[0.96]"
                >
                  <Download className="size-4" />
                  下载
                </button>
              )}
            </div>
            {shots.length === 0 ? (
              <p className="flex h-16 items-center justify-center rounded-2xl border border-dashed border-line px-4 text-center text-sm text-muted">
                拍下的照片会排在这里
              </p>
            ) : (
              <div className="scroller flex snap-x gap-3 overflow-x-auto pb-1">
                {shots.map((shot) => (
                  <button
                    key={shot.id}
                    type="button"
                    onClick={() => setActiveId(shot.id)}
                    className={
                      "print-shadow w-24 shrink-0 snap-start bg-fg p-1.5 pb-2 text-left " +
                      (shot.id === lastId ? "ring-2 ring-primary" : "")
                    }
                  >
                    <img
                      src={shot.url}
                      alt={`${shot.filterName}照片`}
                      className="aspect-[3/4] w-full object-cover"
                    />
                    <span className="mt-1 block truncate text-center text-xs text-bg">
                      {shot.frameCount > 1 ? `${shot.filterName} · 三条` : shot.filterName}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {active && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-bg/80 p-4 sm:items-center"
          onClick={() => setActiveId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="shot-title"
            className="w-full max-w-md rounded-3xl bg-surface p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="shot-title" className="text-base font-semibold">
                {active.frameCount > 1 ? "连拍三条" : "单张照片"} · {active.filterName}
              </h2>
              <button
                ref={closeRef}
                type="button"
                aria-label="关闭"
                onClick={() => setActiveId(null)}
                className="grid size-11 place-items-center rounded-full bg-surface-2"
              >
                <X className="size-5" />
              </button>
            </div>
            <img src={active.url} alt="" className="lightbox-photo rounded-2xl" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => downloadShot(active)}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-primary font-medium text-primary-ink transition-transform duration-150 ease-out active:scale-[0.96]"
              >
                <Download className="size-4" />
                下载
              </button>
              <button
                type="button"
                onClick={() => void onDelete(active)}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-surface-2 font-medium transition-transform duration-150 ease-out active:scale-[0.96]"
              >
                <Trash2 className="size-4" />
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Segment<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-muted" id={`${label}-label`}>
        {label}
      </p>
      <div className="flex gap-1 rounded-full bg-surface p-1" role="radiogroup" aria-labelledby={`${label}-label`}>
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={
                "h-11 flex-1 rounded-full text-sm font-medium transition-colors duration-200 disabled:opacity-50 " +
                (on ? "bg-primary text-primary-ink" : "text-muted")
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function IconButton({
  label,
  pressed,
  children,
  ...props
}: {
  label: string;
  pressed?: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={
        "grid size-12 place-items-center rounded-full transition-transform duration-150 ease-out active:scale-[0.96] disabled:opacity-40 " +
        (pressed ? "bg-primary text-primary-ink" : "bg-surface text-fg")
      }
      {...props}
    >
      {children}
    </button>
  );
}
