export function getCatalogCategories(
  products: Array<{ category: string }>,
  activeCategories?: string[],
): string[];

export function filterCatalogProducts<T extends {
  name: string;
  category: string;
  presentation: string;
}>(products: T[], category: string, search: string): T[];
