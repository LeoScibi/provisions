# Provisions London — Stock/Ops Tool

This is **provisionslondon**, a stock/products/orders tool for Provisions
UK. It is a separate project from `carisma-catering` — do not mix data
models, sheet schemas, or conventions between the two.

- **Repo:** `LeoScibi/provisions` on GitHub (migrated from
  `Plato-uk/provisionslondon`, still available as the `plato` remote). Branch
  `main` only.
- **Architecture:** static site, no server/build step. Every page talks
  directly to a single Google Sheet via the Sheets API v4, authenticated
  client-side with Google OAuth (`js/config.js`, `js/sheets.js`). The OAuth
  Client ID and Spreadsheet ID are hard-coded in `APP_CONFIG` in
  `js/config.js` — there is no per-browser config; signed-out visitors land
  on the Dashboard's full-screen sign-in card, and every other page
  redirects there without a session. OAuth scope
  is `spreadsheets` plus `drive.file` (restricted — the app only ever sees
  files it creates itself) for the Products photo upload feature
  (`js/drive.js`), plus `userinfo.email`/`userinfo.profile` (non-sensitive)
  so the signed-in user's name/email can be shown next to the "Dashboard"
  heading on `index.html` (also the logout control — see `initUserBadge()`
  in `js/config.js`, called on every page but a no-op where the badge
  markup isn't present).
- **App chrome lives in `js/shell.js`**, included on every page: it builds
  the top bar nav (pages only carry an empty `<header id="topbar">`; add a
  new page to its `NAV` list), the account menu (Setup and Sign out live
  there), toasts (`showToast`), and all loading feedback — page loader,
  top-bar progress bar, and a spinner on the clicked button — driven by the
  `google-request` events that `googleFetch` fires. It also opens orders
  and POs in place: any link to `orders.html?open=ID` or
  `purchase-orders.html?open=ID` loads that page's dialog over the current
  page in an `?embed=1` iframe instead of navigating (set
  `window.onRecordDialogClosed` to refresh the page afterwards).
- **Every Google API call goes through `googleFetch` (`js/sheets.js`)**, never
  a bare `fetch`. It sends the freshest stored token and, when the session
  has expired (no token or a 401), waits for the Reconnect banner in
  `js/shell.js` and then resends the same request — so a save made after
  the token's hour is up completes once the user reconnects, with the page
  and any typed input untouched. New Drive/Sheets helpers must use it too.
- **Product photos and order hover cards live in `js/product-ui.js`**: use
  `productCell()`/`productThumb()` wherever a product is listed (call
  `registerProducts()` after loading Products so cut portions borrow their
  parent wheel's photo), and `attachOrderHoverCard()` for any list of
  orders or POs.
- Generic CRUD table framework in `js/crud-page.js` — every flat list page
  (Products, Suppliers, Customers) configures one `initCrudTable()` call
  instead of hand-rolling fetch/append/update/delete logic. Read the
  comment block at the top of that file before adding a new page or field
  type. Purchase Orders and Orders are both bespoke, hand-rolled JS
  (`purchase-orders.html`, `orders.html`) rather than the generic
  framework — their line-item UX (and, for Orders, per-line stock
  allocation) doesn't fit the generic single-flat-table model. Orders,
  OrderLines and Allocations have no page of their own any more: creating
  an order (the "+ Add order" wizard), viewing it, changing its STATUS,
  adding/removing lines, allocating stock to each line (FEFO lot picker,
  writes straight to Allocations), and deleting the order outright all
  happen inside one dialog on `orders.html`. Removing a line or the whole
  order cascades: it also deletes that line's/order's Allocations (and
  OrderLines, for a whole-order delete) rather than leaving them dangling —
  see `buildDeleteRowRequests()` for the row-deletion-ordering gotcha this
  relies on (delete highest row index first within a sheet, since deleting
  a row shifts every later row's index down).

## Sheet schema (see `setup.html`'s `REQUIRED_TABS` for the source of truth)
- **Products** — item master, one row per SKU keyed by `Product code`
  (natural key, not an auto-id). Mirrors the Xero-linked schema: cost/landed
  cost, cut-to-order fields, Xero item/account codes.
- **ProductGroups** — one row per *product* (a card on `products.html`),
  the thing a photo, spec sheet and training notes belong to; the
  **Products** tab is really its SKUs. A SKU belongs to a product via
  Products.`Group ID`: each linked SKU is a Wholesale SKU (e.g. a whole wheel
  plus its portions), except the codes in the product's `Shop SKU` /
  `Selfridges SKU`, which fill those two channels — one SKU each, either may
  be empty. Different sizes (210g / 3kg) are separate products. A product's
  photo wins over its SKUs' own everywhere (`productPhoto()` in
  `js/product-ui.js`). "Group SKUs into products" on the Products page is the
  re-runnable grouping. Was the cheese-only "Cheeses" tab / `Cheese ID`
  column; Setup renames those in place (`TAB_RENAMES` / `HEADER_RENAMES`).
- **Suppliers**, **Customers**, **TransportCompanies** — reference lists.
- **PurchaseOrders** / **PurchaseOrderLines** — an order placed with one
  supplier (lines restricted to that supplier's products), with an expected
  delivery date range. Status: Ordered → Delivered/Cancelled — delivery is
  one-time, not partial. "Mark as delivered" (in `purchase-orders.html`) is
  the only normal path onto the Deliveries tab: it appends the resulting
  rows there and fills in each line's received qty/lot/best-before.
- **Stock on hand** is never stored: it's each Deliveries batch's received
  qty minus its Allocations. `computeStockByProduct()` in `js/stock-calc.js`
  is the shared version (Products' cards use it); `computeStockPosition()`
  next to it splits that into in stock / allocated (to orders not yet
  dispatched) / free, plus what's arriving on open POs, for the order and
  PO product pickers; stock.html, index.html,
  purchase-orders.html and orders.html still carry their own copies of the
  same maths.
- **SupplierProducts** — which suppliers sell which products (one row per
  supplier + product, with that supplier's own product code and cost), so a
  product can come from several suppliers. A product's `Default supplier`
  always counts as one of its suppliers even without a row here — use
  `productsForSupplier()` in `js/supplier-products.js` rather than filtering
  on `Default supplier`. Edited from a supplier's record (its Products tab,
  via `initCrudTable`'s `detailSection`); purchase orders offer everything a
  supplier is linked to.
- **Deliveries** — goods-in, linked to Products by `PRODUCT CODE` and
  tracked by batch/lot number + best-before date. `PO ID` traces a row back
  to the purchase order it was received against, when there is one.
- **Ordering cut cheese:** in the order product picker a whole and the
  portions "Cut from" it are one row (`cutFamilies()` in `orders.html`),
  stepped in the smallest piece; on save the count is split into real cuts,
  largest first (3 × 1/16 → ⅛ + 1/16, 16 × 1/16 → the whole), each its own
  OrderLines row in pieces (`expandDraftLines()`).
- **Orders** / **OrderLines** / **Allocations** — order header (including
  `PLACED BY`, appended to Orders' headers), order lines, and stock
  allocated to each line. Stock is allocated when an order is placed (and when lines
  are added): `autoAllocate()` in `orders.html` takes each non-cut line FEFO
  from free stock, skipping lots past their best-before on the delivery
  date, and the order goes straight to Allocated when nothing is short — so
  free stock always reflects every undispatched order. Whatever the shelf
  can't cover is **reserved on open POs** due before the delivery date: an
  Allocations row with `PO LINE ID` set and no lot ("Reserved · PO295" on the
  line, "Awaiting PO295" on slips). Reservations count as allocated but not as
  shelf stock (`computeStockPosition` shows only unreserved incoming). At
  goods-in `resolveReservations()` in `purchase-orders.html` turns them into
  real lot allocations, first placed first served; what a short delivery or a
  cancelled PO can't cover is released and the order drops back to New. New Order picks a
  delivery *week*; the date saved is the customer's usual day in it
  (Customers' Delivery day, else Wed out of London / Thu London), and picking
  another day adds "Requested delivery: …" to the notes. In the order dialog each line shows its free stock;
  **Allocate** opens a pop-up of lots (FEFO-prefilled), **Allocate all**
  fills every line FEFO from a shared pool, and **Replace** swaps a line's
  product: the line keeps its original code in OrderLines.`REPLACES` (shown as
  "replaces …" on packing slips and delivery notes), its old allocations are
  released and the new product is allocated FEFO. Cut-to-order lines take no
  allocation and don't hold an order back from Allocated; replacements are
  never cut products, so the cutting list doesn't change. All three are managed entirely from
  `orders.html`'s order-view dialog — see the bullet above.
- **StockTakes** / **StockTakeLines** — a physical count session
  (`stock-take.html`). Starting one snapshots every Active product's
  computed on-hand qty into StockTakeLines (`SYSTEM QTY`) with a blank
  `COUNTED QTY` — blank vs filled (not a status flag) is what "next
  uncounted item" walks through, so a genuine zero count must be saved as
  `"0"`, never left blank.

**Important convention:** when adding a column to an existing tab, always
append it to the END of that tab's `headers` array in `setup.html` — never
insert in the middle. Setup only ever rewrites row 1 if the stored header is
shorter than required; inserting a column midway silently relabels an
existing column and misaligns every row's data under the new header.

## Pages
```
index.html          Dashboard: config, sign-in, nav
setup.html            Auto-creates required tabs + headers — run first on a new sheet
products.html           Products (one card each, SKUs by channel inside) / SKUs views
suppliers.html            Supplier list
customers.html              Customer list
transport.html               Hauliers bringing goods in, with contacts
purchase-orders.html           Place/receive supplier orders
stock.html                       Stock view
stock-take.html                    Physical count vs. system quantity
orders.html                          Place orders, allocate stock
lists.html                             Cutting list, packing slips (truck order, box
                                       counts), delivery notes, box labels
reports.html                             6-month sales / purchase trends by customer,
                                         supplier and product (computed, nothing stored)
test-data.html                           Generates / removes 6 months of TEST-tagged
                                         orders, POs, deliveries and allocations
```

Test data: every row `test-data.html` writes carries `TEST` in its tab's
NOTES (PurchaseOrderLines, which has none, via its TEST purchase order), so
"Remove test data" deletes exactly those rows. Don't add NOTES = TEST to
real data.

## Working here
- Always confirm you're in `~/provisionslondon` (not a Downloads copy or
  the loose `provisions-*.html` prototype files in `~/Downloads`) and on a
  clean, up-to-date `main` before editing.
- Setup is safe to re-run: it only writes a tab's header row if that tab's
  stored header is shorter than required — never overwrites existing data.
