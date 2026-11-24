export type Facing = "user" | "environment";

export type CamStatus =
  | "idle"
  | "requesting"
  | "live"
  | "denied"
  | "missing"
  | "busy"
  | "unsupported"
  | "insecure"
  | "error";

export function classifyCameraError(err: unknown): CamStatus {
  if (!(err instanceof DOMException)) return "error";
  switch (err.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "missing";
    case "NotReadableError":
    case "TrackStartError":
      return "busy";
    case "SecurityError":
      return "insecure";
    default:
      return "error";
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function openCamera(facing: Facing): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { exact: facing },
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
    },
    {
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
    },
    { audio: false, video: true },
  ];

  let last: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      last = err;
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError" || err.name === "SecurityError") throw err;
      }
    }
  }
  throw last instanceof Error ? last : new Error("无法打开摄像头");
}

export async function countCameras(): Promise<number> {
  if (!navigator.mediaDevices?.enumerateDevices) return 0;
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === "videoinput").length;
}
