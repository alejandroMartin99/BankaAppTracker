/** Categoría sin clasificar (Otro / Otros / otros del importador). */
export function isOtherCategory(cat: string | undefined | null): boolean {
  const c = (cat || '').trim().toLowerCase();
  return c === 'otro' || c === 'otros';
}
