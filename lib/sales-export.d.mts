import type ExcelJS from "exceljs";

export type SaleExportRow = {
  id: string;
  transaction_number: string;
  status: string;
  payment_method: string;
  subtotal: number | string;
  discount: number | string;
  total: number | string;
  created_at: string | Date;
  branch_name: string;
  cashier: string;
  quantity: number | string;
  unit_price: number | string;
  line_total: number | string;
  internal_code: string;
  product_name: string;
};

export function buildSalesWorkbook(rows: SaleExportRow[]): Promise<ExcelJS.Workbook>;
