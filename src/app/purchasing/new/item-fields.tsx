"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

type Variant = { id: string; sku: string; name: string; variant: string; cost: string };
export function PurchaseItemFields({ variants }: { variants: Variant[] }) {
  const [lines, setLines] = useState([0]);
  return <div className="receipt-lines">
    {lines.map((line, index) => <div className="po-line" key={line}>
      <label>Produk / SKU<select name="variantId" required defaultValue=""><option value="" disabled>Pilih varian</option>{variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name} · {variant.variant} · {variant.sku}</option>)}</select></label>
      <label>Jumlah<input name="quantity" type="number" min="0.001" step="0.001" required defaultValue="1" /></label>
      <label>Harga beli<input name="cost" type="number" min="0" step="0.01" required defaultValue={variants[0]?.cost ?? "0"} /></label>
      {lines.length > 1 && <button className="remove-variant receipt-remove" type="button" onClick={() => setLines((current) => current.filter((entry) => entry !== line))} aria-label={`Hapus item ${index + 1}`}><Trash2 size={15} /></button>}
    </div>)}
    {lines.length < 50 && <button className="secondary-button add-variant" type="button" onClick={() => setLines((current) => [...current, Math.max(...current) + 1])}><Plus size={16} /> Tambah produk</button>}
  </div>;
}
