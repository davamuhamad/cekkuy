ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_minimum_stock_nonnegative" CHECK ("product_variants"."minimum_stock" >= 0);--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_quantity_positive" CHECK ("sales_order_items"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_price_nonnegative" CHECK ("sales_order_items"."unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_quantity_nonnegative" CHECK ("stock_balances"."quantity" >= 0);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_positive" CHECK ("stock_movements"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_has_location" CHECK ("stock_movements"."from_location_id" IS NOT NULL OR "stock_movements"."to_location_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_different_locations" CHECK ("stock_movements"."from_location_id" IS NULL OR "stock_movements"."to_location_id" IS NULL OR "stock_movements"."from_location_id" <> "stock_movements"."to_location_id");--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_quantity_positive" CHECK ("stock_reservations"."quantity" > 0);--> statement-breakpoint
CREATE FUNCTION prevent_stock_movement_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'stock_movements is append-only; create a compensating movement instead.';
END;
$$;--> statement-breakpoint
CREATE TRIGGER stock_movements_append_only
BEFORE UPDATE OR DELETE ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_mutation();