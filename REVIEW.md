# REVIEW: Order/Payment Authorization Hardening

## SPECS pass over the final diff

- **Security** parameterized `pg` queries throughout (no new raw SQL
  introduced). Every changed route stays gated by `authenticate(...)`;
  `GET /api/orders/active` and `GET /api/orders/history` now require
  `orders:read:all` (admin/manager only) instead of `orders:read` (which
  customers also held). `GET /api/payments/:orderId` now enforces
  ownership (`order.user_id === req.user.id`, or admin) before returning
  payment records, previously any authenticated user with `payments:read`
  (including customers) could read any order's payments by ID. See
  Security section below for the specific attack surface closed.
- **Patterns** new permission (`orders:read:all`) added to
  `ROLE_PERMISSIONS` in `src/middleware/auth.js`, matching the codebase's
  existing permission-based gating rather than introducing inline role
  checks. `payment.js`'s ownership check is the one deliberate exception
  justified in SPEC.md's Resolution section mirroring `POST /api/payments`'s
  pre-existing pattern rather than inventing something new.
- **Edge cases** 401 (no/bad token), 403 (wrong permission / non-owner),
  404 (missing order) all covered; the ownership boundary (self vs. other
  user) is tested for both the orders and payments changes.
- **Context** diff matches SPEC.md's file list exactly: `auth.js`,
  `orders.js`, `orderHistory.js`, `payment.js`. No unrelated files touched.
- **Simplicity** smallest diff that does the job: 1 permission addition,
  2 middleware swaps, 1 added ownership check. No refactors, no
  speculative abstraction.

## Security

What was broken: three endpoints exposed cross-user data because
authorization was checked at the wrong granularity.

1. `orders:read` was held by `customer`, but `/api/orders/active` and
   `/api/orders/history` return every user's orders, not just the
   requester's, an unfiltered aggregate view behind a permission meant
   for self-scoped access. Any customer JWT could enumerate other
   customers' order data.
2. `GET /api/payments/:orderId` had no authorization check beyond holding
   `payments:read` no verification the requester owned the order. Any
   customer could walk order IDs and read other customers' payment
   records (amounts, Stripe payment IDs, status).

New attack surface introduced: none identified. The fix is strictly
additive restriction no new endpoints, no new data exposed, no new
trust boundary crossed. The one behavior change worth flagging: `manager`
previously had blanket payment-read access via `payments:read` and now
needs ownership or admin a deliberate tightening, recorded in SPEC.md,
not a regression.

Inputs: no new user-controlled input introduced; `:orderId` was
already a route param consumed by the existing `Payment.findByOrderId`
call.

Authorization model: unchanged in shape, still permission-based via
`ROLE_PERMISSIONS`, with one instance-level ownership check that mirrors
an existing, already-reviewed pattern (`POST /api/payments`).