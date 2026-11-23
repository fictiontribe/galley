// The shop in the browser: the bag (a drawer and a page), the buy box on
// product pages, live price and stock, the shop page's filters, search, and
// the hand-off of a visitor's consent choice to the store. No framework.
//
// Two modes, told by the page (#shop-config, written at build time):
// - demo: no store is connected. The bag lives in this browser's
//   localStorage and "Check out" explains that nothing can be paid for.
// - store: the bag is a cart in the store's Storefront API (cartCreate,
//   cartLinesAdd, cartLinesUpdate, cartLinesRemove; shopify.dev, 2026-10),
//   and "Check out" sends the visitor to the cart's checkoutUrl.
//
// Nothing is asked of the store before the visitor does something: the
// bag's count comes from localStorage, live price and stock are fetched on
// the first pointer, key or touch, and Shopify's customer-privacy script
// loads only after a choice in the consent banner.
import type { StoreClientConfig } from "../lib/shop/types";

type Labels = Record<string, string>;
type Money = { amount: string; currencyCode: string };

interface Line {
  variantId: string;
  lineId?: string;
  handle: string;
  title: string;
  variant: string;
  price: Money;
  image: string;
  quantity: number;
}

interface Bag {
  v: 1;
  mode: "demo" | "store";
  /** The store's full cart id (token and key): kept in this browser only, never in an address. */
  cartId?: string;
  lines: Line[];
}

interface VariantData {
  id: string;
  options: Record<string, string>;
  price: Money;
  available: boolean;
  title: string;
  image: { src: string; srcset?: string; alt: string; thumb: string } | null;
  few?: boolean;
}

const configElement = document.getElementById("shop-config");
const config = JSON.parse(configElement?.textContent || "{}") as StoreClientConfig & { labels: Labels; productBase: string; bagKey: string };
const L = config.labels ?? {};
const KEY = config.bagKey || "shop:bag";

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
const moneyFormats = new Map<string, Intl.NumberFormat>();

function money(value: Money | number, currency = config.currency): string {
  const amount = typeof value === "number" ? value : Number(value.amount);
  const code = typeof value === "number" ? currency : value.currencyCode;
  const whole = Number.isInteger(amount);
  const key = `${code}:${whole}`;
  let format = moneyFormats.get(key);

  if (!format) {
    format = new Intl.NumberFormat(config.locale, { style: "currency", currency: code, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
    moneyFormats.set(key, format);
  }
  return format.format(amount);
}

// ── the bag, kept in this browser ─────────────────────────────────────────

function readBag(): Bag {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || "null") as Bag | null;

    // A bag from the other mode (the site was connected to a store since) is set aside, never mixed.
    if (stored && stored.v === 1 && stored.mode === config.mode && Array.isArray(stored.lines)) return stored;
  } catch {
    // Storage blocked or damaged: start empty.
  }
  return { v: 1, mode: config.mode, lines: [] };
}

let bag = readBag();
const listeners = new Set<() => void>();

function saveBag(next: Bag): void {
  bag = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(bag));
  } catch {
    // The bag still works for this page.
  }
  listeners.forEach((listener) => listener());
}

const count = () => bag.lines.reduce((sum, line) => sum + line.quantity, 0);
const subtotal = () => bag.lines.reduce((sum, line) => sum + Number(line.price.amount) * line.quantity, 0);

// ── the store's cart (store mode) ─────────────────────────────────────────

class ShopError extends Error {}

async function storefront<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (!config.endpoint) throw new ShopError(L.bagError);
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };

  if (config.publicToken) headers["x-shopify-storefront-access-token"] = config.publicToken;
  const response = await fetch(config.endpoint, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
  const body = (await response.json().catch(() => null)) as { data?: T; errors?: unknown[] } | null;

  if (!response.ok || !body?.data || body.errors?.length) throw new ShopError(L.bagError);
  return body.data;
}

// Thirty different pieces is more than any bag holds, and keeps each cart request inside the tokenless complexity limit (1,000).
const CART_FIELDS = `id checkoutUrl totalQuantity cost { subtotalAmount { amount currencyCode } }
  lines(first: 30) { nodes { id quantity cost { amountPerQuantity { amount currencyCode } }
    merchandise { ... on ProductVariant { id title image { url(transform: { maxWidth: 240 }) } product { handle title } } } } }`;

interface CartNode {
  id: string;
  checkoutUrl: string;
  lines: { nodes: Array<{ id: string; quantity: number; cost: { amountPerQuantity: Money }; merchandise: { id: string; title: string; image: { url: string } | null; product: { handle: string; title: string } } }> };
}

interface CartPayload {
  cart: CartNode | null;
  userErrors: Array<{ message: string }>;
  warnings: Array<{ message: string }>;
}

let lastCheckoutUrl: string | null = null;

function fromCart(cart: CartNode): void {
  lastCheckoutUrl = cart.checkoutUrl;
  saveBag({
    v: 1,
    mode: "store",
    cartId: cart.id,
    lines: cart.lines.nodes.map((line) => ({
      variantId: line.merchandise.id,
      lineId: line.id,
      handle: line.merchandise.product.handle,
      title: line.merchandise.product.title,
      variant: line.merchandise.title === "Default Title" ? "" : line.merchandise.title,
      price: line.cost.amountPerQuantity,
      image: line.merchandise.image?.url ?? "",
      quantity: line.quantity,
    })),
  });
}

function settle(payload: CartPayload): void {
  if (payload.cart) fromCart(payload.cart);
  if (payload.userErrors.length) throw new ShopError(L.bagError);
  if (payload.warnings.length) notify(L.stockChanged);
}

const cart = {
  async refresh(): Promise<void> {
    if (!bag.cartId) return;
    const data = await storefront<{ cart: CartNode | null }>(`query Bag($id: ID!) { cart(id: $id) { ${CART_FIELDS} } }`, { id: bag.cartId });

    // A cart the store no longer has (it expired) is let go of.
    if (data.cart) fromCart(data.cart);
    else saveBag({ v: 1, mode: "store", lines: [] });
  },
  async add(variantId: string, quantity: number): Promise<void> {
    if (!bag.cartId) {
      const data = await storefront<{ cartCreate: CartPayload }>(`mutation BagCreate($input: CartInput!) { cartCreate(input: $input) { cart { ${CART_FIELDS} } userErrors { message } warnings { message } } }`, {
        input: { lines: [{ merchandiseId: variantId, quantity }] },
      });

      return settle(data.cartCreate);
    }
    const data = await storefront<{ cartLinesAdd: CartPayload }>(`mutation BagAdd($cartId: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ${CART_FIELDS} } userErrors { message } warnings { message } } }`, {
      cartId: bag.cartId,
      lines: [{ merchandiseId: variantId, quantity }],
    });

    settle(data.cartLinesAdd);
  },
  async set(line: Line, quantity: number): Promise<void> {
    if (quantity <= 0) {
      const data = await storefront<{ cartLinesRemove: CartPayload }>(`mutation BagRemove($cartId: ID!, $lineIds: [ID!]!) { cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ${CART_FIELDS} } userErrors { message } warnings { message } } }`, {
        cartId: bag.cartId,
        lineIds: [line.lineId],
      });

      return settle(data.cartLinesRemove);
    }
    const data = await storefront<{ cartLinesUpdate: CartPayload }>(`mutation BagUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ${CART_FIELDS} } userErrors { message } warnings { message } } }`, {
      cartId: bag.cartId,
      lines: [{ id: line.lineId, quantity }],
    });

    settle(data.cartLinesUpdate);
  },
  async checkoutUrl(): Promise<string> {
    // Asked again at the moment of checking out: the documented hand-off, and a stale link is replaced.
    await cart.refresh();
    if (!lastCheckoutUrl) throw new ShopError(L.checkoutError);
    return lastCheckoutUrl;
  },
};

// ── adding, changing, removing (both modes) ───────────────────────────────

async function addToBag(variant: VariantData, product: { handle: string; title: string }, quantity = 1): Promise<void> {
  if (config.mode === "store") return cart.add(variant.id, quantity);
  const existing = bag.lines.find((line) => line.variantId === variant.id);
  const lines = existing
    ? bag.lines.map((line) => (line === existing ? { ...line, quantity: Math.min(line.quantity + quantity, 9) } : line))
    : [...bag.lines, { variantId: variant.id, handle: product.handle, title: product.title, variant: variant.title, price: variant.price, image: variant.image?.thumb ?? "", quantity }];

  saveBag({ ...bag, lines });
}

async function setQuantity(variantId: string, quantity: number): Promise<void> {
  const line = bag.lines.find((item) => item.variantId === variantId);

  if (!line) return;
  if (config.mode === "store") return cart.set(line, quantity);
  saveBag({ ...bag, lines: quantity <= 0 ? bag.lines.filter((item) => item !== line) : bag.lines.map((item) => (item === line ? { ...item, quantity: Math.min(quantity, 9) } : item)) });
}

// ── the bag on screen: the header count, the drawer, the bag page ─────────

const drawer = document.querySelector<HTMLDialogElement>("[data-bag]");
const status = document.querySelector<HTMLElement>("[data-bag-status]");

function notify(message: string): void {
  if (!status) return;
  status.textContent = "";
  // A fresh text node each time, so the same message is announced again.
  requestAnimationFrame(() => {
    status.textContent = message;
  });
}

function renderCount(): void {
  const total = count();

  document.querySelectorAll<HTMLElement>("[data-bag-count]").forEach((element) => {
    element.textContent = String(total);
  });
  document.querySelectorAll<HTMLElement>("[data-bag-open]").forEach((element) => {
    element.setAttribute("aria-label", fill(L.bagWithCount, { count: total }));
  });
}

function renderLines(root: ParentNode): void {
  const list = root.querySelector<HTMLElement>("[data-bag-lines]");
  const template = document.querySelector<HTMLTemplateElement>("[data-bag-line-template]");
  const empty = root.querySelector<HTMLElement>("[data-bag-empty]");
  const filled = root.querySelectorAll<HTMLElement>("[data-bag-filled]");
  const total = root.querySelector<HTMLElement>("[data-bag-subtotal]");

  if (!list || !template) return;
  // Redrawing replaces the buttons: note which one had focus, to give it back.
  const focused = document.activeElement instanceof HTMLElement && list.contains(document.activeElement) ? document.activeElement : null;
  const focusLine = focused?.closest<HTMLElement>("[data-line]")?.dataset.line;
  const focusControl = focused ? ["data-increase", "data-decrease", "data-remove", "data-name"].find((name) => focused.hasAttribute(name)) : undefined;

  list.replaceChildren(
    ...bag.lines.map((line) => {
      const item = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
      const image = item.querySelector<HTMLImageElement>("[data-image]")!;
      const name = item.querySelector<HTMLAnchorElement>("[data-name]")!;

      item.dataset.line = line.variantId;
      // Already a full address: the store's, or this site's with its base path (from the product page).
      if (line.image) image.src = line.image;
      else image.hidden = true;
      name.textContent = line.title;
      name.href = `${config.productBase}${line.handle}/`;
      item.querySelector("[data-variant-title]")!.textContent = line.variant;
      item.querySelector("[data-price]")!.textContent = money({ amount: String(Number(line.price.amount) * line.quantity), currencyCode: line.price.currencyCode });
      item.querySelector("[data-quantity]")!.textContent = String(line.quantity);
      for (const button of item.querySelectorAll<HTMLButtonElement>("[data-label]")) button.setAttribute("aria-label", fill(button.dataset.label!, { product: line.title }));
      item.querySelector<HTMLButtonElement>("[data-increase]")!.disabled = line.quantity >= 9;
      return item;
    })
  );
  if (focusLine && focusControl) {
    const again = [...list.querySelectorAll<HTMLElement>("[data-line]")].find((item) => item.dataset.line === focusLine)?.querySelector<HTMLElement>(`[${focusControl}]`);

    (again && !(again as HTMLButtonElement).disabled ? again : root.querySelector<HTMLElement>("[data-checkout]"))?.focus();
  }
  if (empty) empty.hidden = bag.lines.length > 0;
  filled.forEach((element) => {
    element.hidden = bag.lines.length === 0;
  });
  if (total) total.textContent = money(subtotal(), bag.lines[0]?.price.currencyCode ?? config.currency);
}

function render(): void {
  renderCount();
  document.querySelectorAll<HTMLElement>("[data-bag-view]").forEach(renderLines);
}

listeners.add(render);

let queue: Promise<void> = Promise.resolve();

/**
 * One change to the bag at a time; a failure is said in words (in the bag,
 * or beside the button that asked when the bag isn't open) and the bag is
 * left as it was.
 */
function change(work: () => Promise<void>, messageElement?: HTMLElement | null): Promise<void> {
  // Changes wait their turn: each one reads the bag the one before it left.
  const run = async () => {
    document.querySelectorAll<HTMLElement>("[data-bag-view]").forEach((view) => view.setAttribute("aria-busy", "true"));
    try {
      await work();
    } catch (error) {
      const message = error instanceof ShopError ? error.message : L.bagError;

      if (messageElement && !drawer?.open) messageElement.textContent = message;
      else notify(message);
    } finally {
      document.querySelectorAll<HTMLElement>("[data-bag-view]").forEach((view) => view.removeAttribute("aria-busy"));
    }
  };

  queue = queue.then(run, run);
  return queue;
}

let returnTo: HTMLElement | null = null;

function openBag(trigger?: HTMLElement): void {
  if (!drawer) return;
  // Where focus goes back to when the bag closes: what opened it.
  returnTo = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  render();
  if (!drawer.open) drawer.showModal();
  if (config.mode === "store") void change(() => cart.refresh());
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const opener = target.closest<HTMLElement>("[data-bag-open]");

  if (opener && drawer) {
    event.preventDefault();
    openBag(opener);
    return;
  }
  if (target.closest("[data-bag-close]")) {
    drawer?.close();
    return;
  }
  const line = target.closest<HTMLElement>("[data-line]");
  const variantId = line?.dataset.line;

  if (variantId) {
    // Read when the change runs, not when it was asked for: two quick clicks make two more.
    const current = () => bag.lines.find((item) => item.variantId === variantId)?.quantity ?? 0;

    if (target.closest("[data-increase]")) void change(() => setQuantity(variantId, current() + 1));
    else if (target.closest("[data-decrease]")) void change(() => setQuantity(variantId, current() - 1));
    else if (target.closest("[data-remove]")) {
      void change(async () => {
        await setQuantity(variantId, 0);
        // The removed line's buttons are gone: keep focus inside the bag.
        document.querySelector<HTMLElement>("[data-bag-view] [data-decrease], [data-bag-view] [data-checkout], [data-bag-close]")?.focus();
      });
    }
    return;
  }
  const checkout = target.closest<HTMLButtonElement>("[data-checkout]");

  if (checkout) {
    if (config.mode === "demo") {
      const view = checkout.closest<HTMLElement>("[data-bag-view]");
      const notice = view?.querySelector<HTMLElement>("[data-demo-checkout]");

      if (notice) {
        notice.hidden = false;
        notice.querySelector<HTMLElement>("[data-demo-checkout-title]")?.focus();
      }
      return;
    }
    void change(async () => {
      checkout.textContent = L.checkingOut;
      try {
        window.location.assign(await cart.checkoutUrl());
      } finally {
        checkout.textContent = L.checkout;
      }
    });
    return;
  }
  const back = target.closest<HTMLElement>("[data-demo-back]");

  if (back) {
    const notice = back.closest<HTMLElement>("[data-demo-checkout]");

    if (notice) notice.hidden = true;
    back.closest("[data-bag-view]")?.querySelector<HTMLElement>("[data-checkout]")?.focus();
  }
});

drawer?.addEventListener("close", () => {
  if (returnTo?.isConnected) returnTo.focus();
  returnTo = null;
});

drawer?.addEventListener("click", (event) => {
  // A click on the backdrop (the dialog itself, outside its panel) closes it.
  if (event.target === drawer) drawer.close();
});

window.addEventListener("storage", (event) => {
  if (event.key === KEY) {
    bag = readBag();
    render();
  }
});

// ── the buy box (product pages) ───────────────────────────────────────────

function setupBuyBox(form: HTMLFormElement): void {
  const variants = JSON.parse(form.querySelector("[data-variants]")?.textContent || "[]") as VariantData[];
  const product = { handle: form.dataset.handle!, title: form.dataset.title! };
  // The price sits just outside the form (so the page's markdown version keeps it); look in the buy column.
  const scope = form.closest<HTMLElement>("[data-buy-scope]") ?? form;
  const priceElement = scope.querySelector<HTMLElement>("[data-price]");
  const stockElement = scope.querySelector<HTMLElement>("[data-stock]");
  const addButton = form.querySelector<HTMLButtonElement>("[data-add]");
  const message = form.querySelector<HTMLElement>("[data-buy-message]");
  const lead = document.querySelector<HTMLImageElement>("[data-lead-image]");
  const optionNames = [...form.querySelectorAll<HTMLFieldSetElement>("[data-option]")].map((fieldset) => fieldset.dataset.option!);

  const chosen = (): Record<string, string> => Object.fromEntries(optionNames.map((name) => [name, (form.querySelector<HTMLInputElement>(`input[name="${CSS.escape(name)}"]:checked`)?.value ?? "")]));
  const match = (options: Record<string, string>) => variants.find((variant) => optionNames.every((name) => variant.options[name] === options[name]));

  function update(fromChoice: boolean): void {
    const options = chosen();
    const variant = match(options);

    // Each choice says whether it can be bought with the others as they stand.
    for (const input of form.querySelectorAll<HTMLInputElement>("[data-option] input")) {
      const candidate = match({ ...options, [input.name]: input.value });
      const soldOut = !candidate || !candidate.available;

      input.closest("label")?.toggleAttribute("data-sold-out", soldOut);
      const note = input.closest("label")?.querySelector<HTMLElement>("[data-choice-note]");

      if (note) note.hidden = !soldOut;
    }
    if (!variant) {
      if (addButton) addButton.disabled = true;
      return;
    }
    if (priceElement) priceElement.textContent = money(variant.price);
    if (stockElement) stockElement.textContent = variant.available ? (variant.few ? L.fewLeft : L.available) : L.unavailable;
    stockElement?.toggleAttribute("data-sold-out", !variant.available);
    if (addButton) {
      addButton.disabled = !variant.available;
      addButton.textContent = variant.available ? L.addToBag : L.soldOut;
    }
    form.dataset.variant = variant.id;
    // The colour changes the picture.
    if (fromChoice && lead && variant.image && lead.getAttribute("src") !== variant.image.src) {
      lead.src = variant.image.src;
      if (variant.image.srcset) lead.srcset = variant.image.srcset;
      else lead.removeAttribute("srcset");
      lead.alt = variant.image.alt;
    }
  }

  form.addEventListener("change", () => update(true));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const variant = variants.find((item) => item.id === form.dataset.variant);

    if (!variant || !variant.available) return;
    // The button stays focusable while it works (a disabled button would drop focus), so focus can come back to it.
    void change(async () => {
      if (addButton) {
        addButton.setAttribute("aria-disabled", "true");
        addButton.textContent = L.adding;
      }
      try {
        await addToBag(variant, product);
        if (message) message.textContent = "";
        openBag(addButton ?? undefined);
      } finally {
        addButton?.removeAttribute("aria-disabled");
        update(false);
      }
    }, message);
  });

  // Live price and stock from the store, asked for once the visitor does something on the page.
  if (config.mode === "store") {
    whenInteracting(async () => {
      try {
        const data = await storefront<{ product: { variants: { nodes: Array<{ id: string; availableForSale: boolean; price: Money; quantityAvailable?: number | null }> } } | null }>(
          `query Live($handle: String!) { product(handle: $handle) { variants(first: 50) { nodes { id availableForSale price { amount currencyCode }${config.publicToken ? " quantityAvailable" : ""} } } } }`,
          { handle: product.handle }
        );

        for (const live of data.product?.variants.nodes ?? []) {
          const variant = variants.find((item) => item.id === live.id);

          if (!variant) continue;
          variant.available = live.availableForSale;
          variant.price = live.price;
          if (typeof live.quantityAvailable === "number") variant.few = live.quantityAvailable > 0 && live.quantityAvailable <= 2;
        }
        update(false);
        form.dataset.live = "true";
      } catch {
        // The prices from the build stay; the cart checks again when something is added.
      }
    });
  }
  addButton?.removeAttribute("data-needs-js");
  if (addButton) addButton.disabled = false;
  update(false);
}

function whenInteracting(run: () => void): void {
  const events = ["pointerdown", "keydown", "touchstart", "focusin"];
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    events.forEach((name) => window.removeEventListener(name, go, true));
    run();
  };

  events.forEach((name) => window.addEventListener(name, go, { capture: true, passive: true }));
}

document.querySelectorAll<HTMLFormElement>("[data-buy]").forEach(setupBuyBox);

// ── the gallery's thumbnails (product pages) ──────────────────────────────

document.querySelectorAll<HTMLElement>("[data-gallery]").forEach((gallery) => {
  const lead = gallery.querySelector<HTMLImageElement>("[data-lead-image]");

  gallery.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-show]");
    const image = button?.querySelector("img");

    if (!button || !lead || !image) return;
    lead.src = button.dataset.show!;
    if (button.dataset.srcset) lead.srcset = button.dataset.srcset;
    else lead.removeAttribute("srcset");
    lead.alt = button.dataset.alt ?? "";
    gallery.querySelectorAll("[data-show]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
  });
});

// ── the shop page's filters ───────────────────────────────────────────────

document.querySelectorAll<HTMLFormElement>("[data-filters]").forEach((form) => {
  const grid = document.querySelector<HTMLElement>("[data-product-grid]");
  const cards = [...document.querySelectorAll<HTMLElement>("[data-product-card]")];
  const results = document.querySelector<HTMLElement>("[data-results]");
  const none = document.querySelector<HTMLElement>("[data-no-results]");

  if (!grid) return;
  form.hidden = false;

  // A phone shows one "Filter and sort" button; the filters open under it.
  const opener = document.querySelector<HTMLButtonElement>("[data-filters-open]");
  const count = opener?.querySelector<HTMLElement>("[data-filters-count]");
  if (opener) {
    opener.hidden = false;
    opener.addEventListener("click", () => {
      const open = opener.getAttribute("aria-expanded") !== "true";
      opener.setAttribute("aria-expanded", String(open));
      form.classList.toggle("is-open", open);
    });
  }

  function apply(): void {
    const data = new FormData(form);
    const wanted = new Map<string, string[]>();

    for (const [key, value] of data.entries()) if (key.startsWith("option:")) wanted.set(key.slice(7), [...(wanted.get(key.slice(7)) ?? []), String(value)]);
    const availableOnly = data.get("available") === "1";
    const sort = String(data.get("sort") ?? "featured");
    let shown = 0;

    for (const card of cards) {
      const options = JSON.parse(card.dataset.options || "{}") as Record<string, string[]>;
      const fits = [...wanted].every(([name, values]) => values.some((value) => options[name]?.includes(value))) && (!availableOnly || card.dataset.available === "true");

      card.parentElement!.hidden = !fits;
      if (fits) shown++;
    }
    const sorted = [...cards].sort((a, b) =>
      sort === "low" ? Number(a.dataset.price) - Number(b.dataset.price) : sort === "high" ? Number(b.dataset.price) - Number(a.dataset.price) : Number(a.dataset.order) - Number(b.dataset.order)
    );

    sorted.forEach((card) => grid!.append(card.parentElement!));
    if (results) results.textContent = shown === 1 ? L.resultsOne : fill(L.results, { count: shown });
    if (none) none.hidden = shown > 0;
    const chosen = [...data.keys()].filter((key) => key.startsWith("option:") || key === "available").length;
    if (count) count.textContent = chosen ? ` (${chosen})` : "";
  }

  form.addEventListener("change", apply);
  form.addEventListener("reset", () => requestAnimationFrame(apply));
  form.addEventListener("submit", (event) => event.preventDefault());
});

// ── search ────────────────────────────────────────────────────────────────

const searchRoot = document.querySelector<HTMLElement>("[data-search]");

if (searchRoot) {
  const form = searchRoot.querySelector<HTMLFormElement>("form")!;
  const input = form.querySelector<HTMLInputElement>("input[name=q]")!;
  const out = searchRoot.querySelector<HTMLElement>("[data-search-results]")!;
  const summary = searchRoot.querySelector<HTMLElement>("[data-search-summary]")!;
  const productTemplate = document.querySelector<HTMLTemplateElement>("[data-search-product]")!;
  const pageTemplate = document.querySelector<HTMLTemplateElement>("[data-search-page]")!;
  const S = JSON.parse(searchRoot.dataset.labels || "{}") as Labels;
  let index: Promise<{ products: Array<{ title: string; url: string; price: string; image: string; text: string }>; pages: Array<{ title: string; url: string; kind: string; text: string }> }> | null = null;

  const run = async () => {
    const query = input.value.trim();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);

    out.replaceChildren();
    if (!words.length) {
      summary.textContent = "";
      return;
    }
    index ??= fetch(searchRoot.dataset.index!).then((response) => response.json());
    const data = await index;
    const hit = (text: string) => words.every((word) => text.toLowerCase().includes(word));
    const products = data.products.filter((item) => hit(`${item.title} ${item.text}`));
    const pages = data.pages.filter((item) => hit(`${item.title} ${item.text}`));
    const total = products.length + pages.length;

    summary.textContent = total === 0 ? fill(S.none, { query }) : total === 1 ? fill(S.resultsOne, { query }) : fill(S.results, { count: total, query });
    for (const [items, template, group] of [
      [products, productTemplate, S.products],
      [pages, pageTemplate, S.stories],
    ] as const) {
      if (!items.length) continue;
      const section = document.createElement("section");
      const heading = document.createElement("h2");
      const list = document.createElement("ul");

      heading.className = "label search__group";
      heading.textContent = group;
      list.className = `search__list search__list--${template === productTemplate ? "products" : "pages"}`;
      list.setAttribute("role", "list");
      for (const item of items) {
        const node = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
        const link = node.querySelector<HTMLAnchorElement>("a")!;

        link.href = item.url;
        node.querySelector("[data-title]")!.textContent = item.title;
        const meta = node.querySelector("[data-meta]");

        if (meta) meta.textContent = "price" in item ? item.price : item.kind;
        const image = node.querySelector<HTMLImageElement>("img");

        if (image && "image" in item && item.image) image.src = item.image;
        list.append(node);
      }
      section.append(heading, list);
      out.append(section);
    }
  };

  input.value = new URL(location.href).searchParams.get("q") ?? "";
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const url = new URL(location.href);

    url.searchParams.set("q", input.value.trim());
    history.replaceState(null, "", url);
    void run();
  });
  void run();
}

// ── consent: the visitor's choice, handed to the store ────────────────────
// Shopify's Customer Privacy API applies a consent choice to Shopify's own
// surfaces (its analytics and checkout). It is recorded only on a visitor's
// interaction, so it is sent when the visitor answers the site's consent
// banner (the site kit's `galley:consent` event), never on page load. For a
// custom storefront the call carries headlessStorefront, the checkout and
// storefront root domains, and the public Storefront token
// (shopify.dev/docs/api/customer-privacy, read 2026-11-23). The script is
// the one Shopify's own headless framework loads (consent-tracking-api v0.2).

const CONSENT_SCRIPT = "https://cdn.shopify.com/shopifycloud/consent-tracking-api/v0.2/consent-tracking-api.js";
let consentScript: Promise<void> | null = null;

document.addEventListener("galley:consent", (event) => {
  if (config.mode !== "store" || !config.checkoutDomain) return;
  const choice = (event as CustomEvent<{ analytics: boolean; marketing: boolean; preferences: boolean }>).detail;

  consentScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");

    script.src = CONSENT_SCRIPT;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("consent script"));
    document.head.append(script);
  });
  consentScript
    .then(() => {
      const privacy = (window as unknown as { Shopify?: { customerPrivacy?: { setTrackingConsent?: (consent: Record<string, unknown>, done: () => void) => void } } }).Shopify?.customerPrivacy;

      privacy?.setTrackingConsent?.(
        {
          analytics: choice.analytics,
          marketing: choice.marketing,
          preferences: choice.preferences,
          // Selling or sharing data follows the marketing choice: no marketing, no sharing.
          sale_of_data: choice.marketing,
          headlessStorefront: true,
          checkoutRootDomain: config.checkoutDomain,
          storefrontRootDomain: location.hostname.replace(/^www\./, ""),
          storefrontAccessToken: config.publicToken ?? undefined,
        },
        () => undefined
      );
    })
    .catch(() => undefined);
});

render();
