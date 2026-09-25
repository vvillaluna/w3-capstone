/**
 * Tests for GET /api/orders/active.
 *
 * Per SPEC.md: this route must require the "orders:read:all" permission
 * (admin/manager only), not the plain "orders:read" permission that
 * customers also hold. These tests are written against the target
 * behavior and are expected to fail until orders:read:all exists and the
 * route is switched over to it.
 */

jest.mock("../../src/config/database", () => ({
  query: jest.fn(),
}));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const db = require("../../src/config/database");
const ordersRouter = require("../../src/routes/orders");

const SECRET = process.env.JWT_SECRET || "fallback-secret-do-not-use";

const USERS_BY_ID = {
  1: { id: 1, email: "customer@test.com", name: "Cust", role: "customer", customer_tier: "bronze", status: "active" },
  2: { id: 2, email: "admin@test.com", name: "Admin", role: "admin", customer_tier: null, status: "active" },
  3: { id: 3, email: "manager@test.com", name: "Manager", role: "manager", customer_tier: null, status: "active" },
};

const MOCK_ORDERS = [
  { id: 100, user_id: 1, status: "pending", total: "9.99" },
];

function tokenFor(userId) {
  return jwt.sign({ id: userId }, SECRET);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/orders", ordersRouter);
  return app;
}

describe("GET /api/orders/active", () => {
  beforeEach(() => {
    db.query.mockImplementation((sql, params) => {
      if (sql.includes("FROM users WHERE id = $1")) {
        const user = USERS_BY_ID[params[0]];
        return Promise.resolve({ rows: user ? [user] : [] });
      }
      if (sql.includes("FROM users ORDER BY created_at DESC")) {
        return Promise.resolve({
          rows: Object.values(USERS_BY_ID).filter((u) => u.status === "active"),
        });
      }
      if (sql.includes("FROM orders")) {
        return Promise.resolve({ rows: MOCK_ORDERS });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  afterEach(() => jest.clearAllMocks());

  it("should return 403 for a customer", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/orders/active")
      .set("Authorization", `Bearer ${tokenFor(1)}`);

    expect(res.status).toBe(403);
  });

  it("should return 200 for an admin", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/orders/active")
      .set("Authorization", `Bearer ${tokenFor(2)}`);

    expect(res.status).toBe(200);
  });

  it("should return 200 for a manager", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/orders/active")
      .set("Authorization", `Bearer ${tokenFor(3)}`);

    expect(res.status).toBe(200);
  });
});
