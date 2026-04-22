import Link from "next/link";
import { createProduct, updateProduct } from "@/app/actions";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { ensureSchema, query } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getProducts() {
  await ensureSchema();
  const result = await query(`
    SELECT
      products.id,
      products.name,
      products.sku,
      products.ncm,
      products.cbenef,
      products.price,
      products.stock,
      products.description,
      EXISTS (
        SELECT 1
        FROM invoices
        WHERE (
          invoices.product_id = products.id OR
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(invoices.invoice_meta::jsonb -> 'items', '[]'::jsonb)) AS item
            WHERE (item ->> 'productId') = products.id::text
          )
        )
          AND (
            invoices.sent_at IS NOT NULL OR
            invoices.protocol_number IS NOT NULL OR
            invoices.receipt_number IS NOT NULL OR
            invoices.cancelled_at IS NOT NULL OR
            invoices.status IN ('Autorizada', 'Transmitida', 'Cancelada')
          )
      ) AS has_transmitted_invoice
    FROM products
    ORDER BY created_at DESC
  `);
  return result.rows;
}

export default async function ProductsPage({ searchParams }) {
  const products = await getProducts();
  const params = await searchParams;
  const editingId = Number(params?.edit || 0);
  const successMessage = params?.success ? decodeURIComponent(String(params.success)) : null;
  const errorMessage = params?.error ? decodeURIComponent(String(params.error)) : null;
  const editingProduct = products.find((product) => product.id === editingId);
  const formAction = editingProduct ? updateProduct : createProduct;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Cadastro</p>
          <h2>Produtos</h2>
          <p className="section-copy">
            Estruture seu catalogo com SKU, NCM, preco e estoque para reduzir retrabalho na emissao.
          </p>
        </div>
        <div className="hero-actions">
          <Link href="/produtos/busca" className="button secondary">Buscar produtos</Link>
        </div>
      </header>

      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <form action={formAction} className="panel form-panel form-panel-wide">
        <h3>{editingProduct ? "Editar produto" : "Novo produto"}</h3>
        {editingProduct ? <input type="hidden" name="id" value={editingProduct.id} /> : null}

        <div className="form-grid">
          <label>
            Nome do produto
            <input name="name" placeholder="Ex.: Notebook Pro 14" defaultValue={editingProduct?.name || ""} required />
          </label>
          <label>
            SKU
            <input name="sku" placeholder="PROD-001" defaultValue={editingProduct?.sku || ""} required />
          </label>
          <label>
            NCM
            <input name="ncm" placeholder="8471.30.12" defaultValue={editingProduct?.ncm || ""} />
          </label>
          <label>
            CBenef
            <input name="cbenef" placeholder="Ex.: SP123456" defaultValue={editingProduct?.cbenef || ""} />
          </label>
          <label>
            Preco
            <input name="price" placeholder="1999,90" defaultValue={editingProduct?.price || ""} />
          </label>
          <label>
            Estoque
            <input name="stock" type="number" min="0" placeholder="0" defaultValue={editingProduct?.stock ?? 0} />
          </label>
          <label className="full">
            Descricao
            <textarea name="description" rows="4" placeholder="Detalhes do produto" defaultValue={editingProduct?.description || ""} />
          </label>
        </div>

        <div className="action-row">
          <FormSubmitButton
            idleText={editingProduct ? "Salvar alteracoes" : "Salvar produto"}
            pendingText={editingProduct ? "Salvando..." : "Criando..."}
          />
          {editingProduct ? <Link href="/produtos" className="button secondary">Cancelar</Link> : null}
        </div>
      </form>
    </section>
  );
}
