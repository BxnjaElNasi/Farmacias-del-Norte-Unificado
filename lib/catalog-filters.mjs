export function getCatalogCategories(products, activeCategories = []) {
  return ["Todas", ...new Set([
    ...activeCategories,
    ...products.map((product) => product.category),
  ].filter(Boolean))];
}

export function filterCatalogProducts(products, category, search) {
  const normalizedSearch = search.trim().toLowerCase();
  return products.filter((product) => (
    (category === "Todas" || product.category === category)
    && `${product.name} ${product.category} ${product.presentation}`.toLowerCase().includes(normalizedSearch)
  ));
}
