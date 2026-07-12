// Shared version number formatting between main and renderer.

/**
 * Internal version counter — a plain integer that increments by 1 on every
 * push (0 = not uploaded yet, 1 = first push). Displayed as
 * "v<major>.<minor>", with the minor part counted from zero: first push is
 * v1.000, then v1.001 ... v1.999, at which point minor resets and major
 * increments (v2.000, v2.001, ... v2.999, v3.000, ...).
 */
export function formatVersion(n: number): string {
  const i = Math.max(0, n - 1)
  const major = 1 + Math.floor(i / 1000)
  const minor = i % 1000
  return `v${major}.${String(minor).padStart(3, '0')}`
}
