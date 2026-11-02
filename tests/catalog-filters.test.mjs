import test from "node:test";
import assert from "node:assert/strict";
import { filterCatalogProducts, getCatalogCategories } from "../lib/catalog-filters.mjs";

const products = [
  { id: "1", name: "Crema hidratante", category: "Cuidado", presentation: "Pomo" },
  { id: "2", name: "Vitamina C", category: "Suplementos", presentation: "Comprimidos" },
];

test("categories are derived from currently available catalog products", () => {
  assert.deepEqual(getCatalogCategories(products), ["Todas", "Cuidado", "Suplementos"]);
  assert.deepEqual(getCatalogCategories([]), ["Todas"]);
});

test("active public categories remain selectable when no online products are eligible", () => {
  assert.deepEqual(
    getCatalogCategories([], ["Cuidado", "General", "Cuidado"]),
    ["Todas", "Cuidado", "General"],
  );
  assert.deepEqual(
    getCatalogCategories([products[0]], ["General"]),
    ["Todas", "General", "Cuidado"],
  );
});

test("catalog filters preserve all products and match category and normalized search", () => {
  assert.deepEqual(filterCatalogProducts(products, "Todas", "  VITAMINA "), [products[1]]);
  assert.deepEqual(filterCatalogProducts(products, "Cuidado", ""), [products[0]]);
  assert.deepEqual(filterCatalogProducts(products, "No existe", ""), []);
});
