import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMERA_PATTERN,
  appendCameraPatternPoint,
  isCompleteCameraPattern,
} from "../lib/camera-pattern.mjs";

test("the camera pattern follows the exact L path with the shared corner once", () => {
  assert.deepEqual(CAMERA_PATTERN, [0, 3, 6, 7, 8]);
  let entered = [];
  for (const point of CAMERA_PATTERN) {
    entered = appendCameraPatternPoint(entered, point);
  }
  assert.equal(isCompleteCameraPattern(entered), true);
});

test("accepts arbitrary distinct points while tracing and validates only after five", () => {
  let entered = [];
  for (const point of [8, 1, 4, 7]) entered = appendCameraPatternPoint(entered, point);
  assert.deepEqual(entered, [8, 1, 4, 7]);
  assert.equal(isCompleteCameraPattern(entered), false);
  entered = appendCameraPatternPoint(entered, 2);
  assert.equal(entered.length, 5);
  assert.equal(isCompleteCameraPattern(entered), false);
});

test("ignores repeated or invalid points without changing the trace", () => {
  const entered = [0, 3];
  assert.equal(appendCameraPatternPoint(entered, 3), entered);
  assert.equal(appendCameraPatternPoint(entered, -1), entered);
  assert.equal(appendCameraPatternPoint(entered, 9), entered);
  assert.equal(appendCameraPatternPoint(CAMERA_PATTERN, 2), CAMERA_PATTERN);
});

test("does not accept an incomplete or out-of-order L", () => {
  assert.equal(isCompleteCameraPattern([0, 3, 6, 7]), false);
  assert.equal(isCompleteCameraPattern([0, 3, 6, 8, 7]), false);
});
