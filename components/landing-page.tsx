"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import { jsPDF } from "jspdf";
import { filterCatalogProducts, getCatalogCategories } from "@/lib/catalog-filters.mjs";

type StoreBranch = {
  id: string;
  name: string;
  address: string;
  phone: string;
  image_url: string;
  delivery_zone: string;
};

type StoreProduct = {
  id: string;
  internal_code: string;
  name: string;
  category_id: string;
  category: string;
  presentation: string;
  manufacturer: string;
  cover_image_url: string;
  online_description: string;
  online_featured: boolean;
  branches: Array<{ branchId: string; name: string; quantity: number; price: number }>;
};

type CartLine = { productId: string; quantity: number };
type PaymentMethod = "to_confirm";
type ReceiptItem = { name: string; quantity: number; unitPrice: number; lineTotal: number };
type OrderConfirmation = {
  order_number: string;
  reservationMinutes?: number;
  branchName: string;
  total: number;
  paymentMethod: PaymentMethod;
  customerName: string;
  customerEmail: string;
  items: ReceiptItem[];
};
const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const paymentLabels: Record<PaymentMethod, string> = { to_confirm: "A coordinar con la sucursal" };
const branchAreas = [
  { name: "Sucursal Norte", query: "Farmacias del Norte Norte Formosa Capital" },
  { name: "Sucursal Sur", query: "Farmacias del Norte Sur Formosa Capital" },
  { name: "Sucursal Este", query: "Farmacias del Norte Este Formosa Capital" },
  { name: "Sucursal Oeste", query: "Farmacias del Norte Oeste Formosa Capital" },
];

function createReceiptPdf(order: OrderConfirmation) {
  const document = new jsPDF();
  document.setFont("helvetica", "bold");
  document.setFontSize(16);
  document.text("FARMACIAS DEL NORTE", 16, 20);
  document.setFontSize(10);
  document.setFont("helvetica", "normal");
  document.text("CONSTANCIA DE RECEPCION DE PEDIDO", 16, 27);
  document.text(`Operacion: ${order.order_number}`, 16, 39);
  document.text(`Cliente: ${order.customerName}`, 16, 46);
  document.text(`Correo: ${order.customerEmail}`, 16, 53);
  document.text(`Punto elegido: ${order.branchName}`, 16, 60);
  document.text(`Pago: ${paymentLabels[order.paymentMethod]}`, 16, 67);
  let y = 81;
  for (const item of order.items) {
    const lines = document.splitTextToSize(`${item.quantity} x ${item.name} - ${ars.format(item.lineTotal)}`, 175);
    if (y + lines.length * 6 > 260) {
      document.addPage();
      y = 20;
    }
    document.text(lines, 16, y);
    y += lines.length * 6 + 2;
  }
  y += 5;
  document.setFont("helvetica", "bold");
  document.text(`TOTAL DEL PEDIDO: ${ars.format(order.total)}`, 16, y);
  document.setFont("helvetica", "normal");
  document.setFontSize(9);
  document.text(document.splitTextToSize("Pedido pendiente de confirmacion de stock y coordinacion del pago. Esta constancia no es una factura ni un comprobante de pago.", 175), 16, y + 10);
  return document;
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error("No pudimos cargar esta información. Intentalo de nuevo más tarde.");
  return response.json() as Promise<T>;
}

function SocialLinks() {
  return <div className="store-social-links" aria-label="Redes sociales"><a href="https://web.whatsapp.com/" target="_blank" rel="noreferrer" aria-label="WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.6a8 8 0 0 1-11.8 7l-4 .9 1-3.8A8 8 0 1 1 20 11.6Z" /><path d="M9 8.5c.3-.6.7-.5 1-.5l.8 1.8-.7.9c.7 1.4 1.6 2.2 3 2.8l.8-.8 1.8.8c.2.1.3.4.2.7-.3 1-1 1.5-2 1.5-2.7-.2-5.8-3.2-6-5.7 0-.7.4-1.2 1.1-1.5Z" /></svg></a><a href="https://www.instagram.com/" target="_blank" rel="noreferrer" aria-label="Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" /><circle cx="12" cy="12" r="3.5" /><circle className="social-icon-dot" cx="17.5" cy="6.8" r="1" /></svg></a><a href="https://www.facebook.com/" target="_blank" rel="noreferrer" aria-label="Facebook">f</a><a href="https://x.com/" target="_blank" rel="noreferrer" aria-label="X">X</a></div>;
}

export function LandingPage() {
  const reduceMotion = useReducedMotion();
  const scrollAnimation = useRef<{ stop: () => void } | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [branches, setBranches] = useState<StoreBranch[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [category, setCategory] = useState("Todas");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [branchError, setBranchError] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [fulfillmentMode, setFulfillmentMode] = useState<"pickup" | "delivery">("pickup");
  const [branchId, setBranchId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderConfirmation, setOrderConfirmation] = useState<OrderConfirmation | null>(null);
  const [orderError, setOrderError] = useState("");
  const [paymentMethod] = useState<PaymentMethod>("to_confirm");

  function downloadReceipt(order: OrderConfirmation) {
    createReceiptPdf(order).save(`comprobante-${order.order_number}.pdf`);
  }

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      loadJson<StoreProduct[]>("/api/store/products"),
      loadJson<Array<{ name: string }>>("/api/categories"),
      loadJson<StoreBranch[]>("/api/store/branches"),
    ]).then(([productResult, categoryResult, branchResult]) => {
      if (!active) return;
      if (productResult.status === "fulfilled") setProducts(productResult.value);
      else setCatalogError(true);
      if (categoryResult.status === "fulfilled") {
        setActiveCategories(categoryResult.value.map((item) => item.name));
      } else {
        setCatalogError(true);
      }
      if (branchResult.status === "fulfilled") setBranches(branchResult.value);
      else setBranchError(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const categories = useMemo(
    () => getCatalogCategories(products, activeCategories),
    [activeCategories, products],
  );
  const featuredProducts = useMemo(() => products.filter((product) => product.online_featured).slice(0, 3), [products]);
  const filteredProducts = useMemo(
    () => filterCatalogProducts(products, category, search),
    [category, products, search],
  );
  const cartProducts = cart.map((line) => ({
    ...line,
    product: products.find((product) => product.id === line.productId),
  })).filter((line): line is CartLine & { product: StoreProduct } => Boolean(line.product));
  const hasDeliveryZones = branches.some((branch) => branch.delivery_zone.trim());
  const candidateBranches = branches.filter((branch) => (
    (fulfillmentMode !== "delivery" || Boolean(branch.delivery_zone.trim()))
    && cartProducts.every((line) => {
      const option = line.product.branches.find((item) => item.branchId === branch.id);
      return option && option.quantity >= line.quantity;
    })
  ));
  const selectedBranch = candidateBranches.find((branch) => branch.id === branchId) ?? candidateBranches[0];
  const cartTotal = cartProducts.reduce((total, line) => {
    const option = line.product.branches.find((item) => item.branchId === selectedBranch?.id);
    return total + (option?.price ?? 0) * line.quantity;
  }, 0);

  function handleLandingAnchorClick(event: MouseEvent<HTMLElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link || link.target && link.target !== "_self" || link.hasAttribute("download")) return;
    const targetId = decodeURIComponent(link.hash.slice(1));
    const target = document.getElementById(targetId);
    if (!target) return;

    event.preventDefault();
    window.history.pushState(null, "", link.hash);
    scrollAnimation.current?.stop();
    if (reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      target.scrollIntoView({ behavior: "instant", block: "start" });
      target.focus({ preventScroll: true });
      return;
    }

    target.focus({ preventScroll: true });
    const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - 88);
    scrollAnimation.current = animate(window.scrollY, top, {
      duration: 0.85,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (value) => window.scrollTo(0, value),
    });
  }

  function addToCart(product: StoreProduct) {
    setCart((current) => {
      const line = current.find((entry) => entry.productId === product.id);
      return line
        ? current.map((entry) => entry.productId === product.id ? { ...entry, quantity: entry.quantity + 1 } : entry)
        : [...current, { productId: product.id, quantity: 1 }];
    });
    setOrderConfirmation(null);
    setCartOpen(true);
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((current) => quantity < 1
      ? current.filter((entry) => entry.productId !== productId)
      : current.map((entry) => entry.productId === productId ? { ...entry, quantity } : entry));
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBranch || !cartProducts.length) {
      setOrderError("Elegí una sucursal con stock disponible para todos los productos.");
      return;
    }
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setOrderError("");
    try {
      const customerName = String(form.get("customerName"));
      const customerEmail = String(form.get("customerEmail"));
      const receiptItems = cartProducts.map((line) => {
        const unitPrice = line.product.branches.find((item) => item.branchId === selectedBranch.id)?.price ?? 0;
        return { name: line.product.name, quantity: line.quantity, unitPrice, lineTotal: unitPrice * line.quantity };
      });
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: selectedBranch.id,
          fulfillmentMode,
          customerName: form.get("customerName"),
          customerEmail: form.get("customerEmail"),
          customerPhone: form.get("customerPhone"),
          deliveryAddress: form.get("deliveryAddress"),
          paymentMethod,
          items: cart,
          privacyConsent: form.get("privacyConsent") === "on",
        }),
      });
      const payload = await response.json() as Partial<OrderConfirmation> & { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo registrar el pedido.");
      if (!payload.order_number) throw new Error("El pedido se guardó, pero no recibimos su número de comprobante.");
      setOrderConfirmation({
        order_number: payload.order_number,
        reservationMinutes: payload.reservationMinutes,
        branchName: selectedBranch.name,
        total: payload.total ?? cartTotal,
        paymentMethod,
        customerName,
        customerEmail,
        items: payload.items ?? receiptItems,
      });
      setCart([]);
      setBranchId("");
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : "No se pudo registrar el pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="storefront" onClick={handleLandingAnchorClick}>
      <header className="store-header">
        <a className="store-brand" href="#inicio" aria-label="Farmacias del Norte, inicio">
          <img src="/farmacias-del-norte-logo.png" alt="" /><span><b>FARMACIAS</b><small>DEL NORTE</small></span>
        </a>
        <nav className="store-nav" aria-label="Navegación">
          <a href="#productos">Productos</a><a href="#beneficios">Beneficios</a><a href="#sucursales">Sucursales</a><a href="#nosotros">Nosotros</a>
        </nav>
        <div className="store-header-actions">
          <a className="store-admin-link" href="/admin">Acceder</a>
          <button className="store-cart-button" onClick={() => setCartOpen(true)} aria-label={`Abrir carrito, ${cart.reduce((sum, item) => sum + item.quantity, 0)} productos`}>
            <span>Bolsa</span><b>{cart.reduce((sum, item) => sum + item.quantity, 0)}</b>
          </button>
        </div>
      </header>

      <section className="store-hero" id="inicio" tabIndex={-1}>
        <motion.div
          className="store-hero-copy"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.55, ease: "easeOut" }}
        >
          <span className="store-eyebrow"><i /> CERCA TUYO, TODOS LOS DÍAS</span>
          <h1>Tu salud y bienestar,<br /><em>más cerca.</em></h1>
          <p>Encontrá lo que necesitás para cuidarte, con la atención cálida de siempre y una farmacia cerca de vos.</p>
          <div className="store-hero-actions"><a className="store-primary-button" href="#productos">Explorar productos <span>→</span></a><a className="store-text-link" href="#sucursales">Encontrá tu sucursal</a></div>
          <div className="store-hero-note"><span>✳</span> Atención cercana · Cuidado responsable</div>
        </motion.div>
        <motion.div
          className="store-hero-art"
          aria-label="Composición gráfica de cuidado y bienestar"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.7, delay: reduceMotion ? 0 : 0.12, ease: "easeOut" }}
        >
          <img className="hero-image" src="/hero-farmacia.png" alt="Farmacias del Norte: tu salud, nuestra prioridad" />
        </motion.div>
      </section>

      <section className="store-trust-strip" id="beneficios" tabIndex={-1}>
        <article><span>✳</span><div><b>Atención cercana</b><small>Personas que te acompañan</small></div></article>
        <article><span>⌂</span><div><b>Elegí tu sucursal</b><small>Retiro según stock local</small></div></article>
        <article><span>♡</span><div><b>Compra responsable</b><small>Productos aptos para venta online</small></div></article>
      </section>

      <section className="store-products-section" id="productos" tabIndex={-1}>
        <div className="store-section-heading">
          <div><span className="store-eyebrow">NUESTRO CATÁLOGO</span><h2>Un poquito de cuidado,<br /><em>en cada día.</em></h2></div>
          <p>Una selección de productos habilitados para compra online. La disponibilidad y el precio se confirman según la sucursal elegida.</p>
        </div>
        {!search && category === "Todas" && featuredProducts.length > 0 && <div className="store-featured-row"><span className="store-eyebrow">DESTACADOS DE LA TIENDA</span><div>{featuredProducts.map((product) => <button key={product.id} onClick={() => addToCart(product)}><span>✳ {product.category}</span><b>{product.name}</b><small>Ver disponibilidad y agregar →</small></button>)}</div></div>}
        <div className="store-catalog-controls">
          {categories.length > 1 && <div className="store-category-filter" role="group" aria-label="Filtrar por categoría">
            {categories.map((item) => <button key={item} type="button" className={category === item ? "active" : ""} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
          </div>}
          <label className="store-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar productos" aria-label="Buscar productos" /></label>
        </div>
        {loading ? <div className="store-empty">Estamos preparando el catálogo…</div>
            : catalogError ? <div className="store-empty">Estamos actualizando el catálogo para compartir información precisa. Volvé a visitarnos pronto.</div>
            : filteredProducts.length ? (
              <div className="store-product-grid">
                {filteredProducts.map((product, index) => {
                  const cheapest = [...product.branches].sort((a, b) => a.price - b.price)[0];
                  return (
                    <motion.article
                      className="store-product-card"
                      key={product.id}
                      initial={reduceMotion || index >= 8 ? false : { opacity: 0, y: 12 }}
                      whileInView={index < 8 ? { opacity: 1, y: 0 } : undefined}
                      viewport={{ once: true, amount: 0.2 }}
                      transition={{ duration: reduceMotion ? 0 : 0.35, delay: reduceMotion || index >= 8 ? 0 : Math.min(index * 0.04, 0.2), ease: "easeOut" }}
                    >
                      <div className="store-product-image">
                        {product.cover_image_url ? <img src={product.cover_image_url} alt={product.name} loading="lazy" /> : <div className="store-product-placeholder"><span>✳</span><small>{product.category}</small></div>}
                        <span className="store-product-category">{product.category}</span>
                      </div>
                      <div className="store-product-info"><span>{product.manufacturer || "Farmacias del Norte"}</span><h3>{product.name}</h3><p>{product.online_description || product.presentation || "Consulta disponibilidad en tu sucursal."}</p>
                        <div className="store-product-buy"><b>{cheapest ? ars.format(cheapest.price) : "Consultar"}</b><button onClick={() => addToCart(product)} disabled={!product.branches.length}>Agregar <span>＋</span></button></div>
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            ) : <div className="store-empty" role="status">{products.length
              ? "No encontramos productos con ese filtro."
              : category !== "Todas"
                ? `No hay productos habilitados para compra online en «${category}» con stock vigente.`
                : "No hay productos habilitados para compra online disponibles por ahora. Las categorías aparecerán cuando haya productos publicados con stock vigente."}</div>}
        <p className="store-regulatory-note">Los productos que requieren receta no se ofrecen para compra automática. La venta está sujeta a confirmación de stock y a la normativa aplicable.</p>
      </section>

      <section className="store-promo-band">
        <div className="promo-flower">✳</div><div><span className="store-eyebrow">CUIDARTE TAMBIÉN ES SIMPLE</span><h2>Lo importante es<br /><em>sentirte acompañado.</em></h2><p>Descubrí opciones para tu cuidado diario y consultá en cada sucursal por las propuestas vigentes.</p></div><a href="#sucursales">Ver sucursales <span>→</span></a>
      </section>

      <section className="store-about-section" id="nosotros" tabIndex={-1}>
        <div className="store-about-art"><img src="/farmacias-del-norte-logo.png" alt="" /><span>FARMACIAS<br />DEL NORTE</span><i>+</i></div>
        <div className="store-about-copy"><span className="store-eyebrow">SOBRE NOSOTROS</span><h2>Estar cerca<br />hace la diferencia.</h2><p>En Farmacias del Norte creemos en el valor de escuchar, orientar y acompañar. Trabajamos para que encontrar cuidado y bienestar sea más fácil, con una atención responsable en cada sucursal.</p><a href="#sucursales" className="store-text-link">Conocé nuestros locales →</a><SocialLinks /></div>
      </section>

      <section className="store-branches-section" id="sucursales" tabIndex={-1}>
        <div className="store-section-heading"><div><span className="store-eyebrow">ENCONTRANOS CERCA</span><h2>Farmacias del Norte,<br /><em>siempre cerca.</em></h2></div><p>Échale un vistazo a nuestras sucursales y encontrá la más cercana en Formosa Capital.</p></div>
        {branches.length ? <div className="store-branch-grid">{branches.map((branch) => (
          <article className="store-branch-card" key={branch.id}>
            {branch.image_url ? <img src={branch.image_url} alt={`Sucursal ${branch.name}`} loading="lazy" /> : <div className="store-branch-placeholder"><span>⌂</span><small>Farmacias del Norte</small></div>}
            <div className="store-branch-card-copy"><span className="store-eyebrow">FARMACIAS DEL NORTE</span><h3>{branch.name}</h3><p>{branch.address || "Te esperamos para acompañarte en tu cuidado."}</p>{branch.delivery_zone && <small className="store-zone-tag">Zona de entrega · {branch.delivery_zone}</small>}{branch.phone && <a href={`tel:${branch.phone.replace(/[^\d+]/g, "")}`}>Llamar: {branch.phone}</a>}</div>
          </article>
        ))}</div> : <div className="store-empty">{branchError ? "No pudimos cargar las direcciones en este momento." : "Estamos preparando los datos de nuestros locales para que puedas encontrarlos fácilmente."}</div>}
        <div className="store-map-card"><div><span className="store-eyebrow">CERCA TUYO EN FORMOSA CAPITAL</span><h3>Échale un vistazo a nuestras sucursales</h3><p>Buscá Farmacias del Norte por zona en Google Maps.</p><div className="store-branch-map-links">{branchAreas.map((branch) => <a key={branch.name} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.query)}`} target="_blank" rel="noreferrer">{branch.name} <span>↗</span></a>)}</div><small className="store-map-note">La ubicación exacta depende de las direcciones publicadas por cada sucursal.</small></div><iframe title="Buscar Farmacias del Norte en Formosa Capital en Google Maps" src="https://www.google.com/maps?q=Farmacias%20del%20Norte%20Formosa%20Capital&output=embed" loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div>
      </section>

      <section className="store-faq-section" id="preguntas" tabIndex={-1}>
        <div><span className="store-eyebrow">PREGUNTAS FRECUENTES</span><h2>¿Tenés dudas?<br /><em>Estamos para ayudarte.</em></h2><p>Consultá cómo preparar tu pedido y coordinarlo con tu sucursal.</p></div>
        <div className="store-faq-list">
          <details><summary>¿Cómo funciona el pedido online?<span>＋</span></summary><p>Elegí productos habilitados, seleccioná una sucursal con stock y enviá tus datos de contacto. El pedido queda pendiente de revisión; la sucursal confirma disponibilidad y coordina el pago.</p></details>
          <details><summary>¿Puedo pedir medicamentos con receta?<span>＋</span></summary><p>No. La compra automática de productos que requieren receta está deshabilitada. Consultá directamente en una sucursal para recibir orientación conforme a la normativa.</p></details>
          <details><summary>¿Qué medios de pago puedo utilizar?<span>＋</span></summary><p>Cuando la sucursal confirme tu pedido, te informará las opciones de pago disponibles.</p></details>
          <details><summary>¿Hacen entregas a domicilio?<span>＋</span></summary><p>La entrega estará disponible en las zonas que cada sucursal tenga habilitadas. También podés elegir el retiro en sucursal.</p></details>
        </div>
      </section>

      <section className="store-contact-band" id="contacto" tabIndex={-1}>
        <div><span className="store-eyebrow">¿NECESITÁS UNA MANO?</span><h2>Hablemos de<br /><em>lo que necesitás.</em></h2></div>
        <div><p>¿Buscás orientación? Encontrá tu sucursal en Google Maps o escribinos por WhatsApp; estamos para acompañarte.</p><a href="https://web.whatsapp.com/" target="_blank" rel="noreferrer" className="store-light-button">Conversemos por WhatsApp <span>↗</span></a></div>
      </section>

      <footer className="store-footer">
        <div className="store-footer-brand"><a className="store-brand" href="#inicio"><img src="/farmacias-del-norte-logo.png" alt="" /><span><b>FARMACIAS</b><small>DEL NORTE</small></span></a><p>Tu salud y bienestar, más cerca.</p></div>
        <div className="store-footer-links"><a href="#productos">Productos</a><a href="#beneficios">Beneficios</a><a href="#nosotros">Nosotros</a><a href="#sucursales">Sucursales</a><a href="#preguntas">Preguntas frecuentes</a><a href="/admin">Acceder</a><SocialLinks /></div>
        <div className="store-legal"><b>Información importante</b><p>La información de este sitio no reemplaza la consulta con profesionales de salud. La oferta online se limita a productos autorizados y no incluye medicamentos sujetos a receta. Los pedidos quedan sujetos a confirmación de stock y coordinación del pago con la sucursal. La plataforma no emite comprobantes fiscales.</p><small>Farmacias del Norte · Cuidarte, cerca y con responsabilidad.</small></div>
      </footer>

      {cartOpen && <div className="store-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCartOpen(false); }}>
        <aside className="store-drawer" aria-label="Carrito de compras">
          <div className="store-drawer-head"><div><span className="store-eyebrow">TU SELECCIÓN</span><h2>Tu pedido</h2></div><button onClick={() => setCartOpen(false)} aria-label="Cerrar carrito">×</button></div>
          {orderConfirmation ? <div className="store-receipt store-receipt-print" id="digital-receipt"><div className="store-receipt-brand"><img src="/farmacias-del-norte-logo.png" alt="" /><span><b>FARMACIAS DEL NORTE</b><small>CONSTANCIA DE PEDIDO</small></span></div><span className="store-receipt-check">✓</span><h3>¡Gracias, {orderConfirmation.customerName}!</h3><p>Recibimos tu pedido y la sucursal confirmará disponibilidad y coordinará el pago.</p><div className="store-receipt-meta"><span>Número de pedido</span><b>{orderConfirmation.order_number}</b><span>Sucursal</span><b>{orderConfirmation.branchName}</b><span>Pago</span><b>{paymentLabels[orderConfirmation.paymentMethod]}</b><span>Correo</span><b>{orderConfirmation.customerEmail}</b></div><div className="store-receipt-items">{orderConfirmation.items.map((item, index) => <div key={`${item.name}-${index}`}><span>{item.quantity} × {item.name}</span><b>{ars.format(item.lineTotal)}</b></div>)}</div><div className="store-receipt-total"><span>Total estimado</span><b>{ars.format(orderConfirmation.total)}</b></div><small className="store-receipt-disclaimer">Constancia de recepción de pedido. No es factura ni comprobante de pago.</small><div className="store-receipt-actions"><button className="store-primary-button" onClick={() => downloadReceipt(orderConfirmation)}>Descargar PDF</button><button className="secondary-button" onClick={() => window.print()}>Imprimir</button></div><button className="store-text-link" onClick={() => { setOrderConfirmation(null); setCartOpen(false); }}>Seguir recorriendo →</button></div>
            : cartProducts.length ? <>
              <div className="store-cart-lines">{cartProducts.map((line) => <div className="store-cart-line" key={line.productId}><div className="store-cart-thumb">{line.product.cover_image_url ? <img src={line.product.cover_image_url} alt="" /> : "✳"}</div><div className="store-cart-item"><b>{line.product.name}</b><small>{line.product.category}</small><strong>{ars.format((line.product.branches.find((option) => option.branchId === selectedBranch?.id)?.price ?? 0) * line.quantity)}</strong></div><div className="store-quantity"><button aria-label={`Quitar una unidad de ${line.product.name}`} onClick={() => updateQuantity(line.productId, line.quantity - 1)}>−</button><span>{line.quantity}</span><button aria-label={`Agregar una unidad de ${line.product.name}`} onClick={() => updateQuantity(line.productId, line.quantity + 1)}>＋</button></div></div>)}</div>
              <form className="store-checkout-form" onSubmit={(event) => void submitOrder(event)}>
                <label>¿Cómo querés recibirlo?<select value={fulfillmentMode} onChange={(event) => setFulfillmentMode(event.target.value as "pickup" | "delivery")}><option value="pickup">Retirar en sucursal</option><option value="delivery" disabled={!hasDeliveryZones}>Entrega a domicilio{!hasDeliveryZones ? " (próximamente)" : ""}</option></select></label>
                <label>Sucursal<select value={selectedBranch?.id ?? ""} onChange={(event) => setBranchId(event.target.value)} required><option value="" disabled>Elegí una sucursal con stock</option>{candidateBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}{fulfillmentMode === "delivery" ? ` · ${branch.delivery_zone}` : ""}</option>)}</select></label>
                {!candidateBranches.length && <p className="store-form-error">No hay una sucursal con stock suficiente para todos los productos del carrito.</p>}
                {fulfillmentMode === "delivery" && <label>Dirección de entrega<input name="deliveryAddress" maxLength={240} placeholder="Calle, número, ciudad" required /></label>}
                <div className="store-customer-fields"><label>Nombre y apellido<input name="customerName" maxLength={160} autoComplete="name" required /></label><label>Correo electrónico<input name="customerEmail" type="email" maxLength={254} autoComplete="email" required /></label><label>Teléfono<input name="customerPhone" type="tel" maxLength={60} autoComplete="tel" required /></label></div>
                <div className="store-checkout-total"><span>Total estimado</span><b>{ars.format(cartTotal)}</b></div>
                <p className="store-payment-warning">La sucursal confirmará las opciones de pago disponibles al revisar tu pedido. No se solicitarán datos de tarjeta en este formulario.</p>
                <label className="store-consent"><input name="privacyConsent" type="checkbox" required /> Acepto que mis datos de contacto se usen solo para gestionar este pedido.</label>
                {orderError && <p className="store-form-error" role="alert">{orderError}</p>}
                <button className="store-primary-button store-submit-order" disabled={submitting || !candidateBranches.length}>{submitting ? "Enviando pedido…" : "Enviar pedido"} <span>→</span></button>
              </form>
            </> : <div className="store-empty store-cart-empty"><span>✳</span><b>Tu carrito está esperando</b><p>Sumá productos del catálogo para armar tu pedido.</p><a className="store-primary-button" href="#productos" onClick={() => setCartOpen(false)}>Ver productos <span>→</span></a></div>}
        </aside>
      </div>}
    </main>
  );
}
