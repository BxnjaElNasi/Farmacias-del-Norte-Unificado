export const CAMERA_PATTERN = Object.freeze([0, 3, 6, 7, 8]);

export function isCompleteCameraPattern(pattern) {
  return pattern.length === CAMERA_PATTERN.length
    && pattern.every((point, index) => point === CAMERA_PATTERN[index]);
}

export function appendCameraPatternPoint(pattern, point) {
  if (!Number.isInteger(point) || point < 0 || point > 8 || pattern.length >= CAMERA_PATTERN.length || pattern.includes(point)) {
    return pattern;
  }
  return [...pattern, point];
}
