import { z } from "zod";

export const stockCountQuantitySchema = z
  .string()
  .regex(/^\d{1,11}(?:\.\d{1,3})?$/);

export function stockCountMilliUnits(quantity: string) {
  const [whole, fraction = ""] = quantity.split(".");
  return Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
}

export function stockCountDifference(expected: string, counted: string) {
  return stockCountMilliUnits(counted) - stockCountMilliUnits(expected);
}

export function formatStockCountQuantity(milliUnits: number) {
  return (milliUnits / 1000).toFixed(3);
}
