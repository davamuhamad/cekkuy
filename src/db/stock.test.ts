import assert from "node:assert/strict";
import test from "node:test";
import { hasUnreservedStock, parseStockMovementInput } from "./stock";
import {
  stockCountDifference,
  stockCountMilliUnits,
  stockCountQuantitySchema,
} from "./stock-count";

const warehouseId = "a3fdd394-ff01-450a-875b-7af9f4109d49";
const variantId = "b1d0a6e2-a75d-4c80-a89c-d3d8e66c4de0";
const storageId = "f3306f4a-0f47-4a2d-b736-5a65709eb84e";
const quarantineId = "2db8a2f5-cbc6-42aa-89ca-1a25b810e590";

test("parses a positive fractional stock movement", () => {
  const input = parseStockMovementInput({
    warehouseId,
    variantId,
    type: "receipt",
    quantity: "1.125",
    toLocationId: quarantineId,
  });

  assert.equal(input.quantity, "1.125");
  assert.equal(input.type, "receipt");
});

test("rejects zero, negative, and excessive precision quantities", () => {
  for (const quantity of ["0", "-1", "1.0001", "100000000000"]) {
    assert.throws(() =>
      parseStockMovementInput({
        warehouseId,
        variantId,
        type: "adjust",
        quantity,
        toLocationId: storageId,
        reason: "Saldo awal",
      }),
    );
  }
});

test("requires a location and rejects identical source and destination", () => {
  assert.throws(() =>
    parseStockMovementInput({
      warehouseId,
      variantId,
      type: "adjust",
      quantity: "1",
    }),
  );
  assert.throws(() =>
    parseStockMovementInput({
      warehouseId,
      variantId,
      type: "transfer",
      quantity: "1",
      fromLocationId: storageId,
      toLocationId: storageId,
    }),
  );
});

test("allows adjustments only from unreserved stock", () => {
  assert.equal(hasUnreservedStock("5", "1.250", "3.750"), true);
  assert.equal(hasUnreservedStock("5", "1.251", "3.750"), false);
  assert.equal(hasUnreservedStock("1.250", "1.250", "0.001"), false);
});

test("accepts zero and fractional stock count quantities", () => {
  assert.equal(stockCountQuantitySchema.safeParse("0").success, true);
  assert.equal(stockCountQuantitySchema.safeParse("12.125").success, true);
  assert.equal(stockCountQuantitySchema.safeParse("-1").success, false);
  assert.equal(stockCountQuantitySchema.safeParse("1.0001").success, false);
  assert.equal(stockCountMilliUnits("12.125"), 12125);
});

test("calculates stock count variance with exact milli-unit precision", () => {
  assert.equal(stockCountDifference("2.125", "2.500"), 375);
  assert.equal(stockCountDifference("2.500", "2.125"), -375);
  assert.equal(stockCountDifference("0", "0.001"), 1);
});
