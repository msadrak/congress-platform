import { strict as assert } from "node:assert/strict";
import { describe, it } from "node:test";
import { mainBackCamera, nextCamera } from "../src/lib/scannerCamera.ts";

const camera = (deviceId: string, label: string) => ({ deviceId, label, kind: "videoinput" as MediaDeviceKind });

describe("mainBackCamera", () => {
  it("picks Android's primary rear lens (camera2 0) over the ultra-wide and macro lenses", () => {
    const devices = [
      camera("wide", "camera2 2, facing back"),
      camera("front", "camera2 1, facing front"),
      camera("main", "camera2 0, facing back"),
      camera("macro", "camera2 3, facing back"),
      { deviceId: "mic", label: "camera2 0, facing back", kind: "audioinput" as MediaDeviceKind },
    ];
    assert.equal(mainBackCamera(devices), "main");
  });

  it("is null when the labels do not say (iPhone, desktop, or before permission)", () => {
    assert.equal(mainBackCamera([camera("a", "Back Camera"), camera("b", "Front Camera")]), null);
    assert.equal(mainBackCamera([camera("a", ""), camera("b", "")]), null);
    assert.equal(mainBackCamera([camera("front", "camera2 1, facing front")]), null);
  });
});

describe("nextCamera", () => {
  const devices = [camera("a", "camera2 0, facing back"), camera("b", "camera2 1, facing front"), camera("c", "camera2 2, facing back")];

  it("goes to the following camera and wraps around", () => {
    assert.equal(nextCamera(devices, "a"), "b");
    assert.equal(nextCamera(devices, "c"), "a");
  });

  it("starts from the first camera when the current one is unknown", () => {
    assert.equal(nextCamera(devices, undefined), "a");
  });

  it("is null with a single camera", () => {
    assert.equal(nextCamera([camera("a", "Back Camera")], "a"), null);
  });
});
