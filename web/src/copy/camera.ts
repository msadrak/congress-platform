import type { CopyShape } from "./useCopy";

/** Words of the shared QR camera input (`components/QrCameraInput.tsx`): booth, desk, scanner pairing and network. */
const fa = {
  turnOn: "روشن کردن دوربین",
  turnOff: "خاموش کردن دوربین",
  preview: "پیش‌نمایش دوربین",
  starting: "در انتظار اجازهٔ دوربین…",
  live: "کد QR کارت ورود را جلوی دوربین بگیرید.",
  denied: "اجازهٔ دوربین داده نشد. کد را دستی وارد کنید.",
  unavailable: "دوربین در دسترس نیست یا اتصال امن نیست. کد را دستی وارد کنید.",
} as const;

const en: CopyShape<typeof fa> = {
  turnOn: "Turn on camera",
  turnOff: "Turn off camera",
  preview: "Camera preview",
  starting: "Waiting for camera permission…",
  live: "Hold the pass QR code in front of the camera.",
  denied: "Camera permission was denied. Enter the code manually.",
  unavailable: "No usable camera (or the page is not secure). Enter the code manually.",
};

export const cameraCopy = { fa, en };
