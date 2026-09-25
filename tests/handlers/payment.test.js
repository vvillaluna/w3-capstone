/**
 * Payment handler tests.
 *
 * Status: PLACEHOLDER for the POST / success/failure flow — only verifies
 * the module loads.
 * Needs: tests for success flow, card declines, timeouts, DB failures.
 *
 * GET /:orderId below is written against SPEC.md's target ownership check
 * (same as POST /: order.user_id === req.user.id, or admin) and is expected
 * to fail until that check is implemented.
 */

jest.mock("../../src/config/database", () => ({
  query: jest.fn(),
}));
jest.mock("../../src/models/Order");
jest.mock("../../src/models/Payment");

describe("payment handler", () => {
  it("should be a valid express router", () => {
    const paymentRouter = require("../../src/handlers/payment");
    expect(paymentRouter).toBeDefined();
    expect(paymentRouter.stack).toBeDefined(); // Express router has a stack
  });

  // TODO: add integration tests with mocked Stripe
  // TODO: test card decline error handling
  // TODO: test timeout scenarios
  // TODO: test DB failure after successful charge
});

describe("GET /api/payments/:orderId", () => {
  const express = require("express");
  const request = require("supertest");
  const jwt = require("jsonwebtoken");
  const db = require("../../src/config/database");
  const Order = require("../../src/models/Order");
  const Payment = require("../../src/models/Payment");
  const paymentRouter = require("../../src/handlers/payment");

  const SECRET = process.env.JWT_SECRET || "fallback-secret-do-not-use";

  const USERS_BY_ID = {
    1: { id: 1, email: "owner@test.com", name: "Owner", role: "customer", customer_tier: "bronze", status: "active" },
    2: { id: 2, email: "admin@test.com", name: "Admin", role: "admin", customer_tier: null, status: "active" },
    3: { id: 3, email: "manager@test.com", name: "Manager", role: "manager", customer_tier: null, status: "active" },
    4: { id: 4, email: "other@test.com", name: "Other", role: "customer", customer_tier: "bronze", status: "active" },
  };

  function tokenFor(userId) {
    return jwt.sign({ id: userId }, SECRET);
  }

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/payments", paymentRouter);
    return app;
  }

  beforeEach(() => {
    db.query.mockImplementation((sql, params) => {
      if (sql.includes("FROM users WHERE id = $1")) {
        const user = USERS_BY_ID[params[0]];
        return Promise.resolve({ rows: user ? [user] : [] });
      }
      return Promise.resolve({ rows: [] });
    });
    Payment.findByOrderId.mockResolvedValue([
      { id: 500, order_id: 100, amount: "9.99", status: "succeeded" },
    ]);
  });

  afterEach(() => jest.clearAllMocks());

  it("should return 200 when the requester owns the order", async () => {
    Order.findById.mockResolvedValue({ id: 100, user_id: 1, status: "completed", total: "9.99" });

    const app = buildApp();
    const res = await request(app)
      .get("/api/payments/100")
      .set("Authorization", `Bearer ${tokenFor(1)}`);

    expect(res.status).toBe(200);
  });

  it("should return 200 for admin regardless of ownership", async () => {
    Order.findById.mockResolvedValue({ id: 100, user_id: 1, status: "completed", total: "9.99" });

    const app = buildApp();
    const res = await request(app)
      .get("/api/payments/100")
      .set("Authorization", `Bearer ${tokenFor(2)}`);

    expect(res.status).toBe(200);
  });

  it("should return 403 for a non-owning, non-admin requester (customer)", async () => {
    Order.findById.mockResolvedValue({ id: 100, user_id: 1, status: "completed", total: "9.99" });

    const app = buildApp();
    const res = await request(app)
      .get("/api/payments/100")
      .set("Authorization", `Bearer ${tokenFor(4)}`);

    expect(res.status).toBe(403);
  });

  it("should return 403 for a non-owning manager", async () => {
    Order.findById.mockResolvedValue({ id: 100, user_id: 1, status: "completed", total: "9.99" });

    const app = buildApp();
    const res = await request(app)
      .get("/api/payments/100")
      .set("Authorization", `Bearer ${tokenFor(3)}`);

    expect(res.status).toBe(403);
  });

  it("should return 404 when the order does not exist", async () => {
    Order.findById.mockResolvedValue(null);

    const app = buildApp();
    const res = await request(app)
      .get("/api/payments/999")
      .set("Authorization", `Bearer ${tokenFor(1)}`);

    expect(res.status).toBe(404);
  });
});
