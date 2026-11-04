type CameraDevice = Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">;

/** The lens the operator picked with "next camera", kept per device (shared by every scanning screen). */
const DEVICE_KEY = "congress_camera_device";
/** Enough pixels for a pass held at arm's length; phones that cannot give it pick their closest size. */
const RESOLUTION = { width: { ideal: 1280 }, height: { ideal: 720 } } as const;

/**
 * The Android main rear camera. Chrome names lenses "camera2 <id>, facing back" and id 0 is the primary one;
 * on phones with several rear lenses `facingMode: environment` can land on an ultra-wide or macro lens that
 * cannot focus on a code held close. Null when the labels do not say (iPhone, desktop, before permission).
 */
export function mainBackCamera(devices: CameraDevice[]): string | null {
  let main: { id: string; number: number } | null = null;
  for (const device of devices) {
    if (device.kind !== "videoinput") continue;
    const match = /camera2 (\d+), facing back/i.exec(device.label);
    if (!match) continue;
    const number = Number(match[1]);
    if (!main || number < main.number) main = { id: device.deviceId, number };
  }
  return main?.id ?? null;
}

/** The camera after `currentId`, wrapping around; null when there is no other camera to go to. */
export function nextCamera(devices: CameraDevice[], currentId: string | undefined): string | null {
  const cameras = devices.filter((device) => device.kind === "videoinput" && device.deviceId);
  if (cameras.length < 2) return null;
  const index = cameras.findIndex((camera) => camera.deviceId === currentId);
  return cameras[(index + 1) % cameras.length].deviceId;
}

async function listCameras(): Promise<CameraDevice[]> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
  } catch {
    return [];
  }
}

function storedCamera(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

function rememberCamera(deviceId: string) {
  try {
    localStorage.setItem(DEVICE_KEY, deviceId);
  } catch {
    // storage blocked: the default lens is used next time
  }
}

const isPermissionError = (error: unknown) =>
  error instanceof Error && (error.name === "NotAllowedError" || error.name === "SecurityError" || error.name === "PermissionDeniedError");

const openDevice = (deviceId: string) =>
  navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, ...RESOLUTION }, audio: false });
const openBackFacing = () => navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, ...RESOLUTION }, audio: false });

/** Asks the camera to keep refocusing: some Android cameras otherwise stay blurry on a code held close. */
async function preferContinuousFocus(stream: MediaStream): Promise<void> {
  for (const track of stream.getVideoTracks()) {
    const modes = (track.getCapabilities?.() as { focusMode?: string[] } | undefined)?.focusMode;
    if (!modes?.includes("continuous")) continue;
    try {
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
    } catch {
      // the camera keeps its own focus mode
    }
  }
}

/**
 * Opens the camera for scanning: the lens the operator picked, else the main rear lens, at a resolution that
 * reads a code from arm's length, with continuous focus where the camera offers it. A remembered lens that is
 * gone falls back to the rear camera; a refused permission is thrown as it is.
 */
export async function openScannerCamera(): Promise<MediaStream> {
  // Labels (and so the main lens) are known up front once the camera was allowed before.
  const chosen = storedCamera() ?? mainBackCamera(await listCameras());
  let stream: MediaStream | null = null;
  if (chosen) {
    try {
      stream = await openDevice(chosen);
    } catch (error) {
      if (isPermissionError(error)) throw error;
    }
  }
  if (!stream) {
    stream = await openBackFacing();
    // First permission grant: the labels appear only now, so a wrong lens is swapped once.
    const main = chosen ? null : mainBackCamera(await listCameras());
    if (main && main !== cameraId(stream)) {
      stream.getTracks().forEach((track) => track.stop());
      try {
        stream = await openDevice(main);
      } catch {
        stream = await openBackFacing();
      }
    }
  }
  await preferContinuousFocus(stream);
  return stream;
}

export function cameraId(stream: MediaStream | null): string | undefined {
  return stream?.getVideoTracks()[0]?.getSettings().deviceId;
}

/** True when the device has another camera to switch to. */
export async function canSwitchCamera(): Promise<boolean> {
  return (await listCameras()).length > 1;
}

/** Remembers the camera after the one `stream` uses, for the next `openScannerCamera`; false when there is none. */
export async function chooseNextCamera(stream: MediaStream | null): Promise<boolean> {
  const next = nextCamera(await listCameras(), cameraId(stream));
  if (!next) return false;
  rememberCamera(next);
  return true;
}

/** Whether the stream's camera has a light the page can turn on. */
export function hasTorch(stream: MediaStream | null): boolean {
  const track = stream?.getVideoTracks()[0];
  return (track?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch === true;
}

/** Turns the camera light on or off; false when the camera refused. */
export async function setTorch(stream: MediaStream | null, on: boolean): Promise<boolean> {
  const track = stream?.getVideoTracks()[0];
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}
