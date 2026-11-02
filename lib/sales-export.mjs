import ExcelJS from "exceljs";

function styleSheet(sheet) {
  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF176F5D" } };
    cell.alignment = { vertical: "middle" };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(sheet.columnCount).letter}1` };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.alignment = { vertical: "middle" };
      });
    }
  });
}

export async function buildSalesWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Farmacias del Norte";
  workbook.subject = "Exportación de ventas";
  workbook.created = new Date();

  const salesSheet = workbook.addWorksheet("Ventas");
  salesSheet.columns = [
    { header: "ID de venta", key: "saleId", width: 38 },
    { header: "Operación", key: "transaction", width: 23 },
    { header: "Fecha y hora", key: "createdAt", width: 22, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    { header: "Sucursal", key: "branch", width: 24 },
    { header: "Responsable", key: "cashier", width: 24 },
    { header: "Estado", key: "status", width: 18 },
    { header: "Medio de pago", key: "payment", width: 20 },
    { header: "Subtotal (ARS)", key: "subtotal", width: 17, style: { numFmt: '"$"#,##0.00' } },
    { header: "Descuento (ARS)", key: "discount", width: 18, style: { numFmt: '"$"#,##0.00' } },
    { header: "Total (ARS)", key: "total", width: 17, style: { numFmt: '"$"#,##0.00' } },
  ];

  const lineSheet = workbook.addWorksheet("Artículos por venta");
  lineSheet.columns = [
    { header: "ID de venta", key: "saleId", width: 38 },
    { header: "Operación", key: "transaction", width: 23 },
    { header: "Fecha y hora", key: "createdAt", width: 22, style: { numFmt: "dd/mm/yyyy hh:mm" } },
    { header: "Sucursal", key: "branch", width: 24 },
    { header: "Responsable", key: "cashier", width: 24 },
    { header: "Estado", key: "status", width: 18 },
    { header: "Medio de pago", key: "payment", width: 20 },
    { header: "Código de producto", key: "code", width: 23 },
    { header: "Producto", key: "product", width: 34 },
    { header: "Unidades", key: "quantity", width: 12 },
    { header: "Precio unitario (ARS)", key: "unitPrice", width: 22, style: { numFmt: '"$"#,##0.00' } },
    { header: "Total de línea (ARS)", key: "lineTotal", width: 22, style: { numFmt: '"$"#,##0.00' } },
  ];

  const saleIds = new Set();
  for (const row of rows) {
    if (!saleIds.has(row.id)) {
      saleIds.add(row.id);
      salesSheet.addRow({
        saleId: row.id,
        transaction: row.transaction_number,
        createdAt: new Date(row.created_at),
        branch: row.branch_name,
        cashier: row.cashier,
        status: row.status,
        payment: row.payment_method,
        subtotal: Number(row.subtotal),
        discount: Number(row.discount),
        total: Number(row.total),
      });
    }
    lineSheet.addRow({
      saleId: row.id,
      transaction: row.transaction_number,
      createdAt: new Date(row.created_at),
      branch: row.branch_name,
      cashier: row.cashier,
      status: row.status,
      payment: row.payment_method,
      code: row.internal_code,
      product: row.product_name,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
      lineTotal: Number(row.line_total),
    });
  }

  styleSheet(salesSheet);
  styleSheet(lineSheet);
  return workbook;
}
