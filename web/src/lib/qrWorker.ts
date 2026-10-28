// The QR engine off the main thread: ZXing-C++ (WebAssembly), served from this origin rather than the package's
// CDN default, so it works offline (precached with the app) and where the CDN is unreachable.
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import type { QrWorkerReply, QrWorkerRequest } from "./qrFrameDecoder";

const post = (reply: QrWorkerReply) => (self as unknown as { postMessage(message: QrWorkerReply): void }).postMessage(reply);

prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
  fireImmediately: true,
}).then(
  () => post({ type: "ready" }),
  () => post({ type: "failed" })
);

self.addEventListener("message", (event: MessageEvent<QrWorkerRequest>) => {
  const { id, image } = event.data;
  // ZXing's defaults already try harder, rotated and inverted (light-on-dark) codes.
  readBarcodes(image, { formats: ["QRCode"], maxNumberOfSymbols: 1 }).then(
    (results) => post({ type: "result", id, value: results.find((result) => result.isValid)?.text ?? null }),
    () => post({ type: "error", id })
  );
});
