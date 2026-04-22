import Link from "next/link";
import { createSale, updateSaleStatus } from "@/app/actions";
import { SalesForm } from "@/components/SalesForm";
import { ensureSchema, query } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

async function getSalesPageData() {
  await ensureSchema();

  const [companies, customers, products, sales, summary] = await Promise.all([
    query(`
      SELECT id, trade_name, legal_name
      FROM companies
      ORDER BY trade_name NULLS LAST, legal_name
    `),
    query(`
      SELECT id, full_name, document
      FROM customers
      ORDER BY full_name
    `),
    query(`
      SELECT id, name, sku, ncm, cbenef, price
      FROM products
      ORDER BY name
    `),
    query(`
      SELECT
        sales.id,
        sales.sale_number,
        sales.sale_date,
        sales.status,
        sales.total_value,
        sales.notes,
        sales.invoiced_at,
        companies.trade_name AS company_trade_name,
        companies.legal_name AS company_legal_name,
        customers.full_name AS customer_full_name,
        COUNT(sale_items.id)::int AS item_count,
        MAX(invoices.id) AS invoice_id
      FROM sales
      LEFT JOIN companies ON companies.id = sales.company_id
      LEFT JOIN customers ON customers.id = sales.customer_id
      LEFT JOIN sale_items ON sale_items.sale_id = sales.id
      LEFT JOIN invoices ON invoices.sale_id = sales.id
      GROUP BY sales.id, companies.trade_name, companies.legal_name, customers.full_name
      ORDER BY sales.created_at DESC
      LIMIT 20
    `),
    query(`
      SELECT
        COUNT(*)::int AS total_sales,
        COUNT(*) FILTER (WHERE status = 'aberta')::int AS open_sales,
        COUNT(*) FILTER (WHERE status = 'faturada')::int AS invoiced_sales,
        COALESCE(SUM(total_value), 0) AS total_value
      FROM sales
    `)
  ]);

  return {
    companies: companies.rows,
    customers: customers.rows,
    products: products.rows,
    sales: sales.rows,
    summary: summary.rows[0]
  };
}

function getStatusClass(status) {
  if (status === "faturada") {
    return "status-pill";
  }

  if (status === "concluida") {
    return "status-pill subtle";
  }

  return "status-pill subtle";
}

export default async function SalesPage({ searchParams }) {
  const { companies, customers, products, sales, summary } = await getSalesPageData();
  const params = await searchParams;
  const errorMessage = params?.error ? decodeURIComponent(String(params.error)) : null;
  const successMessage = params?.success ? decodeURIComponent(String(params.success)) : null;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Venda</p>
          <h2>Modulo de vendas</h2>
          <p className="section-copy">
            Registre a venda, acompanhe o status comercial e gere a nota fiscal com os mesmos dados.
          </p>
        </div>
      </header>

      <div className="stats-grid">
        <article className="stat-card">
          <span>Vendas</span>
          <strong>{summary.total_sales}</strong>
        </article>
        <article className="stat-card">
          <span>Em aberto</span>
          <strong>{summary.open_sales}</strong>
        </article>
        <article className="stat-card">
          <span>Faturadas</span>
          <strong>{summary.invoiced_sales}</strong>
        </article>
        <article className="stat-card">
          <span>Total vendido</span>
          <strong>{formatCurrency(summary.total_value)}</strong>
        </article>
      </div>

      {successMessage ? <p className="form-success">{successMessage}</p> : null}

      <SalesForm
        companies={companies}
        customers={customers}
        products={products}
        action={createSale}
        errorMessage={errorMessage}
      />

      <section className="panel list-panel">
        <h3>Ultimas vendas</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Venda</th>
                <th>Empresa</th>
                <th>Cliente</th>
                <th>Itens</th>
                <th>Total</th>
                <th>Status</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan="7">Nenhuma venda registrada ainda.</td>
                </tr>
              ) : (
                sales.map((sale) => (
                  <tr key={sale.id}>
                    <td>
                      <strong>#{sale.sale_number}</strong>
                      <div>{formatDate(sale.sale_date)}</div>
                    </td>
                    <td>{sale.company_trade_name || sale.company_legal_name || "-"}</td>
                    <td>{sale.customer_full_name || "-"}</td>
                    <td>{sale.item_count}</td>
                    <td>{formatCurrency(sale.total_value)}</td>
                    <td><span className={getStatusClass(sale.status)}>{sale.status}</span></td>
                    <td>
                      <div className="table-actions">
                        <Link href={`/notas/enviar?sale=${sale.id}`} className="button secondary small">
                          Gerar nota
                        </Link>
                        {sale.invoice_id ? (
                          <Link href={`/notas?success=${encodeURIComponent(`Venda ${sale.sale_number} ja possui nota gerada.`)}`} className="button secondary small">
                            Ver nota
                          </Link>
                        ) : null}
                        <form action={updateSaleStatus}>
                          <input type="hidden" name="id" value={sale.id} />
                          <input type="hidden" name="status" value="concluida" />
                          <button type="submit" className="button secondary small">Concluir</button>
                        </form>
                        <form action={updateSaleStatus}>
                          <input type="hidden" name="id" value={sale.id} />
                          <input type="hidden" name="status" value="faturada" />
                          <button type="submit" className="button secondary small">Faturar</button>
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
