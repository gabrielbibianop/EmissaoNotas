import { ensureSchema, query } from "@/lib/db";

export const dynamic = "force-dynamic";

const reports = [
  {
    slug: "vendas",
    title: "Relatorio de vendas",
    description: "Lista as vendas registradas, totais e grafico por periodo.",
    supportsFilters: true
  },
  {
    slug: "produtos",
    title: "Relatorio de produtos",
    description: "Mostra cadastro, preco, estoque e valor total em estoque."
  },
  {
    slug: "clientes",
    title: "Relatorio de clientes",
    description: "Reune documento, contato e cidade dos clientes cadastrados."
  },
  {
    slug: "empresas",
    title: "Relatorio de empresas",
    description: "Resume emitentes, certificado e sequencia fiscal."
  },
  {
    slug: "notas",
    title: "Relatorio de notas",
    description: "Lista notas emitidas e inclui grafico final com os totais.",
    supportsFilters: true
  }
];

async function getReportOptions() {
  await ensureSchema();

  const [customersResult, companiesResult] = await Promise.all([
    query(`
      SELECT id, full_name, document
      FROM customers
      ORDER BY full_name
    `),
    query(`
      SELECT id, trade_name, legal_name, cnpj
      FROM companies
      ORDER BY trade_name NULLS LAST, legal_name
    `)
  ]);

  return {
    customers: customersResult.rows,
    companies: companiesResult.rows
  };
}

function ReportFilters({ report, customers, companies }) {
  if (!report.supportsFilters) {
    return (
      <div className="action-row">
        <a
          href={`/api/relatorios/${report.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="button primary"
        >
          Gerar PDF
        </a>
      </div>
    );
  }

  return (
    <form
      action={`/api/relatorios/${report.slug}`}
      method="get"
      target="_blank"
      rel="noopener noreferrer"
      className="user-edit-form"
    >
      <div className="form-grid">
        <label>
          Data inicial
          <input type="date" name="dateFrom" />
        </label>
        <label>
          Data final
          <input type="date" name="dateTo" />
        </label>
        <label>
          Cliente
          <select name="customerId" defaultValue="">
            <option value="">Todos os clientes</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.full_name}{customer.document ? ` - ${customer.document}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Empresa
          <select name="companyId" defaultValue="">
            <option value="">Todas as empresas</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.trade_name || company.legal_name}{company.cnpj ? ` - ${company.cnpj}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="action-row">
        <button type="submit" className="button primary">
          Gerar PDF filtrado
        </button>
        <a
          href={`/api/relatorios/${report.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="button secondary"
        >
          Sem filtro
        </a>
      </div>
    </form>
  );
}

export default async function ReportsPage() {
  const { customers, companies } = await getReportOptions();

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Relatorios</p>
          <h2>Central de relatorios</h2>
          <p className="section-copy">
            Gere PDFs prontos para impressao e conferencia dos principais dados do sistema.
          </p>
        </div>
      </header>

      <section className="user-grid">
        {reports.map((report) => (
          <article key={report.slug} className="panel user-editor-card">
            <div>
              <p className="eyebrow">PDF</p>
              <h3>{report.title}</h3>
              <p className="section-copy">{report.description}</p>
              {report.supportsFilters ? (
                <p className="section-copy">
                  Use periodo, cliente e empresa para refinar o relatorio antes de gerar o PDF.
                </p>
              ) : null}
            </div>
            <ReportFilters report={report} customers={customers} companies={companies} />
          </article>
        ))}
      </section>
    </section>
  );
}
