import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const roleEnum = pgEnum("user_role", [
  "admin",
  "warehouse_manager",
  "warehouse_staff",
  "qc",
  "purchasing",
  "online_ops",
  "management",
  "reseller",
]);
export const locationTypeEnum = pgEnum("location_type", [
  "storage",
  "quarantine",
  "return",
  "reject",
]);
export const movementTypeEnum = pgEnum("movement_type", [
  "receipt",
  "qc_release",
  "qc_fail",
  "putaway",
  "transfer",
  "reserve",
  "pick",
  "ship",
  "return_in",
  "adjust",
  "scrap",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "awaiting_pick",
  "picking",
  "packing",
  "qc_pending",
  "ready_to_ship",
  "handed_over",
  "delivered",
  "failed",
  "returned",
  "cancelled",
]);
export const receiptStatusEnum = pgEnum("receipt_status", [
  "qc_pending",
  "completed",
]);
export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "draft",
  "sent",
  "partial",
  "completed",
  "cancelled",
]);
export const packingTypeEnum = pgEnum("packing_type", [
  "plastic",
  "bubble_wrap",
  "cardboard",
  "other",
]);
export const deliveryOutcomeEnum = pgEnum("delivery_outcome", [
  "success",
  "failed",
  "returned",
  "cancelled",
]);
export const codStatusEnum = pgEnum("cod_status", [
  "pending",
  "paid",
  "discrepancy",
  "no_collection",
]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
]);
export const receiptQcStatusEnum = pgEnum("receipt_qc_status", [
  "pending",
  "passed",
  "failed",
]);
export const qcResultEnum = pgEnum("qc_result", ["passed", "failed"]);
export const stockCountStatusEnum = pgEnum("stock_count_status", [
  "counting",
  "review",
  "completed",
  "cancelled",
]);

export const warehouses = pgTable("warehouses", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  ...timestamps,
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("auth_sessions_user_expiry_idx").on(table.userId, table.expiresAt)],
);

export const loginAttempts = pgTable("login_attempts", {
  bucketKey: text("bucket_key").primaryKey(),
  attempts: integer("attempts").default(0).notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
});

export const userWarehouses = pgTable(
  "user_warehouses",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("user_warehouse_pk").on(table.userId, table.warehouseId)],
);

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  ...timestamps,
});

export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  categoryId: uuid("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    sku: text("sku").notNull().unique(),
    barcode: text("barcode").unique(),
    variantName: text("variant_name").notNull(),
    unit: text("unit").default("pcs").notNull(),
    costPrice: numeric("cost_price", { precision: 14, scale: 2 }).default("0").notNull(),
    resellerPrice: numeric("reseller_price", { precision: 14, scale: 2 }).default("0").notNull(),
    minimumStock: integer("minimum_stock").default(0).notNull(),
    requiresBatch: boolean("requires_batch").default(false).notNull(),
    requiresExpiry: boolean("requires_expiry").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [
    index("product_variants_product_idx").on(table.productId),
    check("product_variants_minimum_stock_nonnegative", sql`${table.minimumStock} >= 0`),
  ],
);

export const suppliers = pgTable("suppliers", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  ...timestamps,
});

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    poNumber: text("po_number").notNull().unique(),
    status: purchaseOrderStatusEnum("status").default("draft").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [index("purchase_orders_warehouse_date_idx").on(table.warehouseId, table.createdAt)],
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    receivedQuantity: numeric("received_quantity", { precision: 14, scale: 3 })
      .default("0")
      .notNull(),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("purchase_order_items_po_idx").on(table.purchaseOrderId),
    check("purchase_order_items_quantity_positive", sql`${table.quantity} > 0`),
    check("purchase_order_items_received_nonnegative", sql`${table.receivedQuantity} >= 0`),
    check("purchase_order_items_cost_nonnegative", sql`${table.unitCost} >= 0`),
  ],
);

export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id, {
      onDelete: "set null",
    }),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id, {
      onDelete: "restrict",
    }),
    receiptNumber: text("receipt_number").notNull().unique(),
    status: receiptStatusEnum("status").default("qc_pending").notNull(),
    notes: text("notes"),
    receivedBy: uuid("received_by").references(() => users.id, {
      onDelete: "set null",
    }),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (table) => [
    index("goods_receipts_warehouse_date_idx").on(table.warehouseId, table.receivedAt),
  ],
);

export const receiptItems = pgTable(
  "receipt_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    receivedQuantity: numeric("received_quantity", {
      precision: 14,
      scale: 3,
    }).notNull(),
    qcStatus: receiptQcStatusEnum("qc_status").default("pending").notNull(),
    ...timestamps,
  },
  (table) => [
    index("receipt_items_receipt_idx").on(table.receiptId),
    check("receipt_items_quantity_positive", sql`${table.receivedQuantity} > 0`),
  ],
);

export const qcInspections = pgTable(
  "qc_inspections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receiptItemId: uuid("receipt_item_id")
      .notNull()
      .references(() => receiptItems.id, { onDelete: "restrict" }),
    result: qcResultEnum("result").notNull(),
    notes: text("notes"),
    inspectedBy: uuid("inspected_by").references(() => users.id, {
      onDelete: "set null",
    }),
    inspectedAt: timestamp("inspected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("qc_inspections_item_date_idx").on(table.receiptItemId, table.inspectedAt)],
);

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: locationTypeEnum("type").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("locations_warehouse_code_idx").on(table.warehouseId, table.code)],
);

export const stockBalances = pgTable(
  "stock_balances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).default("0").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("stock_balances_dimensions_idx").on(
      table.warehouseId,
      table.locationId,
      table.variantId,
    ),
    index("stock_balances_variant_idx").on(table.variantId),
    check("stock_balances_quantity_nonnegative", sql`${table.quantity} >= 0`),
  ],
);

export const stockCounts = pgTable(
  "stock_counts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    status: stockCountStatusEnum("status").default("counting").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("stock_counts_warehouse_status_idx").on(
      table.warehouseId,
      table.status,
    ),
    index("stock_counts_location_status_idx").on(
      table.locationId,
      table.status,
    ),
  ],
);

export const stockCountItems = pgTable(
  "stock_count_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stockCountId: uuid("stock_count_id")
      .notNull()
      .references(() => stockCounts.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    expectedQuantity: numeric("expected_quantity", {
      precision: 14,
      scale: 3,
    }).notNull(),
    countedQuantity: numeric("counted_quantity", {
      precision: 14,
      scale: 3,
    }),
    countedBy: uuid("counted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    countedAt: timestamp("counted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("stock_count_items_count_variant_idx").on(
      table.stockCountId,
      table.variantId,
    ),
    index("stock_count_items_variant_idx").on(table.variantId),
    check(
      "stock_count_items_expected_nonnegative",
      sql`${table.expectedQuantity} >= 0`,
    ),
    check(
      "stock_count_items_counted_nonnegative",
      sql`${table.countedQuantity} IS NULL OR ${table.countedQuantity} >= 0`,
    ),
  ],
);

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    resellerId: uuid("reseller_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    channel: text("channel").default("manual").notNull(),
    externalOrderId: text("external_order_id"),
    trackingNumber: text("tracking_number").notNull(),
    senderStore: text("sender_store"),
    status: orderStatusEnum("status").default("awaiting_pick").notNull(),
    deliveryOutcome: deliveryOutcomeEnum("delivery_outcome"),
    outcomeUpdatedAt: timestamp("outcome_updated_at", { withTimezone: true }),
    handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
    isCod: boolean("is_cod").default(false).notNull(),
    codAmount: numeric("cod_amount", { precision: 14, scale: 2 }),
    shipBy: timestamp("ship_by", { withTimezone: true }),
    packingType: text("packing_type"),
    statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sales_orders_channel_external_order_idx").on(
      table.channel,
      table.externalOrderId,
    ),
    uniqueIndex("sales_orders_channel_tracking_idx").on(table.channel, table.trackingNumber),
    index("sales_orders_reseller_status_idx").on(table.resellerId, table.status),
  ],
);

export const packingScans = pgTable(
  "packing_scans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => salesOrderItems.id, { onDelete: "restrict" }),
    scannedBy: uuid("scanned_by").references(() => users.id, { onDelete: "set null" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    scannedAt: timestamp("scanned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("packing_scans_order_item_idx").on(table.orderItemId, table.scannedAt),
    check("packing_scans_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

export const packingInspections = pgTable(
  "packing_inspections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "restrict" }),
    result: qcResultEnum("result").notNull(),
    packingType: packingTypeEnum("packing_type").notNull(),
    notes: text("notes"),
    inspectedBy: uuid("inspected_by").references(() => users.id, { onDelete: "set null" }),
    inspectedAt: timestamp("inspected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("packing_inspections_order_idx").on(table.orderId, table.inspectedAt)],
);

export const salesOrderItems = pgTable(
  "sales_order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("sales_order_items_order_idx").on(table.orderId),
    check("sales_order_items_quantity_positive", sql`${table.quantity} > 0`),
    check("sales_order_items_price_nonnegative", sql`${table.unitPrice} >= 0`),
  ],
);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => salesOrderItems.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("stock_reservations_available_idx").on(
      table.warehouseId,
      table.variantId,
      table.releasedAt,
    ),
    check("stock_reservations_quantity_positive", sql`${table.quantity} > 0`),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    fromLocationId: uuid("from_location_id").references(() => locations.id, {
      onDelete: "restrict",
    }),
    toLocationId: uuid("to_location_id").references(() => locations.id, {
      onDelete: "restrict",
    }),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    type: movementTypeEnum("type").notNull(),
    referenceType: text("reference_type"),
    referenceId: uuid("reference_id"),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("stock_movements_variant_date_idx").on(table.variantId, table.createdAt),
    index("stock_movements_warehouse_date_idx").on(table.warehouseId, table.createdAt),
    check("stock_movements_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "stock_movements_has_location",
      sql`${table.fromLocationId} IS NOT NULL OR ${table.toLocationId} IS NOT NULL`,
    ),
    check(
      "stock_movements_different_locations",
      sql`${table.fromLocationId} IS NULL OR ${table.toLocationId} IS NULL OR ${table.fromLocationId} <> ${table.toLocationId}`,
    ),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_logs_entity_date_idx").on(table.entity, table.createdAt)],
);

export const codPayments = pgTable(
  "cod_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "restrict" })
      .unique(),
    expectedAmount: numeric("expected_amount", { precision: 14, scale: 2 }).notNull(),
    receivedAmount: numeric("received_amount", { precision: 14, scale: 2 }),
    status: codStatusEnum("status").default("pending").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    notes: text("notes"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [check("cod_expected_nonnegative", sql`${table.expectedAmount} >= 0`)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resellerId: uuid("reseller_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    invoiceNumber: text("invoice_number").notNull().unique(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: invoiceStatusEnum("status").default("draft").notNull(),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).default("0").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    index("invoices_reseller_status_idx").on(table.resellerId, table.status),
    uniqueIndex("invoices_reseller_period_idx").on(table.resellerId, table.periodStart),
    check("invoices_period_valid", sql`${table.periodEnd} >= ${table.periodStart}`),
    check("invoices_subtotal_nonnegative", sql`${table.subtotal} >= 0`),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "restrict" })
      .unique(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull(),
    lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("invoice_items_invoice_idx").on(table.invoiceId),
    check("invoice_item_total_nonnegative", sql`${table.lineTotal} >= 0`),
  ],
);

export const resellerPayments = pgTable(
  "reseller_payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resellerId: uuid("reseller_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    method: text("method").notNull(),
    reference: text("reference"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    index("reseller_payments_invoice_idx").on(table.invoiceId),
    check("reseller_payments_amount_positive", sql`${table.amount} > 0`),
  ],
);
