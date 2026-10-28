import { strict as assert } from "node:assert/strict";
import { describe, it } from "node:test";
import { createNativeQrDetector, createQrFrameDecoder, decodeSize, type ImageQrReader, type NativeQrDetector } from "../src/lib/qrFrameDecoder.ts";

const VIDEO = {} as HTMLVideoElement;
const IMAGE = { data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData;
const grabFrame = () => IMAGE;

function detector(result: () => { rawValue?: string }[]): NativeQrDetector & { calls: number } {
  const fake = {
    calls: 0,
    async detect() {
      fake.calls += 1;
      return result();
    },
  };
  return fake;
}

function engine(read: () => Promise<string | null>, ready = true): ImageQrReader & { calls: number } {
  const fake = {
    ready,
    calls: 0,
    read() {
      fake.calls += 1;
      return read();
    },
  };
  return fake;
}

function fallback(value: string | null) {
  const fake = Object.assign(() => {
    fake.calls += 1;
    return value;
  }, { calls: 0 });
  return fake;
}

describe("createNativeQrDetector", () => {
  it("is null without the API, without QR support, or when the support check fails", async () => {
    class Detector {
      static async getSupportedFormats() {
        return [] as string[];
      }
      async detect() {
        return [];
      }
    }
    class Broken extends Detector {
      static override async getSupportedFormats(): Promise<string[]> {
        throw new Error("service unavailable");
      }
    }
    assert.equal(await createNativeQrDetector(undefined), null);
    assert.equal(await createNativeQrDetector(Detector), null);
    assert.equal(await createNativeQrDetector(Broken), null);
  });

  it("is the detector when QR is supported", async () => {
    class Detector {
      static async getSupportedFormats() {
        return ["ean_13", "qr_code"];
      }
      async detect() {
        return [];
      }
    }
    assert.ok((await createNativeQrDetector(Detector)) instanceof Detector);
  });
});

describe("decodeSize", () => {
  it("keeps a 720p frame and scales a 1080p or portrait 4K frame down to 1280 on the longer side", () => {
    assert.deepEqual(decodeSize(1280, 720), { width: 1280, height: 720 });
    assert.deepEqual(decodeSize(640, 480), { width: 640, height: 480 });
    assert.deepEqual(decodeSize(1920, 1080), { width: 1280, height: 720 });
    assert.deepEqual(decodeSize(2160, 3840), { width: 720, height: 1280 });
  });
});

describe("createQrFrameDecoder", () => {
  it("takes the native value without reading the frame again", async () => {
    const zxing = engine(async () => "from-zxing");
    const decoder = createQrFrameDecoder({ detector: Promise.resolve(detector(() => [{ rawValue: " abc " }])), reader: zxing, grabFrame });
    assert.equal(await decoder.decode(VIDEO), "abc");
    assert.equal(zxing.calls, 0);
  });

  it("reads the frame with ZXing when the native detector finds nothing (Android without the barcode module)", async () => {
    const jsqr = fallback("from-jsqr");
    const decoder = createQrFrameDecoder({ detector: Promise.resolve(detector(() => [])), reader: engine(async () => " abc "), grabFrame, readFallback: jsqr });
    assert.equal(await decoder.decode(VIDEO), "abc");
    assert.equal(jsqr.calls, 0);
  });

  it("drops a native detector that keeps throwing", async () => {
    const native = detector(() => {
      throw new Error("Barcode detection service unavailable");
    });
    const zxing = engine(async () => null);
    const decoder = createQrFrameDecoder({ detector: Promise.resolve(native), reader: zxing, grabFrame });
    for (let frame = 0; frame < 5; frame += 1) assert.equal(await decoder.decode(VIDEO), null);
    assert.equal(native.calls, 3);
    assert.equal(zxing.calls, 5);
  });

  it("reads with jsQR while ZXing is still loading", async () => {
    const zxing = engine(async () => "from-zxing", false);
    const decoder = createQrFrameDecoder({ detector: Promise.resolve(null), reader: zxing, grabFrame, readFallback: fallback("abc") });
    assert.equal(await decoder.decode(VIDEO), "abc");
    assert.equal(zxing.calls, 0);
  });

  it("falls back to jsQR for good after ZXing fails three frames in a row", async () => {
    const zxing = engine(async () => {
      throw new Error("QR engine timed out");
    });
    const jsqr = fallback("abc");
    const decoder = createQrFrameDecoder({ detector: Promise.resolve(null), reader: zxing, grabFrame, readFallback: jsqr });
    assert.equal(await decoder.decode(VIDEO), null);
    assert.equal(await decoder.decode(VIDEO), null);
    assert.equal(await decoder.decode(VIDEO), null);
    assert.equal(await decoder.decode(VIDEO), "abc");
    assert.equal(zxing.calls, 3);
    assert.equal(jsqr.calls, 1);
  });

  it("uses jsQR alone without a native detector or ZXing, and ignores a blank value", async () => {
    const decoder = createQrFrameDecoder({ detector: Promise.resolve(null), reader: null, grabFrame, readFallback: fallback("  ") });
    assert.equal(await decoder.decode(VIDEO), null);
  });

  it("skips a frame it cannot copy", async () => {
    const jsqr = fallback("abc");
    const decoder = createQrFrameDecoder({ detector: Promise.resolve(null), reader: null, grabFrame: () => null, readFallback: jsqr });
    assert.equal(await decoder.decode(VIDEO), null);
    assert.equal(jsqr.calls, 0);
  });
});
