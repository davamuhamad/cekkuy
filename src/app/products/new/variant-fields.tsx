"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type Variant = { sku: string; barcode: string; name: string };

export function VariantFields() {
  const [variants, setVariants] = useState<Variant[]>([{ sku: "", barcode: "", name: "Default" }]);

  function updateVariant(index: number, field: keyof Variant, value: string) {
    setVariants((current) =>
      current.map((variant, variantIndex) =>
        variantIndex === index ? { ...variant, [field]: value } : variant,
      ),
    );
  }

  return (
    <div className="variant-fields">
      {variants.map((variant, index) => (
        <div className="variant-editor" key={index}>
          <div className="variant-editor-heading">
            <strong>Varian {index + 1}</strong>
            {variants.length > 1 && (
              <button
                className="remove-variant"
                type="button"
                onClick={() => setVariants((current) => current.filter((_, item) => item !== index))}
                aria-label={`Hapus varian ${index + 1}`}
              >
                <Trash2 size={15} /> Hapus
              </button>
            )}
          </div>
          <div className="form-grid variant-grid">
            <label>SKU gudang <input name="sku" value={variant.sku} onChange={(event) => updateVariant(index, "sku", event.target.value)} required maxLength={80} placeholder="TOPI-HITAM" /></label>
            <label>Nama varian <input name="variantName" value={variant.name} onChange={(event) => updateVariant(index, "name", event.target.value)} required maxLength={120} placeholder="Hitam / Default" /></label>
            <label>Barcode <input name="barcode" value={variant.barcode} onChange={(event) => updateVariant(index, "barcode", event.target.value)} maxLength={80} placeholder="Opsional" /></label>
            <label>Satuan <input name="unit" defaultValue="pcs" required maxLength={20} /></label>
            <label>Harga beli (Rp) <input name="cost" type="number" min="0" step="0.01" defaultValue="0" required /></label>
            <label>Harga reseller (Rp) <input name="price" type="number" min="0" step="0.01" defaultValue="0" required /></label>
            <label>Stok minimum <input name="minimumStock" type="number" min="0" step="1" defaultValue="0" required /></label>
          </div>
        </div>
      ))}
      {variants.length < 20 && (
        <button
          className="secondary-button add-variant"
          type="button"
          onClick={() => setVariants((current) => [...current, { sku: "", barcode: "", name: "" }])}
        >
          <Plus size={16} /> Tambah varian
        </button>
      )}
    </div>
  );
}
