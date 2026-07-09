// Спільне форматування номера версії між main і renderer.

/**
 * Внутрішній лічильник версії — суцільне число, що піднімається на 1 при
 * кожному push (0 = ще не вивантажено, 1 = перший push). Показуємо як
 * "v<major>.<minor>", з відліком мінорної частини від нуля: перший push —
 * v1.000, далі v1.001 ... v1.999, тоді мінорна скидається і піднімається
 * старша (v2.000, v2.001, ... v2.999, v3.000, ...).
 */
export function formatVersion(n: number): string {
  const i = Math.max(0, n - 1)
  const major = 1 + Math.floor(i / 1000)
  const minor = i % 1000
  return `v${major}.${String(minor).padStart(3, '0')}`
}
