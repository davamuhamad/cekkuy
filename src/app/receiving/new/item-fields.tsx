"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type VariantOption = { id: string; sku: string; name: string; variant: string };

export function ReceiptItemFields({ variants }: { variants: VariantOption[] }) {
  const [lines, setLines] = useState([0]);
  return (
    <div className="receipt-lines">
      {lines.map((line, index) => (
        <div className="receipt-line" key={line}>
          <label>Produk / SKU
            <select name="variantId" required defaultValue="">
              <option value="" disabled>Pilih varian</option>
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.name} · {variant.variant} · {variant.sku}
                </option>
              ))}
            </select>
          </label>
          <label>Jumlah diterima
            <input name="quantity" type="number" min="0.001" step="0.001" required placeholder="0" />
          </label>
          {lines.length > 1 && (
            <button
              className="remove-variant receipt-remove"
              type="button"
              onClick={() => setLines((current) => current.filter((item) => item !== line))}
              aria-label={`Hapus item ${index + 1}`}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ))}
      {lines.length < 50 && (
        <button className="secondary-button add-variant" type="button" onClick={() => setLines((current) => [...current, Math.max(...current) + 1])}>
          <Plus size={16} /> Tambah produk
        </button>
      )}
    </div>
  );
}
