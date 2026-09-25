# SPEC: Order/Payment Authorization Hardening

## Problem

Two endpoints leak data across users because the permission gating them
(`orders:read`) is granted to the `customer` role, not just `admin`/`manager`:

- `GET /api/orders/active` (`src/routes/orders.js:42`) — returns orders from
  *all* currently-active users, unfiltered by requester. Any authenticated
  customer can currently call this and see other customers' orders.
- `GET /api/orders/history` (`src/handlers/orderHistory.js:16`) — returns
  every order in the system enriched with the owning user's name/email. Same
  problem: any customer token currently passes `authenticate("orders:read")`.

Separately, `GET /api/payments/:orderId` (`src/handlers/payment.js:90`) does
**no** ownership check at all — it only requires the `payments:read`
permission (held by admin, manager, *and* customer) and then returns every
payment for that order ID regardless of who owns the order. `POST
/api/payments` (`src/handlers/payment.js:36`) already does this correctly:

```js
if (order.user_id !== req.user.id && req.user.role !== "admin") {
  return res.status(403).json({ error: "Not your order" });
}
```

`GET /:orderId` needs the same check.

## Design decision: new `orders:read:all` permission (not a hardcoded role check)

The codebase's authorization model is permission-based throughout
(`authenticate(requiredPermission)` + the `ROLE_PERMISSIONS` matrix in
`src/middleware/auth.js`). Every route-level gate today is a permission
name, not a role name — inline `req.user.role === "customer"` checks only
ever appear *inside* a handler for ownership scoping, after a coarser
permission has already let the request through.

I'm adding `orders:read:all` to `ROLE_PERMISSIONS.admin` and
`ROLE_PERMISSIONS.manager` (not `customer`/`guest`), and gating the two
routes on it, rather than writing `authenticate("orders:read")` +
`if (req.user.role !== "admin" && req.user.role !== "manager")` in the route
files. Reasons:

- **Consistency** — matches every other route in the file; no new pattern
  introduced.
- **Testability** — it's covered for free by the existing `hasPermission()` /
  `getPermissionsForRole()` unit-test pattern already in
  `tests/middleware/auth.test.js`, no need to test route-level role-string
  comparisons separately.
- **Extensibility** — if a future role (e.g. a read-only "auditor") needs
  this view without full manager permissions, it's a one-line addition to
  `ROLE_PERMISSIONS`, not a route-file edit.

## Files to change, in order

1. **`src/middleware/auth.js`**
   Add `"orders:read:all"` to the `admin` and `manager` arrays in
   `ROLE_PERMISSIONS` (not `customer`, not `guest`). No other changes —
   `authenticate()`'s permission-check logic already works generically once
   the permission exists in the matrix.

2. **`src/routes/orders.js`**
   Change the `GET /active` route's middleware from
   `authenticate("orders:read")` to `authenticate("orders:read:all")`.
   No other route in this file changes — `GET /`, `GET /:id`, `POST /`,
   `PATCH /:id` keep `orders:read`/`orders:write` since they already
   self-scope to the requester for customers.

3. **`src/handlers/orderHistory.js`**
   Change the `GET /` route's middleware from `authenticate("orders:read")`
   to `authenticate("orders:read:all")`.

4. **`src/handlers/payment.js`**
   In `GET /:orderId`, before calling `Payment.findByOrderId`, add the same
   lookup-and-check `POST /` already does:
   - `const order = await Order.findById(req.params.orderId);`
   - 404 `{ error: "Order not found" }` if no order.
   - 403 `{ error: "Not your order" }` if `order.user_id !== req.user.id &&
     req.user.role !== "admin"`.
   `Order` is already imported in this file. `manager` is deliberately
   **not** given a bypass here, mirroring `POST /` exactly as requested.

   **Callout for review:** today, `manager` (via `payments:read`) can view
   any order's payments. After this change, a manager who doesn't own the
   order gets 403 too — only `admin` bypasses ownership, same as `POST /`.
   If managers should retain read access to all payments, that needs a
   separate `payments:read:all`-style permission (analogous to the orders
   change above) rather than reusing the POST check verbatim. Flagging
   before I touch tests since it's a behavior change beyond what was
   explicitly asked, not just a bug fix.

## Definition of Done (testable)

- [ ] `getPermissionsForRole("admin")` and `getPermissionsForRole("manager")`
      include `"orders:read:all"`.
- [ ] `getPermissionsForRole("customer")` and `getPermissionsForRole("guest")`
      do **not** include `"orders:read:all"`.
- [ ] `GET /api/orders/active` → 403 for a valid `customer` token, 200 for
      `admin`/`manager` tokens.
- [ ] `GET /api/orders/history` → 403 for a valid `customer` token, 200 for
      `admin`/`manager` tokens.
- [ ] `GET /api/payments/:orderId` →
  - 200 when the requester is the order's owner (`order.user_id ===
    req.user.id`), any role.
  - 200 for `admin` regardless of ownership.
  - 403 when the requester is a non-owning, non-admin user (including
    `manager`, per the callout above — confirm before implementing).
  - 404 when the order doesn't exist.
- [ ] No change to `GET /api/orders`, `GET /api/orders/:id`, `POST
      /api/orders`, `PATCH /api/orders/:id`, or `POST /api/payments`
      behavior.
- [ ] `npm test` passes with no regressions in existing suites
      (`tests/middleware/auth.test.js`, `tests/handlers/payment.test.js`,
      etc.).

## Test plan (for the follow-up pass, not written yet)

- Extend `tests/middleware/auth.test.js` with `getPermissionsForRole`
  assertions for `orders:read:all`.
- New `tests/routes/orders.test.js` covering the `/active` 403/200 cases
  (mock `db`, `Order`, `userService.getActiveUsers`).
- New `tests/handlers/orderHistory.test.js` covering the same 403/200 cases
  (mock `db`).
- Extend `tests/handlers/payment.test.js` (currently a placeholder) with
  the ownership-check matrix for `GET /:orderId` (mock `Order.findById`,
  `Payment.findByOrderId`).

**Exact command:** `npm test`

## Open question before implementation

Confirm the manager/payments callout above — proceed with the literal
"same check as POST" (manager loses blanket payment read access), or would
you rather I introduce `payments:read:all` for admin+manager and keep the
ownership check for `customer` only? Either is a small change to step 4;
I want the call before touching tests.

## Resolution

Confirmed: proceeding with the literal "same check as POST" — manager loses
blanket payment-read access (only admin bypasses ownership). No new
`payments:read:all` permission introduced.

This means `payment.js` intentionally keeps an inline `req.user.role`
check rather than a `ROLE_PERMISSIONS` entry, unlike the `orders:read:all`
approach used for orders.js/orderHistory.js. The difference is deliberate,
not an inconsistency: the orders fix is a route-level access class (a
role either can or can't see the aggregate view, decidable from the role
alone) — a permission fits it naturally. The payments fix is a per-instance
ownership check (`order.user_id === req.user.id`) that depends on request
data, not just the role, so it can't be expressed as a static
`ROLE_PERMISSIONS` entry the same way. It mirrors `POST /api/payments`,
which already used this exact inline check before this change.