import Link from "next/link";
import { cloneCustomerToCompany, deleteCustomer } from "@/app/actions";
import { DeleteButton } from "@/components/DeleteButton";
import { ensureSchema, query } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getCustomers(search) {
  await ensureSchema();
  const normalizedSearch = String(search || "").trim();
  const filter = normalizedSearch ? `%${normalizedSearch}%` : null;
  const result = await query(
    `SELECT
      id,
      full_name,
      document,
      email,
      phone,
      state_registration,
      city,
      state,
      created_at,
      EXISTS (
        SELECT 1
        FROM invoices
        WHERE invoices.customer_id = customers.id
          AND (
            invoices.sent_at IS NOT NULL OR
            invoices.protocol_number IS NOT NULL OR
            invoices.receipt_number IS NOT NULL OR
            invoices.cancelled_at IS NOT NULL OR
            invoices.status IN ('Autorizada', 'Transmitida', 'Cancelada')
          )
      ) AS has_transmitted_invoice
    FROM customers
    WHERE $1::text IS NULL
       OR full_name ILIKE $1
       OR document ILIKE $1
       OR COALESCE(email, '') ILIKE $1
       OR COALESCE(city, '') ILIKE $1
    ORDER BY created_at DESC`,
    [filter]
  );

  return result.rows;
}

export default async function CustomerSearchPage({ searchParams }) {
  const params = await searchParams;
  const q = String(params?.q || "").trim();
  const customers = await getCustomers(q);

  return (
    <section className="page page-wide">
      <header className="page-header">
        <div>
          <p className="eyebrow">Busca</p>
          <h2>Busca de clientes</h2>
          <p className="section-copy">
            Localize clientes rapidamente e trabalhe com a grade em tela cheia para revisar os dados com mais conforto.
          </p>
        </div>
        <div className="hero-actions">
          <Link href="/clientes" className="button secondary">Novo cliente</Link>
        </div>
      </header>

      <section className="panel list-panel table-panel-wide">
        <form className="search-bar" method="get">
          <input name="q" defaultValue={q} placeholder="Buscar por nome, documento, cidade ou e-mail" />
          <button type="submit" className="button primary">Buscar</button>
        </form>

        <div className="table-wrap table-wrap-wide">
          <table>
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Documento</th>
                <th>Fiscal</th>
                <th>Local</th>
                <th>Contato</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan="6">Nenhum cliente encontrado.</td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr key={customer.id}>
                    <td><strong>{customer.full_name}</strong></td>
                    <td>{customer.document}</td>
                    <td>{customer.state_registration || "Nao contribuinte"}</td>
                    <td>{customer.city && customer.state ? `${customer.city}/${customer.state}` : "-"}</td>
                    <td>{customer.email || customer.phone || "-"}</td>
                    <td>
                      <div className="table-actions">
                        <Link href={`/clientes?edit=${customer.id}`} className="button secondary small">Editar</Link>
                        <form action={cloneCustomerToCompany}>
                          <input type="hidden" name="id" value={customer.id} />
                          <button type="submit" className="button secondary small">Clonar empresa</button>
                        </form>
                        <form action={deleteCustomer}>
                          <input type="hidden" name="id" value={customer.id} />
                          <DeleteButton disabled={customer.has_transmitted_invoice} />
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
