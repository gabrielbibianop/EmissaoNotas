import Link from "next/link";
import { cloneProduct, deleteProduct } from "@/app/actions";
import { DeleteButton } from "@/components/DeleteButton";
import { ensureSchema, query } from "@/lib/db";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

async function getProducts(search) {
  await ensureSchema();
  const normalizedSearch = String(search || "").trim();
  const filter = normalizedSearch ? `%${normalizedSearch}%` : null;
  const result = await query(
    `SELECT
      id,
      name,
      sku,
      ncm,
      price,
      stock,
      description,
      created_at,
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
    WHERE $1::text IS NULL
       OR name ILIKE $1
       OR sku ILIKE $1
       OR COALESCE(ncm, '') ILIKE $1
       OR COALESCE(description, '') ILIKE $1
    ORDER BY created_at DESC`,
    [filter]
  );

  return result.rows;
}

export default async function ProductSearchPage({ searchParams }) {
  const params = await searchParams;
  const q = String(params?.q || "").trim();
  const products = await getProducts(q);

  return (
    <section className="page page-wide">
      <header className="page-header">
        <div>
          <p className="eyebrow">Busca</p>
          <h2>Busca de produtos</h2>
          <p className="section-copy">
            Trabalhe com o catalogo em tela cheia para localizar SKU, preco, NCM e estoque com melhor visualizacao.
          </p>
        </div>
        <div className="hero-actions">
          <Link href="/produtos" className="button secondary">Novo produto</Link>
        </div>
      </header>

      <section className="panel list-panel table-panel-wide">
        <form className="search-bar" method="get">
          <input name="q" defaultValue={q} placeholder="Buscar por nome, SKU, NCM ou descricao" />
          <button type="submit" className="button primary">Buscar</button>
        </form>

        <div className="table-wrap table-wrap-wide">
          <table>
            <thead>
              <tr>
                <th>Produto</th>
                <th>SKU</th>
                <th>NCM</th>
                <th>Preco</th>
                <th>Estoque</th>
                <th>Descricao</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan="7">Nenhum produto encontrado.</td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id}>
                    <td><strong>{product.name}</strong></td>
                    <td>{product.sku}</td>
                    <td>{product.ncm || "-"}</td>
                    <td>{formatCurrency(product.price)}</td>
                    <td>{product.stock}</td>
                    <td>{product.description || "-"}</td>
                    <td>
                      <div className="table-actions">
                        <Link href={`/produtos?edit=${product.id}`} className="button secondary small">Editar</Link>
                        <form action={cloneProduct}>
                          <input type="hidden" name="id" value={product.id} />
                          <button type="submit" className="button secondary small">Clonar produto</button>
                        </form>
                        <form action={deleteProduct}>
                          <input type="hidden" name="id" value={product.id} />
                          <DeleteButton disabled={product.has_transmitted_invoice} />
                        </form>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
