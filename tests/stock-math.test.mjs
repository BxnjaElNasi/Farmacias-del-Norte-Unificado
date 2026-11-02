import test from "node:test";
import assert from "node:assert/strict";
import { allocateLotsFefo } from "../lib/stock-math.mjs";

test("allocates dated lots in earliest-expiry order before lots without an expiry", () => {
  const result = allocateLotsFefo([
    { id: "no-expiry", quantity: 5, expiresOn: null, createdAt: "2025-01-01" },
    { id: "later", quantity: 4, expiresOn: "2027-01-01", createdAt: "2025-01-01" },
    { id: "sooner", quantity: 3, expiresOn: "2026-03-01", createdAt: "2025-01-01" },
  ], 6);

  assert.deepEqual(result, {
    allocations: [
      { lotId: "sooner", quantity: 3 },
      { lotId: "later", quantity: 3 },
    ],
    remaining: 0,
  });
});

test("returns the unfilled quantity when the lots do not have enough stock", () => {
  const lots = [{ id: "lot-a", quantity: 2, expiresOn: "2026-05-01" }];
  const result = allocateLotsFefo(lots, 5);

  assert.deepEqual(result, {
    allocations: [{ lotId: "lot-a", quantity: 2 }],
    remaining: 3,
  });
  assert.equal(lots[0].quantity, 2);
});

test("ignores empty lots and breaks equal-expiry ties by receipt time", () => {
  const result = allocateLotsFefo([
    { id: "later-received", quantity: 3, expiresOn: "2026-04-01", createdAt: "2026-02-02" },
    { id: "empty", quantity: 0, expiresOn: "2026-01-01", createdAt: "2025-01-01" },
    { id: "first-received", quantity: 2, expiresOn: "2026-04-01", createdAt: "2026-02-01" },
  ], 1);

  assert.deepEqual(result, {
    allocations: [{ lotId: "first-received", quantity: 1 }],
    remaining: 0,
  });
});
