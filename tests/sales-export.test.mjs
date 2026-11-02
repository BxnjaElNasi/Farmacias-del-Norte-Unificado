import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buildSalesWorkbook } from "../lib/sales-export.mjs";

test("exports each sale and each product line into separate, readable columns", async () => {
  const generatedWorkbook = await buildSalesWorkbook([
    {
      id: "sale-uuid-1",
      transaction_number: "V-2026-0001",
      created_at: "2026-10-30T12:15:00.000Z",
      branch_name: "Sucursal Centro",
      cashier: "María López",
      status: "completed",
      payment_method: "cash",
      subtotal: "1500.00",
      discount: "100.00",
      total: "1400.00",
      internal_code: "MED-001",
      product_name: "Producto A",
      quantity: "2",
      unit_price: "500.00",
      line_total: "1000.00",
    },
    {
      id: "sale-uuid-1",
      transaction_number: "V-2026-0001",
      created_at: "2026-10-30T12:15:00.000Z",
      branch_name: "Sucursal Centro",
      cashier: "María López",
      status: "completed",
      payment_method: "cash",
      subtotal: "1500.00",
      discount: "100.00",
      total: "1400.00",
      internal_code: "MED-002",
      product_name: "Producto B",
      quantity: "1",
      unit_price: "500.00",
      line_total: "500.00",
    },
  ]);
  const serialized = Buffer.from(await generatedWorkbook.xlsx.writeBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(serialized);
  const operations = workbook.getWorksheet("Ventas");
  const details = workbook.getWorksheet("Artículos por venta");

  assert.ok(operations);
  assert.ok(details);
  assert.equal(operations.rowCount, 2);
  assert.equal(details.rowCount, 3);
  assert.deepEqual(
    operations.getRow(1).values.slice(1, 6),
    ["ID de venta", "Operación", "Fecha y hora", "Sucursal", "Responsable"],
  );
  assert.equal(operations.getRow(2).getCell(1).value, "sale-uuid-1");
  assert.equal(operations.getRow(2).getCell(10).value, 1400);
  assert.deepEqual(
    details.getRow(2).values.slice(1, 10),
    [
      "sale-uuid-1",
      "V-2026-0001",
      new Date("2026-10-30T12:15:00.000Z"),
      "Sucursal Centro",
      "María López",
      "completed",
      "cash",
      "MED-001",
      "Producto A",
    ],
  );
  assert.equal(details.getRow(2).getCell(10).value, 2);
  assert.equal(details.getRow(2).getCell(11).value, 500);
  assert.equal(details.getRow(2).getCell(12).value, 1000);
  assert.equal(details.getRow(3).getCell(1).value, "sale-uuid-1");
  assert.equal(details.getRow(3).getCell(9).value, "Producto B");
});
