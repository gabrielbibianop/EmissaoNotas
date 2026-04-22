import Link from "next/link";
import { updateSaleStatus } from "@/app/actions";
import { ensureSchema, query } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

async function getSales() {
  await ensureSchema();

  const result = await query(`
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
  `);

  return result.rows;
}

function getStatusClass(status) {
  if (status === "faturada") {
    return "status-pill";
  }

  return "status-pill subtle";
}

export default async function SalesSearchPage() {
  const sales = await getSales();

  return (
    <section className="page page-wide">
      <header className="page-header">
        <div>
          <p className="eyebrow">Venda</p>
          <h2>Busca de vendas</h2>
          <p className="section-copy">
            Visualize todas as vendas em grade larga, acompanhe o status e gere a nota fiscal quando precisar.
          </p>
        </div>
        <div className="hero-actions">
          <Link href="/vendas" className="button secondary">Nova venda</Link>
        </div>
      </header>

      <section className="panel list-panel table-panel-wide">
        <div className="table-wrap table-wrap-wide">
          <table>
            <thead>
              <tr>
                <th>Venda</th>
                <th>Empresa</th>
                <th>Cliente</th>
                <th>Itens</th>
                <th>Total</th>
                <th>Status</th>
                <th>Observacoes</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 ? (
                <tr>
                  <td colSpan="8">Nenhuma venda registrada ainda.</td>
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
                    <td>{sale.notes || "-"}</td>
                    <td>
                      <div className="table-actions">
                        <Link href={`/notas/enviar?sale=${sale.id}`} className="button secondary small">
                          Gerar nota
                        </Link>
                        {sale.invoice_id ? (
                          <Link href="/notas" className="button secondary small">
                            Ver notas
                          </Link>
                        ) : null}
                        <form action={updateSaleStatus}>
                          <input type="hidden" name="id" value={sale.id} />
                          <input type="hidden" name="status" value="concluida" />
                          <button type="submit" className="button secondary small">Concluir</button>
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
