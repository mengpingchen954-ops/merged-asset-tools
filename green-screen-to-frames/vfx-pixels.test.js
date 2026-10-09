import test from "node:test";
import assert from "node:assert/strict";
import { processVfxPixels } from "./vfx-pixels.js";

test("soft alpha removes black and reconstructs dim glows without a second darkening", () => {
  const input = new Uint8ClampedArray([0, 0, 0, 255, 20, 10, 2, 255, 160, 80, 0, 128, 255, 255, 255, 255]);
  const result = processVfxPixels(input.slice());
  assert.deepEqual([...result.slice(0, 4)], [0, 0, 0, 0]);
  assert.equal(result[7], 20);
  assert.equal(result[4], 255);
  for (let i = 0; i < input.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      assert.ok(Math.abs(result[i + channel] * result[i + 3] / 255 - input[i + channel] * input[i + 3] / 255) <= 1);
    }
  }
});

test("additive default preserves opaque video RGB and flattens transparent GIF pixels onto black", () => {
  const opaque = new Uint8ClampedArray([20, 10, 2, 255, 255, 160, 0, 255]);
  assert.deepEqual(processVfxPixels(opaque.slice(), { mode: "additive" }), opaque);
  assert.deepEqual([...processVfxPixels(new Uint8ClampedArray([100, 50, 0, 0, 100, 50, 0, 128]), { mode: "additive" })], [0, 0, 0, 255, 50, 25, 0, 255]);
});

test("black level suppresses noise, gain clamps highlights, and invalid parameters fail", () => {
  assert.deepEqual([...processVfxPixels(new Uint8ClampedArray([2, 1, 0, 255]), { blackLevel: 0.02 })], [0, 0, 0, 0]);
  assert.deepEqual([...processVfxPixels(new Uint8ClampedArray([200, 100, 0, 255]), { mode: "additive", gain: 2 })], [255, 200, 0, 255]);
  for (const options of [{ mode: "other" }, { blackLevel: 1 }, { blackLevel: -1 }, { gain: NaN }, { gain: 3 }]) {
    assert.throws(() => processVfxPixels(new Uint8ClampedArray(4), options));
  }
});
