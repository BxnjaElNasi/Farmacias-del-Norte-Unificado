"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { appendCameraPatternPoint, isCompleteCameraPattern } from "@/lib/camera-pattern.mjs";

type User = {
  id: string;
  email: string;
  fullName: string;
  role: "admin" | "employee";
  branchId: string | null;
  branchName: string | null;
};

type Branch = {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  image_url: string;
  delivery_zone: string;
  active: boolean;
  product_count: number;
  total_stock: number;
};

type Product = {
  id: string;
  internal_code: string;
  barcode: string | null;
  name: string;
  active_ingredient: string;
  category: string;
  category_id: string;
  manufacturer: string;
  presentation: string;
  cost_price: number | null;
  sale_price: number;
  minimum_stock: number;
  active: boolean;
  requires_prescription: boolean;
  cover_image_url: string;
  online_enabled: boolean;
  online_featured: boolean;
  online_description: string;
  stock: number;
};

type DashboardData = {
  summary: {
    product_count: number;
    branch_count: number;
    sales_today: number;
    revenue_today: number;
    low_stock_count: number;
    expiring_count: number;
    expired_count: number;
  };
  lowStock: Array<{ id: string; name: string; internal_code: string; quantity: number; minimum_stock: number; branch_name: string }>;
  expiring: Array<{ name: string; lot_number: string; expires_on: string; quantity: number; branch_name: string }>;
  expired: Array<{ name: string; lot_number: string; expires_on: string; quantity: number; branch_name: string }>;
  movements: Array<{ id: string; movement_type: string; quantity: number; reason: string; created_at: string; product_name: string; branch_name: string; user_name: string }>;
  dailySales: Array<{ label: string; total: number }>;
  branchSales: Array<{ id: string; name: string; total: number }>;
  topProducts: Array<{ name: string; quantity: number; revenue: number }>;
};

type InventoryData = {
  stock: Array<{ product_id: string; internal_code: string; name: string; minimum_stock: number; quantity: number; lots: Array<{ id: string; branchId: string; branchName: string; lotNumber: string; expiresOn: string | null; quantity: number }> }>;
  movements: Array<{
    id: string;
    branch_id: string;
    branch_name: string;
    branch_address: string;
    branch_phone: string;
    movement_type: string;
    quantity: number;
    reason: string;
    created_at: string;
    updated_at: string;
    product_name: string;
    internal_code: string;
    lot_number: string | null;
    expires_on: string | null;
    edited_by: string | null;
    user_name: string;
  }>;
};

type Sale = {
  id: string;
  transaction_number: string;
  status: string;
  payment_method: string;
  subtotal: number;
  discount: number;
  total: number;
  created_at: string;
  branch_name: string;
  cashier: string;
  items: Array<{ name: string; code: string; quantity: number; unitPrice: number; lineTotal: number }>;
};

type UserRecord = {
  id: string;
  email: string;
  full_name: string;
  role: User["role"];
  branch_id: string | null;
  active: boolean;
  branch_name: string | null;
  isCurrentUser: boolean;
};

type Category = { id: string; name: string; active: boolean };
type OnlineOrder = {
  id: string;
  order_number: string;
  branch_id: string;
  branch_name: string;
  status: string;
  fulfillment_mode: "pickup" | "delivery";
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  delivery_address: string;
  delivery_zone: string;
  subtotal: number;
  total: number;
  created_at: string;
  reservation_expires_at: string;
  items: Array<{ name: string; code: string; quantity: number; unitPrice: number; lineTotal: number }>;
};

type PriceHistoryEntry = {
  id: string;
  branch_id: string | null;
  branch_name: string | null;
  changed_by: string;
  old_cost: number;
  new_cost: number;
  old_price: number;
  new_price: number;
  created_at: string;
};

type AppSection = "dashboard" | "branches" | "products" | "inventory" | "sales" | "users" | "orders" | "cameras";
type Modal = "branch" | "branch-edit" | "product" | "product-edit" | "price-history" | "inventory" | "user" | "user-edit" | "movement-edit" | null;

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const quantityFormat = new Intl.NumberFormat("es-AR");

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo completar la solicitud.");
  return payload as T;
}

function formatDateOnly(value: string | Date | null | undefined) {
  if (!value) return "Sin fecha";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-AR").format(value);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return new Intl.DateTimeFormat("es-AR").format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-AR").format(parsed);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("es", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const content = rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    const safeText = typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safeText.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function roleName(role: User["role"]) {
  return { admin: "Gerente general", employee: "Empleado" }[role];
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span className="empty-mark">✓</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function StatCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-top"><span>{label}</span><span className="stat-dot" /></div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export function FarmaciaApp() {
  const [authState, setAuthState] = useState<"loading" | "signed-out" | "ready">("loading");
  const [databaseConfigured, setDatabaseConfigured] = useState(true);
  const [accountMode, setAccountMode] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [section, setSection] = useState<AppSection>("dashboard");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [inventory, setInventory] = useState<InventoryData | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [orders, setOrders] = useState<OnlineOrder[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [editingMovement, setEditingMovement] = useState<InventoryData["movements"][number] | null>(null);
  const [receiptMovement, setReceiptMovement] = useState<InventoryData["movements"][number] | null>(null);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [receiptError, setReceiptError] = useState("");
  const [cameraUnlocked, setCameraUnlocked] = useState(false);
  const [cameraPattern, setCameraPattern] = useState<number[]>([]);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([]);
  const [notice, setNotice] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [todayLabel, setTodayLabel] = useState("");

  useEffect(() => {
    // Al salir de Administración (o recargarla) se cierra la sesión: hay que volver a ingresar.
    const logout = () => { void fetch("/api/auth/logout", { method: "POST", keepalive: true }); };
    window.addEventListener("pagehide", logout);
    return () => {
      window.removeEventListener("pagehide", logout);
      logout();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTodayLabel(new Intl.DateTimeFormat("es", { dateStyle: "long" }).format(new Date()));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const admin = user?.role === "admin";
  const branchId = user?.role === "admin" ? selectedBranch : user?.branchId || "";
  const visibleProducts = useMemo(
    () => products.filter((product) => `${product.name} ${product.internal_code} ${product.barcode ?? ""} ${product.category}`.toLowerCase().includes(search.toLowerCase())),
    [products, search],
  );
  const exportProducts = () => {
    const rows: Array<Array<string | number | null | undefined>> = [
      ["Código", "Código de barras", "Producto", "Categoría", "Costo", "Precio", "Stock", "Stock mínimo", "Estado", "Aprobado online", "Destacado", "Imagen"],
      ...visibleProducts.map((item) => [item.internal_code, item.barcode, item.name, item.category, item.cost_price, item.sale_price, item.stock, item.minimum_stock, item.active ? "Activo" : "Inactivo", item.online_enabled ? "Sí" : "No", item.online_featured ? "Sí" : "No", item.cover_image_url]),
    ];
    downloadCsv("productos-farmacias-del-norte.csv", rows);
  };

  const loadSectionData = useCallback(async (activeUser: User, activeSection: AppSection, scopeBranch: string) => {
    const branchQuery = scopeBranch ? `?branchId=${encodeURIComponent(scopeBranch)}` : "";
    const productParams = new URLSearchParams();
    if (scopeBranch) productParams.set("branchId", scopeBranch);
    if (activeUser.role === "admin" && includeInactive) productParams.set("includeInactive", "1");
    const productQuery = `/api/products${productParams.size ? `?${productParams.toString()}` : ""}`;
    if (activeSection === "dashboard") {
      setDashboard(null);
      setDashboardError("");
      try {
        const [summary, catalog] = await Promise.all([
          requestJson<DashboardData>(`/api/dashboard${branchQuery}`),
          requestJson<Product[]>(productQuery),
        ]);
        setDashboard(summary);
        setProducts(catalog);
      } catch (error) {
        setDashboardError(error instanceof Error ? error.message : "No se pudo cargar el resumen.");
        throw error;
      }
    }
    if (activeSection === "branches") {
      setBranches(await requestJson<Branch[]>("/api/branches"));
    }
    if (activeSection === "products") {
      setProducts(await requestJson<Product[]>(productQuery));
      setCategories(activeUser.role === "admin"
        ? await requestJson<Category[]>("/api/categories?includeInactive=1")
        : []);
    }
    if (activeSection === "inventory") {
      const [data, catalog] = await Promise.all([
        requestJson<InventoryData>(`/api/inventory${branchQuery}`),
        requestJson<Product[]>(productQuery),
      ]);
      setInventory(data);
      setProducts(catalog);
    }
    if (activeSection === "sales") {
      const [history, catalog] = await Promise.all([
        requestJson<Sale[]>(`/api/sales${branchQuery}`),
        scopeBranch ? requestJson<Product[]>(productQuery) : Promise.resolve([] as Product[]),
      ]);
      setSales(history);
      setProducts(catalog);
    }
    if (activeSection === "users" && activeUser.role === "admin") {
      setUsers(await requestJson<UserRecord[]>("/api/users"));
      setBranches(await requestJson<Branch[]>("/api/branches"));
    }
    if (activeSection === "orders") {
      setOrders(await requestJson<OnlineOrder[]>(`/api/orders${branchQuery}`));
    }
    if (activeUser.role === "admin" && branches.length === 0) {
      setBranches(await requestJson<Branch[]>("/api/branches"));
    }
  }, [branches.length, includeInactive]);

  const refresh = useCallback(async () => {
    if (!user) return;
    setBusy(true);
    try {
      await loadSectionData(user, section, branchId);
      setNotice(null);
    } catch (error) {
      const text = error instanceof Error ? error.message : "No se pudieron cargar los datos.";
      if (text.includes("Inicia sesión")) {
        setUser(null);
        setAuthState("signed-out");
      } else {
        setNotice({ type: "error", text });
      }
    } finally {
      setBusy(false);
    }
  }, [branchId, loadSectionData, section, user]);

  useEffect(() => {
    let active = true;
    requestJson<{ configured: boolean; user: User | null }>("/api/auth/me")
      .then((result) => {
        if (!active) return;
        setDatabaseConfigured(result.configured);
        if (!result.configured) {
          setAuthState("signed-out");
          return;
        }
        setUser(result.user);
        setAuthState(result.user ? "ready" : "signed-out");
      })
      .catch(() => {
        if (active) {
          setAuthState("signed-out");
          setNotice({ type: "error", text: "No se pudo contactar al servidor. Verifica que la aplicación esté en ejecución." });
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authState !== "ready" || !user) return;
    void Promise.resolve().then(() => loadSectionData(user, section, branchId)).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "No se pudieron cargar los datos.";
      if (text.includes("Inicia sesión")) {
        setUser(null);
        setAuthState("signed-out");
      } else {
        setNotice({ type: "error", text });
      }
    });
  }, [authState, branchId, loadSectionData, section, user]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await requestJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const session = await requestJson<{ user: User | null }>("/api/auth/me");
      setUser(session.user);
      setAuthState("ready");
      setNotice(null);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo iniciar sesión." });
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (password !== confirmPassword) {
      setNotice({ type: "error", text: "Las contraseñas no coinciden." });
      return;
    }
    setBusy(true);
    try {
      await requestJson("/api/store/accounts", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password, confirmPassword }),
      });
      formElement.reset();
      setAccountMode(false);
      setNotice({ type: "success", text: "Cuenta de compra creada. Esta cuenta no habilita el acceso administrativo." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo crear la cuenta." });
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await requestJson("/api/auth/logout", { method: "POST" });
    setUser(null);
    setAuthState("signed-out");
    setSection("dashboard");
    setCameraUnlocked(false);
    setCameraPattern([]);
  }

  async function showPriceHistory(product: Product) {
    setBusy(true);
    try {
      setPriceHistory(await requestJson<PriceHistoryEntry[]>(`/api/products/${product.id}`));
      setEditingProduct(product);
      setModal("price-history");
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo consultar el historial." });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    setBusy(true);
    try {
      let nextSection = section;
      if (modal === "branch" || modal === "branch-edit") {
        const url = modal === "branch-edit" && editingBranch ? `/api/branches/${editingBranch.id}` : "/api/branches";
        const method = modal === "branch-edit" ? "PATCH" : "POST";
        await requestJson(url, { method, body: JSON.stringify(modal === "branch-edit" ? { ...values, active: values.active === "on" } : values) });
        nextSection = "branches";
      } else if (modal === "product") {
        await requestJson("/api/products", {
          method: "POST",
          body: JSON.stringify({
            ...values,
            onlineDescription: values.onlineDescription ?? "",
            costPrice: Number(values.costPrice),
            salePrice: Number(values.salePrice),
            minimumStock: Number(values.minimumStock),
            requiresPrescription: values.requiresPrescription === "on",
            onlineEnabled: values.onlineEnabled === "on",
            onlineFeatured: values.onlineFeatured === "on",
          }),
        });
        nextSection = "products";
      } else if (modal === "product-edit" && editingProduct) {
        await requestJson(`/api/products/${editingProduct.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...values,
            onlineDescription: values.onlineDescription ?? "",
            costPrice: Number(values.costPrice),
            salePrice: Number(values.salePrice),
            minimumStock: Number(values.minimumStock),
            requiresPrescription: values.requiresPrescription === "on",
            onlineEnabled: values.onlineEnabled === "on",
            onlineFeatured: values.onlineFeatured === "on",
            active: values.active === "on",
          }),
        });
        nextSection = "products";
      } else if (modal === "inventory") {
        await requestJson("/api/inventory", {
          method: "POST",
          body: JSON.stringify({
            ...values,
            branchId: values.branchId || branchId,
            quantity: Number(values.quantity),
            expiresOn: values.expiresOn || null,
          }),
        });
        nextSection = "inventory";
      } else if (modal === "user") {
        await requestJson("/api/users", {
          method: "POST",
          body: JSON.stringify({ ...values, branchId: values.branchId }),
        });
        nextSection = "users";
      } else if (modal === "user-edit" && editingUser) {
        await requestJson(`/api/users/${editingUser.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...values,
            branchId: values.branchId || undefined,
            active: values.active === "on",
            password: values.password || undefined,
          }),
        });
        nextSection = "users";
      } else if (modal === "movement-edit" && editingMovement) {
        await requestJson(`/api/inventory/${editingMovement.id}`, {
          method: "PATCH",
          body: JSON.stringify({ reason: values.reason }),
        });
        nextSection = "inventory";
      }
      setModal(null);
      setSection(nextSection);
      if (user) await loadSectionData(user, nextSection, branchId);
      setEditingBranch(null);
      setEditingProduct(null);
      setEditingUser(null);
      setEditingMovement(null);
      setNotice({ type: "success", text: modal === "branch" ? "Sucursal registrada correctamente." : modal === "branch-edit" ? "Sucursal actualizada." : modal === "product" ? "Producto agregado al catálogo." : modal === "product-edit" ? "Producto actualizado." : modal === "user" ? "Usuario creado correctamente." : modal === "user-edit" ? "Usuario actualizado." : modal === "movement-edit" ? "Motivo actualizado; la cantidad y el historial de stock se conservaron." : "Movimiento de inventario registrado." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo guardar." });
    } finally {
      setBusy(false);
    }
  }

  async function handleSale(event: FormEvent<HTMLFormElement>): Promise<boolean> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const formElement = event.currentTarget;
    const items = [...event.currentTarget.querySelectorAll<HTMLDivElement>("[data-cart-item]")].map((row) => ({
      productId: row.dataset.productId,
      quantity: Number(row.dataset.quantity),
    }));
    if (!items.length || items.some((item) => !item.productId)) {
      setNotice({ type: "error", text: "Agrega al menos un producto a la venta." });
      return false;
    }
    setBusy(true);
    try {
      const response = await requestJson<{ transaction_number: string }>("/api/sales", {
        method: "POST",
        body: JSON.stringify({
          branchId,
          paymentMethod: form.get("paymentMethod"),
          items,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      formElement.reset();
      await refresh();
      setNotice({ type: "success", text: `Venta ${response.transaction_number} registrada.` });
      return true;
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo registrar la venta." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function deleteBranch(branch: Branch) {
    if (!window.confirm(`¿Eliminar la sucursal ${branch.name}? Si tiene ventas o movimientos no se borra, solo se desactiva para conservar el historial.`)) return;
    setBusy(true);
    try {
      const result = await requestJson<{ deleted: boolean; archived: boolean }>(`/api/branches/${branch.id}`, { method: "DELETE" });
      setModal(null);
      setEditingBranch(null);
      if (user) await loadSectionData(user, "branches", branchId);
      setNotice({ type: "success", text: result.deleted ? "Sucursal eliminada." : "La sucursal tiene historial, así que se desactivó en lugar de borrarse." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo eliminar la sucursal." });
    } finally {
      setBusy(false);
    }
  }

  async function setBranchActive(branch: Branch) {
    if (!window.confirm(`${branch.active ? "Desactivar" : "Reactivar"} ${branch.name}? Se conservarán sus ventas e historial.`)) return;
    try {
      await requestJson(`/api/branches/${branch.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !branch.active }),
      });
      if (user) await loadSectionData(user, "branches", branchId);
      setNotice({ type: "success", text: branch.active ? "Sucursal desactivada; se conservaron sus registros." : "Sucursal reactivada." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo actualizar la sucursal." });
    }
  }

  async function setUserActive(record: UserRecord) {
    if (!window.confirm(`${record.active ? "Desactivar" : "Reactivar"} la cuenta de ${record.full_name}?`)) return;
    try {
      await requestJson(`/api/users/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !record.active }),
      });
      if (user) await loadSectionData(user, "users", branchId);
      setNotice({ type: "success", text: record.active ? "Cuenta desactivada. Se cerraron sus sesiones activas." : "Cuenta reactivada." });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo actualizar la cuenta." });
    }
  }

  async function updateOrderStatus(order: OnlineOrder, status: string) {
    try {
      await requestJson("/api/orders", { method: "PATCH", body: JSON.stringify({ id: order.id, status }) });
      if (user) await loadSectionData(user, "orders", branchId);
      setNotice({ type: "success", text: `Pedido ${order.order_number}: ${orderStatusLabel(status)}.` });
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo actualizar el pedido." });
    }
  }

  async function exportSalesExcel() {
    try {
      const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
      const response = await fetch(`/api/sales/export${query}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "No se pudo exportar las ventas.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ventas-farmacias-del-norte-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "No se pudo exportar las ventas." });
    }
  }

  async function sendMovementReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receiptMovement) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await requestJson(`/api/inventory/${receiptMovement.id}/receipt`, {
        method: "POST",
        body: JSON.stringify({ email: form.get("email") }),
      });
      setNotice({ type: "success", text: "Comprobante interno enviado por correo." });
      setReceiptEmail("");
      setReceiptError("");
      setReceiptMovement(null);
    } catch (error) {
      setReceiptError(error instanceof Error ? error.message : "No se pudo enviar el comprobante.");
    } finally {
      setBusy(false);
    }
  }

  function enterCameraPattern(index: number) {
    if (!cameraPattern.length) setNotice(null);
    const next = appendCameraPatternPoint(cameraPattern, index);
    if (next === cameraPattern) return;
    setCameraPattern(next);
    if (next.length < 5) return;
    if (isCompleteCameraPattern(next)) {
      setCameraUnlocked(true);
      setCameraPattern([]);
      setNotice({ type: "success", text: "Patrón aceptado. El panel está disponible." });
    } else {
      setCameraPattern([]);
      setNotice({ type: "error", text: "Patrón incorrecto. Intenta nuevamente." });
    }
  }

  if (authState === "loading") {
    return <main className="center-screen"><img className="loading-mark" src="/farmacias-del-norte-logo.png" alt="Farmacias del Norte" /><span>Cargando Farmacias del Norte…</span></main>;
  }

  if (authState === "signed-out") {
    return (
      <main className="login-screen">
        <section className="login-brand-panel">
          <div className="brand-lockup"><img className="admin-brand-image" src="/farmacias-del-norte-logo.png" alt="" /><span><b>FARMACIAS</b><small>DEL NORTE</small></span></div>
          <div className="login-message">
            <span className="eyebrow">GESTIÓN CENTRALIZADA</span>
            <h1>Todo el cuidado.<br /><em>En un solo lugar.</em></h1>
            <p>Una mirada clara a cada sucursal, cada producto y cada movimiento.</p>
          </div>
          <div className="login-panel-foot">Plataforma de gestión · Acceso seguro</div>
        </section>
        <section className="login-form-panel">
          <form className="login-card" autoComplete="off" onSubmit={accountMode ? handleCreateAccount : handleLogin}>
            <span className="eyebrow">BIENVENIDO/A</span>
            <h2>{accountMode ? "Crear cuenta" : "Iniciar sesión"}</h2>
            <p>{accountMode ? "Registrá una cuenta de compra. No habilita acceso al panel interno." : "Ingresá con la cuenta de personal de tu organización."}</p>
            {!databaseConfigured && <div className="inline-alert error">El acceso está listo, pero la base de datos de Farmacias del Norte todavía no está conectada. La cuenta y el ingreso estarán disponibles al conectar Neon.</div>}
            {notice?.type === "error" && <div className="inline-alert error">{notice.text}</div>}
            {notice?.type === "success" && <div className="inline-alert success" role="status">{notice.text}</div>}
            <label>Correo electrónico<input autoComplete="off" type="email" name="email" placeholder="nombre@correo.com" required disabled={!databaseConfigured || busy} /></label>
            <label>Contraseña<input autoComplete="off" type="password" name="password" placeholder={accountMode ? "Mínimo 12 caracteres" : "Tu contraseña"} minLength={accountMode ? 12 : undefined} required disabled={!databaseConfigured || busy} /></label>
            {accountMode && <label>Repetí la contraseña<input autoComplete="new-password" type="password" name="confirmPassword" placeholder="Volvé a escribirla" minLength={12} required disabled={!databaseConfigured || busy} /></label>}
            <button className="primary-button full-button" disabled={busy || !databaseConfigured}>{busy ? "Un momento…" : accountMode ? "Crear cuenta de compra" : "Ingresar"}<span>→</span></button>
            <button className="login-mode-toggle" type="button" onClick={(event) => { event.currentTarget.form?.reset(); setAccountMode(!accountMode); setNotice(null); }}>{accountMode ? "Volver a iniciar sesión" : "Crear una cuenta de compra"}</button>
            <Link className="login-store-link" href="/">← Volver a la tienda</Link>
            <div className="secure-note"><span>●</span> El registro público nunca crea cuentas administrativas</div>
          </form>
        </section>
      </main>
    );
  }

  const nav: Array<{ id: AppSection; title: string; group: string }> = [
    { id: "dashboard", title: "Resumen", group: "GENERAL" },
  ];
  if (admin) nav.push({ id: "branches", title: "Sucursales", group: "GESTIÓN" });
  nav.push(
    { id: "products", title: "Productos", group: "GESTIÓN" },
    { id: "inventory", title: "Inventario", group: "OPERACIONES" },
    { id: "sales", title: "Ventas", group: "OPERACIONES" },
    { id: "orders", title: "Pedidos online", group: "OPERACIONES" },
  );
  if (admin) nav.push({ id: "users", title: "Usuarios", group: "ADMINISTRACIÓN" });
  nav.push({ id: "cameras", title: "Cámaras", group: admin ? "ADMINISTRACIÓN" : "OPERACIONES" });
  const currentTitle = nav.find((item) => item.id === section)?.title ?? "Resumen";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup sidebar-brand"><img className="admin-brand-image" src="/farmacias-del-norte-logo.png" alt="" /><span><b>FARMACIAS</b><small>DEL NORTE</small></span></div>
        <div className="branch-switcher">
          <span className="switcher-label">VISTA ACTUAL</span>
          {admin ? (
            <select aria-label="Filtrar por sucursal" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}>
              <option value="">Todas las sucursales</option>
              {branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </select>
          ) : (
            <div className="branch-current"><span className="branch-indicator" />{user?.branchName || "Sucursal asignada"}</div>
          )}
        </div>
        <nav className="side-nav" aria-label="Navegación principal">
          {nav.map((item, index) => (
            <div key={item.id}>
              {(index === 0 || nav[index - 1].group !== item.group) && <span className="nav-group">{item.group}</span>}
              <button className={`nav-link ${section === item.id ? "active" : ""}`} onClick={() => { setSection(item.id); setSearch(""); }}>
                <span className={`nav-icon icon-${item.id}`}>{item.title.slice(0, 1).toUpperCase()}</span>
                <span>{item.title}</span>
                {item.id === "inventory" && dashboard?.summary.low_stock_count ? <b className="nav-count">{dashboard.summary.low_stock_count}</b> : null}
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-help"><span>?</span><div><b>¿Necesitas ayuda?</b><small>Contacta a tu administrador</small></div></div>
          <button className="user-card" onClick={handleLogout} title="Cerrar sesión">
            <span className="avatar">{user?.fullName.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
            <span className="user-copy"><b>{user?.fullName}</b><small>{roleName(user!.role)} · Cerrar sesión</small></span>
            <span className="logout-arrow">↗</span>
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb"><span>Farmacias del Norte</span><i>/</i><b>{currentTitle}</b></div>
          <div className="topbar-right">
            <Link className="landing-return" href="/">Ir al landing</Link>
            <span className="live-status"><span /> Sistema conectado</span>
            <span className="topbar-date">{todayLabel}</span>
            <span className="top-avatar">{user?.fullName.slice(0, 1).toUpperCase()}</span>
          </div>
        </header>
        <div className="content-wrap">
          {notice && <div className={`toast ${notice.type}`} role="status"><span>{notice.type === "success" ? "✓" : "!"}</span>{notice.text}<button onClick={() => setNotice(null)} aria-label="Cerrar aviso">×</button></div>}
          {busy && <div className="refresh-line" />}
          {section === "dashboard" && <DashboardSection data={dashboard} error={dashboardError} onGo={setSection} onRetry={() => void refresh()} isAdmin={admin} />}
          {section === "branches" && admin && (
            <section>
              <PageHeading eyebrow="RED DE FARMACIAS" title="Sucursales" detail="Administra y consulta la actividad de cada local.">
                {admin && <button className="primary-button" onClick={() => setModal("branch")}><span>＋</span> Nueva sucursal</button>}
              </PageHeading>
              {branches.length === 0 ? <EmptyState title="Aún no hay sucursales" detail="Registra la primera sucursal para comenzar a organizar tu red." /> : (
                <div className="branch-grid">
                  {branches.map((branch) => (
                    <article className="branch-card" key={branch.id}>
                      <div className="branch-card-top">{branch.image_url ? <img className="branch-card-image" src={branch.image_url} alt="" /> : <span className="branch-badge">{branch.code.slice(0, 2)}</span>}<span className={`status-pill ${branch.active ? "good" : "muted"}`}><i />{branch.active ? "Activa" : "Inactiva"}</span></div>
                      <span className="branch-code">{branch.code}</span><h3>{branch.name}</h3>
                      <p className="branch-address">{branch.address || "Sin dirección registrada"}</p>
                      <div className="branch-metrics"><span><b>{quantityFormat.format(branch.product_count)}</b> productos</span><span><b>{quantityFormat.format(branch.total_stock)}</b> unidades</span></div>
                      <div className="branch-contact">{branch.phone || "Sin teléfono"}{branch.email ? ` · ${branch.email}` : ""}</div>
                      {branch.delivery_zone && <small className="store-zone-tag">Entrega · {branch.delivery_zone}</small>}
                      {admin && <div className="branch-actions"><button className="text-button branch-edit-button" onClick={() => { setEditingBranch(branch); setModal("branch-edit"); }}>Editar sucursal →</button><button className="text-button branch-edit-button" onClick={() => void setBranchActive(branch)}>{branch.active ? "Desactivar" : "Reactivar"}</button></div>}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
          {section === "products" && (
            <section>
              <PageHeading eyebrow="CATÁLOGO CENTRAL" title="Productos" detail="Consulta y administra el catálogo de la cadena.">
                <div className="heading-actions"><div className="search-box"><span>⌕</span><input aria-label="Buscar productos" placeholder="Buscar por nombre o código" value={search} onChange={(event) => setSearch(event.target.value)} /></div><button className="secondary-button" onClick={exportProducts}>Exportar CSV</button>{admin && <><button className="secondary-button" onClick={() => setIncludeInactive((current) => !current)}>{includeInactive ? "Ocultar inactivos" : "Ver inactivos"}</button><button className="primary-button" onClick={() => setModal("product")}><span>＋</span> Nuevo producto</button></>}</div>
              </PageHeading>
              <div className="table-card">
                <div className="table-meta"><div><b>Catálogo</b><span>{visibleProducts.length} productos encontrados</span></div><span className="filter-label">Stock {admin && selectedBranch ? "de la sucursal" : admin ? "total de la red" : "de tu sucursal"}</span></div>
                {visibleProducts.length === 0 ? <EmptyState title="No hay productos para mostrar" detail="Agrega productos o prueba con otro término de búsqueda." /> : (
                    <div className="table-scroll"><table><thead><tr><th>PRODUCTO</th><th>CÓDIGO</th><th>CATEGORÍA</th>{admin && <><th>COSTO</th><th>MARGEN BRUTO</th></>}<th>PRECIO</th><th>STOCK</th><th>ESTADO</th>{admin && <th>ACCIONES</th>}</tr></thead><tbody>
                    {visibleProducts.map((product) => <tr key={product.id}>
                      <td><div className="product-cell">{product.cover_image_url ? <img className="product-thumb product-thumb-image" src={product.cover_image_url} alt="" /> : <span className="product-thumb">{product.name.slice(0, 1).toUpperCase()}</span>}<div><b>{product.name}</b><small>{product.presentation || product.active_ingredient || "Catálogo central"}</small><small>{product.online_enabled ? "Venta online habilitada" : "Solo en sucursal"}</small></div></div></td>
                      <td className="mono">{product.internal_code}</td><td>{product.category}</td>{admin && <><td>{money.format(product.cost_price ?? 0)}</td><td>{product.sale_price > 0 && product.cost_price !== null ? `${(((product.sale_price - product.cost_price) / product.sale_price) * 100).toFixed(1)}%` : "—"}</td></>}<td className="price-cell">{money.format(product.sale_price)}</td>
                      <td><span className={`stock-pill ${product.stock <= product.minimum_stock ? "stock-low" : "stock-ok"}`}>{quantityFormat.format(product.stock)} ud.</span></td>
                      <td><span className={`status-pill ${product.active ? "good" : "muted"}`}><i />{product.active ? "Activo" : "Inactivo"}</span></td>
                      {admin && <td><div className="table-actions"><button className="text-button" onClick={() => { setEditingProduct(product); setModal("product-edit"); }}>Editar</button><button className="text-button" onClick={() => void showPriceHistory(product)}>Precios</button><button className="text-button" onClick={() => { setEditingProduct(product); setModal("inventory"); }}>Ajustar stock</button></div></td>}
                    </tr>)}
                  </tbody></table></div>
                )}
              </div>
              <p className="subtle-note">El margen bruto estimado se calcula como precio de venta menos costo de adquisición; no equivale a facturación.</p>
              {admin && <CategoryManager categories={categories} onChanged={() => { if (user) void loadSectionData(user, "products", branchId); }} onError={(text) => setNotice({ type: "error", text })} onSuccess={(text) => setNotice({ type: "success", text })} />}
            </section>
          )}
          {section === "inventory" && (
            <section>
              <PageHeading eyebrow="CONTROL OPERATIVO" title="Inventario" detail={branchId
                ? `Existencias y movimientos · ${branches.find((branch) => branch.id === branchId)?.name || user?.branchName || ""}`
                : "Existencias consolidadas de todas las sucursales, con detalle por lote"}>
                {user?.role !== "employee" && <button className="primary-button" onClick={() => setModal("inventory")}><span>＋</span> Registrar movimiento</button>}
              </PageHeading>
              <div className="table-card">
                <div className="table-meta"><div><b>Existencias por producto</b><span>{branchId ? "Inventario por sucursal y lote" : "Totales de la red; el detalle conserva sucursal y lote"}</span></div><div className="table-actions"><button className="text-button" onClick={() => void refresh()}>↻ Actualizar</button>{inventory?.stock.length ? <button className="text-button" onClick={() => downloadCsv("inventario-sucursales.csv", inventoryCsvRows(inventory.stock, branches.find((branch) => branch.id === branchId)?.name ?? user?.branchName ?? null))}>Exportar CSV ↓</button> : null}</div></div>
                {!inventory?.stock.length ? <EmptyState title="No hay existencias registradas" detail="El inventario aparecerá cuando haya existencias ingresadas por sucursal y lote." /> : (
                  <div className="table-scroll"><table><thead><tr><th>PRODUCTO</th><th>LOTE / VENCIMIENTO</th><th>STOCK ACTUAL</th><th>STOCK MÍNIMO</th><th>ESTADO</th></tr></thead><tbody>
                    {inventory.stock.map((item) => <tr key={item.product_id}><td><div className="product-cell"><span className="product-thumb">{item.name.slice(0, 1)}</span><div><b>{item.name}</b><small>{item.internal_code}</small></div></div></td>
                      <td>{item.lots.map((lot) => <div className="lot-label" key={lot.id}>{!branchId && <b>{lot.branchName} · </b>}{lot.lotNumber} · {lot.expiresOn ? new Intl.DateTimeFormat("es").format(new Date(`${lot.expiresOn}T00:00:00`)) : "Sin vencimiento"} <small>{lot.quantity} ud.</small></div>)}</td>
                      <td><b>{quantityFormat.format(item.quantity)}</b> ud.</td><td>{item.minimum_stock} ud.</td>
                      <td><span className={`status-pill ${item.quantity <= item.minimum_stock ? "warning" : "good"}`}><i />{item.quantity <= item.minimum_stock ? "Stock bajo" : "Disponible"}</span></td></tr>)}
                  </tbody></table></div>
                )}
              </div>
              {inventory?.movements.length ? <div className="table-card movement-card"><div className="table-meta"><div><b>Movimientos recientes</b><span>Registro de auditoría de existencias</span></div></div><div className="table-scroll"><table><thead><tr><th>FECHA</th><th>PRODUCTO</th><th>MOVIMIENTO</th><th>CANTIDAD</th><th>RESPONSABLE</th><th>MOTIVO</th><th>ACCIONES</th></tr></thead><tbody>{inventory.movements.slice(0, 10).map((movement) => <tr key={movement.id}><td>{formatTime(movement.created_at)}</td><td>{movement.product_name}</td><td>{movementLabel(movement.movement_type)}</td><td className={movement.quantity < 0 ? "negative" : "positive"}>{movement.quantity > 0 ? "+" : ""}{movement.quantity}</td><td>{movement.user_name}</td><td>{movement.reason}</td><td><div className="table-actions"><button className="text-button" onClick={() => { setReceiptMovement(movement); setReceiptError(""); setReceiptEmail(""); }}>Comprobante</button>{admin && ["in", "out", "loss"].includes(movement.movement_type) && <button className="text-button" onClick={() => { setEditingMovement(movement); setModal("movement-edit"); }}>Editar motivo</button>}</div></td></tr>)}</tbody></table></div></div> : null}
            </section>
          )}
          {section === "sales" && (
            <section>
              <PageHeading eyebrow="PUNTO DE VENTA" title="Ventas" detail={branchId
                ? "Registra operaciones y consulta el historial de la sucursal."
                : "Historial consolidado de ventas de todas las sucursales."} />
              {!branchId && admin && <p className="subtle-note">Las ventas siempre quedan asociadas a una sucursal. Selecciona una en el panel para registrar una operación.</p>}
              <div className="sales-layout">
                {branchId && <SaleForm products={products} onSubmit={handleSale} busy={busy} />}
                <div className="table-card sales-history"><div className="table-meta"><div><b>Ventas recientes</b><span>Últimas 50 operaciones{!branchId && admin ? " · todas las sucursales" : ""}</span></div><div className="table-actions"><button className="text-button" onClick={() => void refresh()}>↻ Actualizar</button>{sales.length ? <button className="text-button" onClick={() => void exportSalesExcel()}>Exportar Excel (.xlsx) ↓</button> : null}</div></div>
                  {!sales.length ? <EmptyState title="Todavía no hay ventas" detail="Las ventas registradas aparecerán aquí con su importe y responsable." /> : <div className="table-scroll"><table><thead><tr><th>OPERACIÓN</th>{admin && !branchId && <th>SUCURSAL</th>}<th>FECHA</th><th>CAJERO/A</th><th>MEDIO DE PAGO</th><th>TOTAL</th></tr></thead><tbody>{sales.map((sale) => <tr key={sale.id}><td><b className="mono">{sale.transaction_number}</b><small className="sale-items">{sale.items.map((item) => `${item.name} × ${item.quantity}`).join(" · ")}</small></td>{admin && !branchId && <td>{sale.branch_name}</td>}<td>{formatTime(sale.created_at)}</td><td>{sale.cashier}</td><td>{paymentLabel(sale.payment_method)}</td><td className="price-cell">{money.format(sale.total)}</td></tr>)}</tbody></table></div>}
                </div>
              </div>
            </section>
          )}
          {section === "users" && admin && (
            <section>
              <PageHeading eyebrow="ACCESO Y PERMISOS" title="Usuarios" detail="Asigna un rol y una sucursal a cada persona.">
                <button className="primary-button" onClick={() => setModal("user")}><span>＋</span> Nuevo usuario</button>
              </PageHeading>
              <div className="table-card">
                <div className="table-meta"><div><b>Personal autorizado</b><span>{users.length} cuentas registradas</span></div></div>
                {!users.length ? <EmptyState title="Aún no hay usuarios operativos" detail="Crea cuentas de empleado. La cuenta del gerente general se configura por terminal." /> : <div className="table-scroll"><table><thead><tr><th>PERSONA</th><th>CORREO</th><th>ROL</th><th>SUCURSAL</th><th>ESTADO</th><th>ACCIONES</th></tr></thead><tbody>{users.map((record) => <tr key={record.id}><td><div className="product-cell"><span className="product-thumb">{record.full_name.slice(0, 1).toUpperCase()}</span><div><b>{record.full_name}{record.isCurrentUser ? " · Tú" : ""}</b><small>Acceso del personal</small></div></div></td><td>{record.email}</td><td>{roleName(record.role)}</td><td>{record.branch_name || "Todas las sucursales"}</td><td><span className={`status-pill ${record.active ? "good" : "muted"}`}><i />{record.active ? "Activo" : "Inactivo"}</span></td><td><div className="table-actions"><button className="text-button" onClick={() => { setEditingUser(record); setModal("user-edit"); }}>Editar</button>{!record.isCurrentUser && <button className="text-button" onClick={() => void setUserActive(record)}>{record.active ? "Desactivar" : "Reactivar"}</button>}</div></td></tr>)}</tbody></table></div>}
              </div>
              <p className="subtle-note">Las cuentas se archivan/desactivan para conservar la trazabilidad; los cambios de contraseña invalidan sus sesiones activas.</p>
            </section>
          )}
          {section === "orders" && (
            <section>
              <PageHeading eyebrow="COMERCIO ONLINE" title="Pedidos online" detail="Pedidos pendientes de confirmación por sucursal; el pago se coordina directamente." />
              {!orders.length ? <div className="table-card"><EmptyState title="Todavía no hay pedidos" detail="Los pedidos online confirmados por clientes aparecerán aquí." /></div> : <div className="online-order-list">{orders.map((order) => {
                const next = nextOrderStatus(order);
                return <article className="online-order-card" key={order.id}>
                  <div className="online-order-heading"><div><span className="eyebrow">{order.order_number} · {formatTime(order.created_at)}</span><h2>{order.customer_name}</h2><p>{order.customer_email} · {order.customer_phone}</p></div><span className={`status-pill ${order.status === "completed" ? "good" : order.status === "cancelled" ? "muted" : "warning"}`}><i />{orderStatusLabel(order.status)}</span></div>
                  <div className="online-order-details"><span><b>Sucursal</b>{order.branch_name}</span><span><b>Entrega</b>{order.fulfillment_mode === "pickup" ? "Retiro en sucursal" : `Delivery · ${order.delivery_zone}`}{order.delivery_address ? ` · ${order.delivery_address}` : ""}</span><span><b>Total estimado · no cobrado</b>{money.format(order.total)}</span><span><b>Reserva</b>{order.status === "pending_review" ? formatTime(order.reservation_expires_at) : "Confirmada por sucursal"}</span></div>
                  <div className="online-order-items">{order.items.map((item, index) => <div key={`${item.code}-${index}`}><span>{item.code} · {item.name}</span><small>{item.quantity} × {money.format(item.unitPrice)}</small><b>{money.format(item.lineTotal)}</b></div>)}</div>
                  {next && <div className="online-order-actions"><button className="primary-button" onClick={() => void updateOrderStatus(order, next)}>{orderActionLabel(order, next)} →</button>{["pending_review", "confirmed", "preparing"].includes(order.status) && <button className="secondary-button" onClick={() => void updateOrderStatus(order, "cancelled")}>Cancelar pedido</button>}</div>}
                </article>;
              })}</div>}
            </section>
          )}
          {section === "cameras" && user && (
            <section>
              <PageHeading eyebrow="ACCESO RESTRINGIDO" title="Cámaras" detail="Panel de cámaras." />
              {!cameraUnlocked ? <div className="camera-gate panel"><div><span className="eyebrow">PANEL PRIVADO</span><h2>Ingresá el patrón de acceso</h2></div><div className="pattern-grid" aria-label="Patrón de nueve puntos">{Array.from({ length: 9 }, (_, index) => <button key={index} className={cameraPattern.includes(index) ? "selected" : ""} aria-pressed={cameraPattern.includes(index)} onClick={() => enterCameraPattern(index)} aria-label={`Punto ${index + 1}`} />)}</div><button className="text-button" onClick={() => { setCameraPattern([]); setNotice(null); }}>Borrar patrón</button></div>
                : <><CameraWall /><button className="secondary-button" onClick={() => setCameraUnlocked(false)}>Bloquear panel</button></>}
            </section>
          )}
          <footer className="page-footer"><span>Farmacias del Norte</span><span>Datos centralizados · Acceso según tu perfil</span></footer>
        </div>
      </main>
      {modal && <ModalForm key={modal} modal={modal} products={products} branches={branches} categories={categories} editingBranch={editingBranch} editingProduct={editingProduct} editingUser={editingUser} editingMovement={editingMovement} priceHistory={priceHistory} busy={busy} onClose={() => setModal(null)} onSubmit={handleSubmit} onDeleteBranch={deleteBranch} selectedBranchId={branchId || null} isAdmin={admin} />}
      {receiptMovement && <ReceiptModal movement={receiptMovement} email={receiptEmail} error={receiptError} onEmailChange={setReceiptEmail} busy={busy} onClose={() => setReceiptMovement(null)} onSubmit={sendMovementReceipt} />}
    </div>
  );
}

type CameraBranch = {
  id: string;
  name: string;
  cameras: Array<{ id: string; position: number; name: string; streamUrl: string }>;
};

const CAMERA_ZONE_ORDER = ["norte", "sur", "este", "oeste"];

function cameraZone(branchName: string) {
  const lower = branchName.toLowerCase();
  const match = CAMERA_ZONE_ORDER.find((zone) => lower.includes(zone));
  return match ? match.charAt(0).toUpperCase() + match.slice(1) : "";
}

function CameraScreen({ className, label }: { className: string; label: string }) {
  return (
    <div className={`camera-feed-screen ${className}`} role="img" aria-label={label}>
      <div className="thermal-layer" aria-hidden="true" />
      <div className="radar-grid" aria-hidden="true" />
      <div className="radar-sweep" aria-hidden="true" />
      <span className="thermal-blip thermal-blip-a" aria-hidden="true" />
      <span className="thermal-blip thermal-blip-b" aria-hidden="true" />
      <span className="thermal-blip thermal-blip-c" aria-hidden="true" />
      <span className="camera-rec" aria-hidden="true">● REC</span>
      <span className="camera-scanline" aria-hidden="true" />
    </div>
  );
}

function CameraFeed({ branchName, zone, camera, index }: { branchName: string; zone: string; camera: CameraBranch["cameras"][number]; index: number }) {
  const [fullscreen, setFullscreen] = useState(false);
  const title = `${branchName}${zone ? ` · ${zone}` : ""} — ${camera.name}`;

  useEffect(() => {
    if (!fullscreen) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [fullscreen]);

  return (
    <article className="camera-feed">
      <CameraScreen className={`camera-feed-screen-${(index % 3) + 1}`} label={title} />
      <div className="camera-feed-caption">
        <b>{camera.name}</b>
        <button type="button" className="camera-fullscreen-button" onClick={() => setFullscreen(true)} aria-label={`Ver ${title} en pantalla completa`}>⤢ Pantalla completa</button>
      </div>
      {fullscreen && (
        <div className="camera-fullscreen" role="dialog" aria-modal="true" aria-label={title}>
          <CameraScreen className={`camera-feed-screen-${(index % 3) + 1} camera-feed-screen-full`} label={title} />
          <div className="camera-fullscreen-bar">
            <span>{title}</span>
            <button type="button" className="secondary-button" onClick={() => setFullscreen(false)}>Cerrar (Esc)</button>
          </div>
        </div>
      )}
    </article>
  );
}

function CameraWall() {
  const [branches, setBranches] = useState<CameraBranch[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/cameras")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "No se pudieron cargar las cámaras.");
        return data as CameraBranch[];
      })
      .then((data) => {
        if (!active) return;
        const rank = (name: string) => {
          const index = CAMERA_ZONE_ORDER.indexOf(cameraZone(name).toLowerCase());
          return index === -1 ? CAMERA_ZONE_ORDER.length : index;
        };
        const sorted = [...data].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
        setBranches(sorted);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <div className="store-empty">{error}</div>;
  if (!branches) return <div className="store-empty">Cargando cámaras…</div>;
  if (!branches.length) return <EmptyState title="Sin cámaras configuradas" detail="Agregá sucursales activas para que aparezcan sus cámaras." />;

  return (
    <div className="camera-wall">
      {branches.map((branch) => {
        const zone = cameraZone(branch.name);
        return (
          <section key={branch.id} className="camera-branch">
            <header className="camera-branch-header">
              <span className="eyebrow">{zone || "Sucursal"}</span>
              <h3>{branch.name}</h3>
              <small>{branch.cameras.length} cámaras</small>
            </header>
            <div className="camera-grid">
              {branch.cameras.map((camera, index) => (
                <CameraFeed key={camera.id} branchName={branch.name} zone={zone} camera={camera} index={index} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PageHeading({ eyebrow, title, detail, children }: { eyebrow: string; title: string; detail: string; children?: ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{detail}</p></div>{children}</div>;
}

function DashboardSection({ data, error, onGo, onRetry, isAdmin }: { data: DashboardData | null; error: string; onGo: (section: AppSection) => void; onRetry: () => void; isAdmin: boolean }) {
  const maxSales = Math.max(1, ...(data?.dailySales.map((day) => Number(day.total)) ?? []));
  return (
    <section>
      <PageHeading eyebrow="VISTA GENERAL" title="Buen día" detail="Un resumen actualizado de la operación de tu red." />
      {error ? <div className="table-card"><div className="inline-alert error" role="alert">{error}</div><button className="text-button" onClick={onRetry}>↻ Reintentar</button></div>
        : !data ? <div className="table-card"><EmptyState title="Cargando indicadores" detail="Consultando los datos actuales del sistema." /></div> : <>
        <div className="stats-grid">
          <StatCard label="Ventas de hoy" value={quantityFormat.format(Number(data.summary.sales_today))} note="Operaciones confirmadas" tone="green" />
          <StatCard label="Facturación del día" value={money.format(Number(data.summary.revenue_today))} note="Importe vendido · no es ganancia" tone="gold" />
          <StatCard label="Productos activos" value={quantityFormat.format(Number(data.summary.product_count))} note="En el catálogo central" tone="blue" />
          <StatCard label="Sucursales activas" value={quantityFormat.format(Number(data.summary.branch_count))} note="Dentro de tu vista actual" tone="coral" />
        </div>
        <div className="dashboard-grid">
          <article className="panel sales-chart-panel">
            <div className="panel-heading"><div><span className="eyebrow">RENDIMIENTO</span><h2>Ventas de los últimos 7 días</h2><p>Facturación diaria registrada</p></div><span className="chart-key"><i /> Ventas</span></div>
            <div className="chart-grid">
              <div className="chart-y-labels"><span>{money.format(maxSales)}</span><span>{money.format(maxSales / 2)}</span><span>$ 0</span></div>
              <div className="chart-bars">{data.dailySales.map((day, index) => {
                const amount = Number(day.total);
                const height = amount > 0 ? Math.max(6, amount / maxSales * 100) : 2;
                return <div className="chart-column" key={`${day.label}-${index}`}><div className="bar-track"><span className={`chart-bar ${index === data.dailySales.length - 1 ? "today" : ""}`} style={{ height: `${height}%` }} title={money.format(amount)} /></div><small>{day.label}</small></div>;
              })}</div>
            </div>
          </article>
          <article className="panel alerts-panel">
            <div className="panel-heading"><div><span className="eyebrow">ATENCIÓN</span><h2>Alertas de inventario</h2></div><span className="alert-count">{Number(data.summary.low_stock_count) + Number(data.summary.expiring_count) + Number(data.summary.expired_count)}</span></div>
            <button className="alert-row" onClick={() => onGo("inventory")}><span className="alert-icon low">!</span><span><b>Stock bajo</b><small>{data.summary.low_stock_count} productos requieren revisión</small></span><i>›</i></button>
            <button className="alert-row" onClick={() => onGo("inventory")}><span className="alert-icon expiry">◷</span><span><b>Próximos a vencer</b><small>{data.summary.expiring_count} lotes en los próximos 30 días</small></span><i>›</i></button>
            <button className="alert-row" onClick={() => onGo("inventory")}><span className="alert-icon low">×</span><span><b>Lotes vencidos</b><small>{data.summary.expired_count} lotes con unidades vencidas</small></span><i>›</i></button>
            <div className="alert-foot">Alertas calculadas con datos reales de stock y lotes.</div>
          </article>
          <article className="panel branch-performance">
            <div className="panel-heading"><div><span className="eyebrow">SUCURSALES</span><h2>Facturación por sucursal</h2><p>Últimos 7 días</p></div>{isAdmin && <button className="text-button" onClick={() => onGo("branches")}>Ver sucursales →</button>}</div>
            {!data.branchSales.length ? <EmptyState title="Sin actividad registrada" detail="Cuando se registren ventas, verás la comparación entre sucursales." /> : data.branchSales.map((branch, index) => {
              const max = Math.max(1, ...data.branchSales.map((item) => Number(item.total)));
              return <div className="branch-performance-row" key={branch.id}><span className="performance-rank">{String(index + 1).padStart(2, "0")}</span><span className="performance-name">{branch.name}</span><div className="performance-track"><span style={{ width: `${Math.max(3, Number(branch.total) / max * 100)}%` }} /></div><b>{money.format(Number(branch.total))}</b></div>;
            })}
          </article>
          <article className="panel top-products">
            <div className="panel-heading"><div><span className="eyebrow">PRODUCTOS</span><h2>Más vendidos</h2><p>Por unidades · últimos 7 días</p></div><button className="text-button" onClick={() => onGo("products")}>Ver catálogo →</button></div>
            {!data.topProducts.length ? <EmptyState title="Aún sin ventas" detail="El ranking aparecerá al registrar las primeras ventas." /> : data.topProducts.map((item, index) => <div className="top-product-row" key={item.name}><span className="top-product-number">{String(index + 1).padStart(2, "0")}</span><span className="top-product-name">{item.name}</span><b>{quantityFormat.format(item.quantity)} <small>ud.</small></b></div>)}
          </article>
          <article className="panel recent-activity">
            <div className="panel-heading"><div><span className="eyebrow">TRAZABILIDAD</span><h2>Movimientos recientes</h2><p>Últimas actualizaciones del inventario</p></div><button className="text-button" onClick={() => onGo("inventory")}>Ver inventario →</button></div>
            {!data.movements.length ? <EmptyState title="Sin movimientos recientes" detail="Las entradas, salidas y ventas se mostrarán aquí." /> : data.movements.map((item) => <div className="activity-row" key={item.id}><span className={`activity-dot ${item.quantity > 0 ? "in" : "out"}`} /><div className="activity-copy"><b>{item.product_name}</b><small>{item.reason} · {item.branch_name} · {item.user_name}</small></div><span className={item.quantity > 0 ? "positive" : "negative"}>{item.quantity > 0 ? "+" : ""}{item.quantity}</span><time>{formatTime(item.created_at)}</time></div>)}
          </article>
          <article className="panel low-stock-panel">
            <div className="panel-heading"><div><span className="eyebrow">REPOSICIÓN</span><h2>Stock bajo</h2><p>Productos al nivel mínimo o por debajo</p></div></div>
            {!data.lowStock.length ? <EmptyState title="Todo en orden" detail="No hay productos bajo el nivel mínimo." /> : data.lowStock.map((item) => <div className="low-stock-row" key={`${item.id}-${item.branch_name}`}><span className="low-stock-symbol">{item.name.slice(0, 1)}</span><div><b>{item.name}</b><small>{item.internal_code} · {item.branch_name}</small></div><span className="stock-pill stock-low">{item.quantity} / {item.minimum_stock}</span></div>)}
          </article>
          <article className="panel expiring-panel">
            <div className="panel-heading"><div><span className="eyebrow">VENCIMIENTOS</span><h2>Próximos a vencer</h2><p>Lotes con vencimiento en 30 días</p></div></div>
            {!data.expiring.length ? <EmptyState title="Sin vencimientos próximos" detail="No hay lotes que vencer en los próximos 30 días." /> : data.expiring.map((lot) => <ExpiryRow key={`${lot.lot_number}-${lot.branch_name}`} lot={lot} expired={false} />)}
          </article>
          <article className="panel expired-panel">
            <div className="panel-heading"><div><span className="eyebrow">REVISIÓN PRIORITARIA</span><h2>Lotes vencidos</h2><p>Existencias que no deben venderse</p></div></div>
            {!data.expired.length ? <EmptyState title="No hay lotes vencidos" detail="No se encontraron unidades vencidas en el inventario." /> : data.expired.map((lot) => <ExpiryRow key={`${lot.lot_number}-${lot.branch_name}`} lot={lot} expired />)}
          </article>
        </div>
      </>}
    </section>
  );
}

function ExpiryRow({ lot, expired }: { lot: DashboardData["expiring"][number]; expired: boolean }) {
  return <div className="expiry-row"><span className={`expiry-symbol ${expired ? "expired" : ""}`}>{expired ? "!" : "◷"}</span><div><b>{lot.name}</b><small>{lot.lot_number} · {lot.branch_name}</small></div><span className="expiry-date"><b>{lot.quantity} ud.</b><small>{formatDateOnly(lot.expires_on)}</small></span></div>;
}

function SaleForm({ products, onSubmit, busy }: { products: Product[]; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<boolean>; busy: boolean }) {
  const [cart, setCart] = useState<Array<{ productId: string; quantity: number }>>([]);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const lines = cart.map((line) => ({ ...line, product: products.find((item) => item.id === line.productId) })).filter((line) => line.product);
  const total = lines.reduce((sum, line) => sum + line.product!.sale_price * line.quantity, 0);

  return (
    <form className="panel sale-form" onSubmit={(event) => { event.preventDefault(); if (!cart.length) return; void onSubmit(event).then((success) => { if (success) setCart([]); }); }}>
      <div className="panel-heading"><div><span className="eyebrow">NUEVA OPERACIÓN</span><h2>Registrar venta</h2><p>El precio y el stock se validan en el servidor.</p></div><span className="sale-basket">▣</span></div>
      <div className="sale-add-row"><label>Producto<select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">Selecciona un producto</option>{products.filter((item) => item.stock > 0).map((product) => <option key={product.id} value={product.id}>{product.name} · {money.format(product.sale_price)} · {product.stock} ud.</option>)}</select></label><label className="quantity-input">Cant.<input type="number" min="1" max="10000" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label><button type="button" className="add-line-button" onClick={() => { if (productId && quantity > 0) { setCart((current) => { const found = current.find((line) => line.productId === productId); return found ? current.map((line) => line.productId === productId ? { ...line, quantity: line.quantity + quantity } : line) : [...current, { productId, quantity }]; }); setProductId(""); setQuantity(1); } }}>＋</button></div>
      {lines.length ? <div className="cart-lines">{lines.map((line) => <div className="cart-line" data-cart-item data-product-id={line.productId} data-quantity={line.quantity} key={line.productId}><div><b>{line.product!.name}</b><small>{line.quantity} × {money.format(line.product!.sale_price)}</small></div><strong>{money.format(line.product!.sale_price * line.quantity)}</strong><button type="button" onClick={() => setCart((current) => current.filter((entry) => entry.productId !== line.productId))} aria-label={`Quitar ${line.product!.name}`}>×</button></div>)}</div> : <div className="cart-empty">Agrega productos para armar la venta.</div>}
      <label className="payment-select">Medio de pago<select name="paymentMethod"><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="digital_wallet">Billetera virtual</option><option value="other">Otro</option></select></label>
      <div className="sale-total"><span>Total a cobrar</span><strong>{money.format(total)}</strong></div>
      <button className="primary-button full-button" disabled={busy || !cart.length}>Confirmar venta <span>→</span></button>
      <p className="sale-disclaimer">La venta y la salida de stock se guardan en una única transacción.</p>
    </form>
  );
}

function ModalForm({ modal, products, branches, categories, editingBranch, editingProduct, editingUser, editingMovement, priceHistory, busy, onClose, onSubmit, onDeleteBranch, selectedBranchId, isAdmin }: {
  onDeleteBranch?: (branch: Branch) => void;
  selectedBranchId?: string | null;
  isAdmin?: boolean;
  modal: Exclude<Modal, null>;
  products: Product[];
  branches: Branch[];
  categories: Category[];
  editingBranch: Branch | null;
  editingProduct: Product | null;
  editingUser: UserRecord | null;
  editingMovement: InventoryData["movements"][number] | null;
  priceHistory: PriceHistoryEntry[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [movementType, setMovementType] = useState("in");
  const [coverImageUrl, setCoverImageUrl] = useState(editingProduct?.cover_image_url ?? "");
  const previewUrl = /^https:\/\/\S+$/i.test(coverImageUrl.trim()) ? coverImageUrl.trim() : "";
  const title = { branch: "Nueva sucursal", "branch-edit": "Editar sucursal", product: "Nuevo producto", "product-edit": "Editar producto", "price-history": "Historial de precios", inventory: "Movimiento de inventario", user: "Nuevo usuario", "user-edit": "Editar usuario", "movement-edit": "Editar motivo del movimiento" }[modal];
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="modal-card" onSubmit={onSubmit}>
        <div className="modal-head"><div><span className="eyebrow">{modal.startsWith("branch") ? "RED DE FARMACIAS" : modal.startsWith("product") || modal === "price-history" ? "CATÁLOGO CENTRAL" : modal.startsWith("user") ? "ACCESO Y PERMISOS" : "CONTROL DE STOCK"}</span><h2>{title}</h2></div><button className="close-button" type="button" onClick={onClose} aria-label="Cerrar">×</button></div>
        {modal === "price-history" && <div className="history-content"><b>{editingProduct?.name}</b>{priceHistory.length ? <div className="history-list">{priceHistory.map((entry) => <div className="history-entry" key={entry.id}><span className="history-date">{formatTime(entry.created_at)}</span><div><b>{entry.branch_name || "Precio central"}</b><small>{entry.changed_by}</small></div><div><small>Costo</small><span>{money.format(entry.old_cost)} → {money.format(entry.new_cost)}</span></div><div><small>Venta</small><span>{money.format(entry.old_price)} → {money.format(entry.new_price)}</span></div></div>)}</div> : <EmptyState title="Sin cambios registrados" detail="Todavía no hay modificaciones de precio para este producto." />}</div>}
        {(modal === "branch" || modal === "branch-edit") && <div className="form-grid">
          <label>Código único<input name="code" placeholder="NORTE-01" maxLength={24} defaultValue={editingBranch?.code ?? ""} required /></label><label>Nombre<input name="name" placeholder="Sucursal Centro" defaultValue={editingBranch?.name ?? ""} required /></label>
          <label className="wide-field">Dirección<input name="address" placeholder="Calle, número, ciudad" defaultValue={editingBranch?.address ?? ""} /></label><label>Teléfono<input name="phone" type="tel" defaultValue={editingBranch?.phone ?? ""} /></label><label>Correo<input name="email" type="email" defaultValue={editingBranch?.email ?? ""} /></label>
          <label className="wide-field">Imagen de sucursal (URL HTTPS)<input name="imageUrl" type="url" placeholder="https://…" defaultValue={editingBranch?.image_url ?? ""} /></label>
          <label className="wide-field">Zona de entrega (si está confirmada)<input name="deliveryZone" maxLength={160} placeholder="Barrio o zona verificada" defaultValue={editingBranch?.delivery_zone ?? ""} /></label>
          {modal === "branch-edit" && <label className="checkbox-field"><input type="checkbox" name="active" defaultChecked={editingBranch?.active} /> Sucursal activa</label>}
          {modal === "branch-edit" && editingBranch && <div className="wide-field"><button type="button" className="danger-button" disabled={busy} onClick={() => onDeleteBranch?.(editingBranch)}>Eliminar sucursal</button></div>}
        </div>}
        {(modal === "product" || modal === "product-edit") && <div className="form-grid">
          <label>Código interno<input name="internalCode" maxLength={48} defaultValue={editingProduct?.internal_code ?? ""} required /></label><label>Código de barras<input name="barcode" maxLength={64} defaultValue={editingProduct?.barcode ?? ""} /></label>
          <label className="wide-field">Nombre comercial<input name="name" defaultValue={editingProduct?.name ?? ""} required /></label><label>Principio activo<input name="activeIngredient" defaultValue={editingProduct?.active_ingredient ?? ""} /></label><label>Categoría<select name="categoryId" defaultValue={editingProduct?.category_id ?? categories.find((entry) => entry.active)?.id} required>{categories.filter((entry) => entry.active || entry.id === editingProduct?.category_id).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.active ? "" : " · archivada"}</option>)}</select></label>
          <label>Laboratorio<input name="manufacturer" defaultValue={editingProduct?.manufacturer ?? ""} /></label><label>Presentación<input name="presentation" defaultValue={editingProduct?.presentation ?? ""} /></label>
          <label>Costo<input name="costPrice" type="number" min="0" step="0.01" defaultValue={editingProduct?.cost_price ?? ""} required /></label><label>Precio de venta<input name="salePrice" type="number" min="0" step="0.01" defaultValue={editingProduct?.sale_price ?? ""} required /></label>
          <label className="wide-field">Imagen de portada (URL HTTPS)<input name="coverImageUrl" type="url" placeholder="https://…" defaultValue={editingProduct?.cover_image_url ?? ""} onChange={(event) => setCoverImageUrl(event.target.value)} /></label>
          <div className="product-image-preview wide-field" aria-live="polite">
            <span className="eyebrow">VISTA PREVIA</span>
            {previewUrl ? <img src={previewUrl} alt={`Vista previa de ${editingProduct?.name || "la imagen del producto"}`} /> : <p>Ingresa una URL HTTPS para previsualizar la imagen de portada.</p>}
          </div>
          <label className="wide-field">Descripción para el catálogo online<textarea name="onlineDescription" maxLength={500} defaultValue={editingProduct?.online_description ?? ""} /></label>
          <label>Stock mínimo<input name="minimumStock" type="number" min="0" step="1" defaultValue={editingProduct?.minimum_stock ?? "0"} required /></label>
          <label className="checkbox-field"><input type="checkbox" name="requiresPrescription" defaultChecked={editingProduct?.requires_prescription ?? false} /> Requiere receta</label>
          <label className="checkbox-field"><input type="checkbox" name="onlineEnabled" defaultChecked={editingProduct?.online_enabled ?? false} /> Aprobado para venta online</label>
          <label className="checkbox-field"><input type="checkbox" name="onlineFeatured" defaultChecked={editingProduct?.online_featured ?? false} /> Destacado en el landing</label>
          {modal === "product-edit" && <label className="checkbox-field"><input type="checkbox" name="active" defaultChecked={editingProduct?.active ?? true} /> Producto activo</label>}
        </div>}
        {modal === "inventory" && <div className="form-grid">
          {isAdmin && <label className="wide-field">Sucursal<select name="branchId" required defaultValue={selectedBranchId ?? ""}><option value="" disabled>Selecciona una sucursal</option>{branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
          <label className="wide-field">Producto<select name="productId" required defaultValue={editingProduct?.id ?? ""}><option value="" disabled>Selecciona un producto</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.internal_code}</option>)}</select></label>
          <label>Operación<select name="movementType" value={movementType} onChange={(event) => setMovementType(event.target.value)}><option value="in">Entrada</option><option value="out">Salida</option><option value="loss">Merma / producto dañado</option></select></label>
          <label>Cantidad<input name="quantity" type="number" min="1" step="1" required /></label>
          {movementType === "in" && <><label>Número de lote<input name="lotNumber" required maxLength={64} /></label><label>Vencimiento<input name="expiresOn" type="date" /></label></>}
          <label className="wide-field">Motivo<input name="reason" placeholder={movementType === "in" ? "Compra, stock inicial…" : "Motivo del ajuste"} required maxLength={240} /></label>
        </div>}
        {modal === "user" && <div className="form-grid">
          <label className="wide-field">Nombre completo<input name="fullName" required maxLength={160} /></label>
          <label className="wide-field">Correo electrónico<input name="email" type="email" required maxLength={254} /></label>
          <label>Rol<input value="Empleado" readOnly aria-readonly="true" /><input name="role" type="hidden" value="employee" /></label>
          <label>Sucursal<select name="branchId" required defaultValue=""><option value="" disabled>Selecciona una sucursal</option>{branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label className="wide-field">Contraseña inicial<input name="password" type="password" autoComplete="new-password" minLength={12} required /></label>
        </div>}
        {modal === "user-edit" && editingUser && <div className="form-grid">
          <label className="wide-field">Nombre completo<input name="fullName" defaultValue={editingUser.full_name} maxLength={160} required /></label>
          <label className="wide-field">Correo electrónico<input name="email" type="email" defaultValue={editingUser.email} maxLength={254} required /></label>
          {editingUser.role === "employee" ? <label className="wide-field">Sucursal<select name="branchId" defaultValue={editingUser.branch_id ?? ""} required>{branches.filter((branch) => branch.active || branch.id === editingUser.branch_id).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{branch.active ? "" : " · inactiva"}</option>)}</select></label> : <label>Rol<input value={roleName(editingUser.role)} readOnly /></label>}
          <label className="wide-field">Nueva contraseña (opcional)<input name="password" type="password" autoComplete="new-password" minLength={12} placeholder="Dejar vacío para conservarla" /><small>Mínimo 12 caracteres. Si no la cambiás, dejala vacía.</small></label>
          <label className="checkbox-field"><input type="checkbox" name="active" defaultChecked={editingUser.active} /> Cuenta activa</label>
        </div>}
        {modal === "movement-edit" && editingMovement && <div className="form-grid">
          <p className="wide-field movement-edit-note">Se conserva el movimiento original. Solo se corrige el motivo; cantidad, producto y sucursal se rectifican con un movimiento nuevo.</p>
          <label className="wide-field">Motivo<input name="reason" maxLength={240} defaultValue={editingMovement.reason} required /></label>
        </div>}
        <div className="modal-foot"><span>Los cambios quedan registrados con usuario y fecha.</span><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button></div>
      </form>
    </div>
  );
}

function CategoryManager({ categories, onChanged, onError, onSuccess }: {
  categories: Category[];
  onChanged: () => void;
  onError: (text: string) => void;
  onSuccess: (text: string) => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await requestJson("/api/categories", { method: "POST", body: JSON.stringify({ name }) });
      setName("");
      onChanged();
      onSuccess("Categoría creada.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo crear la categoría.");
    } finally {
      setBusy(false);
    }
  }

  async function editCategory(category: Category) {
    const nextName = window.prompt("Nuevo nombre de categoría", category.name)?.trim();
    if (!nextName || nextName === category.name) return;
    try {
      await requestJson("/api/categories", { method: "PATCH", body: JSON.stringify({ id: category.id, name: nextName }) });
      onChanged();
      onSuccess("Categoría actualizada.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo actualizar la categoría.");
    }
  }

  async function toggleCategory(category: Category) {
    try {
      await requestJson("/api/categories", { method: "PATCH", body: JSON.stringify({ id: category.id, active: !category.active }) });
      onChanged();
      onSuccess(category.active ? "Categoría archivada; sus productos e historial se conservaron." : "Categoría reactivada.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "No se pudo actualizar la categoría.");
    }
  }

  return <section className="category-manager"><div><span className="eyebrow">ORGANIZACIÓN DEL CATÁLOGO</span><h2>Categorías</h2><p>Administrá las categorías. Las usadas se archivan sin borrar el historial de productos.</p></div><form onSubmit={(event) => void createCategory(event)}><input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="Nueva categoría" required /><button className="primary-button" disabled={busy}>Agregar</button></form><div className="category-list">{categories.map((category) => <div className="category-item" key={category.id}><span>{category.name}</span><span className={`status-pill ${category.active ? "good" : "muted"}`}>{category.active ? "Activa" : "Archivada"}</span><button className="text-button" onClick={() => void editCategory(category)}>Renombrar</button><button className="text-button" onClick={() => void toggleCategory(category)}>{category.active ? "Archivar" : "Reactivar"}</button></div>)}</div></section>;
}

function ReceiptModal({ movement, email, error, onEmailChange, busy, onClose, onSubmit }: {
  movement: InventoryData["movements"][number];
  email: string;
  error: string;
  onEmailChange: (email: string) => void;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const label = movementLabel(movement.movement_type);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="receipt-modal">
    <article className="receipt-print-root">
      <header><img src="/farmacias-del-norte-logo.png" alt="" /><div><b>FARMACIAS DEL NORTE</b><span>{movement.branch_name}</span><small>{movement.branch_address || "Dirección no informada"}{movement.branch_phone ? ` · ${movement.branch_phone}` : ""}</small></div></header>
      <div className="receipt-nonfiscal">COMPROBANTE INTERNO — NO FISCAL</div>
      <h2>{label} de inventario</h2>
      <dl><dt>Movimiento</dt><dd>{movement.id.slice(0, 8).toUpperCase()}</dd><dt>Tipo</dt><dd>{label}</dd><dt>Fecha y hora</dt><dd>{formatTime(movement.created_at)}</dd><dt>Sucursal</dt><dd>{movement.branch_name}</dd><dt>Dirección</dt><dd>{movement.branch_address || "No informada"}</dd><dt>Teléfono</dt><dd>{movement.branch_phone || "No informado"}</dd><dt>Producto</dt><dd>{movement.product_name} · {movement.internal_code}</dd><dt>Cantidad</dt><dd>{movement.quantity > 0 ? "+" : ""}{movement.quantity} unidades</dd><dt>Lote</dt><dd>{movement.lot_number || "No aplica"}</dd><dt>Vencimiento</dt><dd>{movement.expires_on ? formatDateOnly(movement.expires_on) : "No informado"}</dd><dt>Responsable</dt><dd>{movement.user_name}</dd><dt>Motivo</dt><dd>{movement.reason}</dd>{movement.edited_by && <><dt>Motivo corregido por</dt><dd>{movement.edited_by}</dd></>}</dl>
      <p>Este documento es un comprobante interno de movimiento de inventario. No constituye factura ni comprobante fiscal válido.</p>
    </article>
    <form className="receipt-email-form" onSubmit={onSubmit}><label>Enviar copia por correo (requiere SMTP configurado)<input value={email} onChange={(event) => onEmailChange(event.target.value)} name="email" type="email" maxLength={254} placeholder="destino@correo.com" required /></label>{error && <p className="receipt-form-error" role="alert">{error}</p>}<div><button type="button" className="secondary-button" onClick={onClose}>Cerrar</button><button type="button" className="secondary-button" onClick={() => window.print()}>Imprimir</button><button className="primary-button" disabled={busy}>{busy ? "Enviando…" : "Enviar correo"}</button></div></form>
  </div></div>;
}

function inventoryCsvRows(
  stock: InventoryData["stock"],
  selectedBranchName: string | null,
): Array<Array<string | number | null | undefined>> {
  const rows: Array<Array<string | number | null | undefined>> = [
    ["Código", "Producto", "Sucursal", "Lote", "Vencimiento", "Cantidad", "Stock mínimo"],
  ];
  for (const item of stock) {
    if (item.lots.length) {
      for (const lot of item.lots) {
        rows.push([item.internal_code, item.name, lot.branchName, lot.lotNumber, lot.expiresOn, lot.quantity, item.minimum_stock]);
      }
    } else {
      rows.push([
        item.internal_code,
        item.name,
        selectedBranchName ?? "Varias sucursales",
        "",
        "",
        item.quantity,
        item.minimum_stock,
      ]);
    }
  }
  return rows;
}

function paymentLabel(method: string) {
  return { cash: "Efectivo", card: "Tarjeta", digital_wallet: "Billetera virtual", other: "Otro" }[method] ?? method;
}

function movementLabel(type: string) {
  return ({ in: "Entrada", out: "Salida", loss: "Merma", sale: "Venta", adjustment: "Ajuste", return: "Devolución", transfer_in: "Transferencia recibida", transfer_out: "Transferencia enviada", expiry: "Vencimiento" } as Record<string, string>)[type] ?? type;
}

function orderStatusLabel(status: string) {
  return ({
    pending_review: "Pendiente de revisión",
    confirmed: "Confirmado",
    preparing: "En preparación",
    ready_for_pickup: "Listo para retirar",
    out_for_delivery: "En reparto",
    completed: "Completado",
    cancelled: "Cancelado",
  } as Record<string, string>)[status] ?? status;
}

function nextOrderStatus(order: OnlineOrder) {
  if (order.status === "pending_review") return "confirmed";
  if (order.status === "confirmed") return "preparing";
  if (order.status === "preparing") return order.fulfillment_mode === "pickup" ? "ready_for_pickup" : "out_for_delivery";
  if (order.status === "ready_for_pickup" || order.status === "out_for_delivery") return "completed";
  return null;
}

function orderActionLabel(order: OnlineOrder, next: string) {
  if (order.status === "pending_review") return "Confirmar pedido";
  if (order.status === "confirmed") return "Iniciar preparación";
  if (next === "ready_for_pickup") return "Marcar listo para retirar";
  if (next === "out_for_delivery") return "Marcar en reparto";
  return "Marcar completado";
}
