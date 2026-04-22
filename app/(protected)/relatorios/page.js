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

async function getCustomers() {
  await ensureSchema();

  const result = await query(`
    SELECT id, full_name, document
    FROM customers
    ORDER BY full_name
  `);

  return result.rows;
}

function ReportFilters({ report, customers }) {
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
        <label className="full">
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
  const customers = await getCustomers();

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
                  Use periodo e cliente para refinar o relatorio antes de gerar o PDF.
                </p>
              ) : null}
            </div>
            <ReportFilters report={report} customers={customers} />
          </article>
        ))}
      </section>
    </section>
  );
}
