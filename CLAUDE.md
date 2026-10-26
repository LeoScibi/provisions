# Provisions London — Stock/Ops Tool

This is **provisionslondon**, a stock/products/orders tool for Provisions
UK. It is a separate project from `carisma-catering` — do not mix data
models, sheet schemas, or conventions between the two.

- **Repo:** `LeoScibi/provisions` on GitHub (migrated from
  `Plato-uk/provisionslondon`, still available as the `plato` remote). Branch
  `main` only.
- **Architecture:** static site, no server/build step. Every page talks
  directly to a single Google Sheet via the Sheets API v4, authenticated
  client-side with Google OAuth (`js/config.js`, `js/sheets.js`). OAuth scope
  is `spreadsheets` plus `drive.file` (restricted — the app only ever sees
  files it creates itself) for the Products photo upload feature
  (`js/drive.js`), plus `userinfo.email`/`userinfo.profile` (non-sensitive)
  so the signed-in user's name/email can be shown next to the "Dashboard"
  heading on `index.html` (also the logout control — see `initUserBadge()`
  in `js/config.js`, called on every page but a no-op where the badge
  markup isn't present).
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
- **Suppliers**, **Customers** — reference lists.
- **PurchaseOrders** / **PurchaseOrderLines** — an order placed with one
  supplier (lines restricted to that supplier's products), with an expected
  delivery date range. Status: Ordered → Delivered/Cancelled — delivery is
  one-time, not partial. "Mark as delivered" (in `purchase-orders.html`) is
  the only normal path onto the Deliveries tab: it appends the resulting
  rows there and fills in each line's received qty/lot/best-before.
- **Deliveries** — goods-in, linked to Products by `PRODUCT CODE` and
  tracked by batch/lot number + best-before date. `PO ID` traces a row back
  to the purchase order it was received against, when there is one.
- **Orders** / **OrderLines** / **Allocations** — order header (including
  `PLACED BY`, appended to Orders' headers), order lines, and stock
  allocated to each line. All three are managed entirely from
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
products.html           Item master
suppliers.html            Supplier list
customers.html              Customer list
purchase-orders.html           Place/receive supplier orders
stock.html                       Stock view
stock-take.html                    Physical count vs. system quantity
orders.html                          Place orders, allocate stock
lists.html                             Picking/cutting/packing lists
```

## Working here
- Always confirm you're in `~/provisionslondon` (not a Downloads copy or
  the loose `provisions-*.html` prototype files in `~/Downloads`) and on a
  clean, up-to-date `main` before editing.
- Setup is safe to re-run: it only writes a tab's header row if that tab's
  stored header is shorter than required — never overwrites existing data.
