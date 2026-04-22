import Link from "next/link";
import { cloneCompanyToCustomer, deleteCompany } from "@/app/actions";
import { DeleteButton } from "@/components/DeleteButton";
import { ensureSchema, query } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getCompanies(search) {
  await ensureSchema();
  const normalizedSearch = String(search || "").trim();
  const filter = normalizedSearch ? `%${normalizedSearch}%` : null;
  const result = await query(
    `SELECT
      id,
      legal_name,
      trade_name,
      cnpj,
      state_registration,
      tax_regime,
      city,
      state,
      certificate_name,
      invoice_series,
      invoice_next_number,
      created_at,
      EXISTS (
        SELECT 1
        FROM invoices
        WHERE invoices.company_id = companies.id
          AND (
            invoices.sent_at IS NOT NULL OR
            invoices.protocol_number IS NOT NULL OR
            invoices.receipt_number IS NOT NULL OR
            invoices.cancelled_at IS NOT NULL OR
            invoices.status IN ('Autorizada', 'Transmitida', 'Cancelada')
          )
      ) AS has_transmitted_invoice
    FROM companies
    WHERE $1::text IS NULL
       OR legal_name ILIKE $1
       OR COALESCE(trade_name, '') ILIKE $1
       OR cnpj ILIKE $1
       OR COALESCE(city, '') ILIKE $1
    ORDER BY created_at DESC`,
    [filter]
  );

  return result.rows;
}

export default async function CompanySearchPage({ searchParams }) {
  const params = await searchParams;
  const q = String(params?.q || "").trim();
  const companies = await getCompanies(q);

  return (
    <section className="page page-wide">
      <header className="page-header">
        <div>
          <p className="eyebrow">Busca</p>
          <h2>Busca de empresas</h2>
          <p className="section-copy">
            Veja o cadastro de emitentes em largura total para consultar endereco fiscal, sequencia e certificado com mais clareza.
          </p>
        </div>
        <div className="hero-actions">
          <Link href="/empresas" className="button secondary">Nova empresa</Link>
        </div>
      </header>

      <section className="panel list-panel table-panel-wide">
        <form className="search-bar" method="get">
          <input name="q" defaultValue={q} placeholder="Buscar por razao social, fantasia, CNPJ ou cidade" />
          <button type="submit" className="button primary">Buscar</button>
        </form>

        <div className="table-wrap table-wrap-wide">
          <table>
            <thead>
              <tr>
                <th>Empresa</th>
                <th>CNPJ</th>
                <th>Fiscal</th>
                <th>Endereco NF-e</th>
                <th>Certificado</th>
                <th>Sequencia</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 ? (
                <tr>
                  <td colSpan="7">Nenhuma empresa encontrada.</td>
                </tr>
              ) : (
                companies.map((company) => (
                  <tr key={company.id}>
                    <td>
                      <strong>{company.trade_name || company.legal_name}</strong>
                      <div>{company.legal_name}</div>
                    </td>
                    <td>{company.cnpj}</td>
                    <td>IE {company.state_registration || "-"} / CRT {company.tax_regime || "3"}</td>
                    <td>{company.city && company.state ? `${company.city}/${company.state}` : "-"}</td>
                    <td>{company.certificate_name || "Pendente"}</td>
                    <td>{company.invoice_series || "1"} / {company.invoice_next_number || 1}</td>
                    <td>
                      <div className="table-actions">
                        <Link href={`/empresas?edit=${company.id}`} className="button secondary small">Editar</Link>
                        <Link href={`/empresas?smtp=${company.id}`} className="button secondary small">SMTP</Link>
                        <form action={cloneCompanyToCustomer}>
                          <input type="hidden" name="id" value={company.id} />
                          <button type="submit" className="button secondary small">Clonar cliente</button>
                        </form>
                        <form action={deleteCompany}>
                          <input type="hidden" name="id" value={company.id} />
                          <DeleteButton disabled={company.has_transmitted_invoice} />
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
