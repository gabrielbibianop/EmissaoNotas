import { ensureSchema, query } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { buildReportPdf, formatDate, money } from "@/lib/report-pdf";

export const runtime = "nodejs";

function buildFilterClause(dateField, { dateFrom, dateTo, customerId }, params, customerField = "customers.id") {
  const clauses = [];

  if (dateFrom) {
    params.push(dateFrom);
    clauses.push(`${dateField} >= $${params.length}`);
  }

  if (dateTo) {
    params.push(dateTo);
    clauses.push(`${dateField} <= $${params.length}`);
  }

  if (customerId) {
    params.push(customerId);
    clauses.push(`${customerField} = $${params.length}`);
  }

  return clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
}

function buildFilterLabel({ dateFrom, dateTo, customerName }) {
  const parts = [];

  if (dateFrom || dateTo) {
    parts.push(`Periodo: ${dateFrom || "..."} ate ${dateTo || "..."}`);
  }

  if (customerName) {
    parts.push(`Cliente: ${customerName}`);
  }

  return parts.length > 0 ? ` | ${parts.join(" | ")}` : "";
}

function currentSubtitle(label) {
  return `${label} gerado em ${new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date())}`;
}

async function getSalesReport(filters) {
  const params = [];
  const whereClause = buildFilterClause("sales.sale_date", filters, params);
  const customerNameResult = filters.customerId
    ? await query("SELECT full_name FROM customers WHERE id = $1", [filters.customerId])
    : { rows: [] };
  const customerName = customerNameResult.rows[0]?.full_name || "";
  const [rowsResult, chartResult, summaryResult] = await Promise.all([
    query(
      `
      SELECT
        sales.sale_number,
        sales.sale_date,
        sales.status,
        sales.total_value,
        companies.trade_name AS company_trade_name,
        companies.legal_name AS company_legal_name,
        customers.full_name AS customer_full_name,
        COUNT(sale_items.id)::int AS item_count
      FROM sales
      LEFT JOIN companies ON companies.id = sales.company_id
      LEFT JOIN customers ON customers.id = sales.customer_id
      LEFT JOIN sale_items ON sale_items.sale_id = sales.id
      ${whereClause}
      GROUP BY sales.id, companies.trade_name, companies.legal_name, customers.full_name
      ORDER BY sales.sale_date DESC, sales.id DESC
    `,
      params
    ),
    query(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', sale_date), 'MM/YYYY') AS label,
        COALESCE(SUM(total_value), 0) AS value
      FROM sales
      ${whereClause}
      GROUP BY DATE_TRUNC('month', sale_date)
      ORDER BY DATE_TRUNC('month', sale_date) DESC
      LIMIT 6
    `,
      params
    ),
    query(
      `
      SELECT
        COUNT(*)::int AS total_sales,
        COALESCE(SUM(total_value), 0) AS total_value,
        COUNT(*) FILTER (WHERE status = 'faturada')::int AS invoiced_sales
      FROM sales
      ${whereClause}
    `,
      params
    )
  ]);

  return {
    title: "Relatorio de vendas",
    subtitle: `${currentSubtitle("Relatorio de vendas")}${buildFilterLabel({ ...filters, customerName })}`,
    summary: [
      { label: "Vendas", value: String(summaryResult.rows[0].total_sales) },
      { label: "Faturadas", value: String(summaryResult.rows[0].invoiced_sales) },
      { label: "Total", value: money(summaryResult.rows[0].total_value) }
    ],
    columns: [
      { label: "Venda", width: 78, value: (row) => `#${row.sale_number}` },
      { label: "Data", width: 72, value: (row) => formatDate(row.sale_date) },
      { label: "Empresa", width: 155, value: (row) => row.company_trade_name || row.company_legal_name || "-" },
      { label: "Cliente", width: 170, value: (row) => row.customer_full_name || "-" },
      { label: "Itens", width: 48, value: (row) => String(row.item_count) },
      { label: "Status", width: 90, value: (row) => row.status },
      { label: "Total", width: 90, value: (row) => money(row.total_value) }
    ],
    rows: rowsResult.rows,
    chartTitle: "Totais de vendas por mes",
    chartPoints: [...chartResult.rows].reverse()
  };
}

async function getProductsReport() {
  const [rowsResult, summaryResult] = await Promise.all([
    query(`
      SELECT name, sku, ncm, price, stock, description
      FROM products
      ORDER BY name
    `),
    query(`
      SELECT
        COUNT(*)::int AS total_products,
        COALESCE(SUM(stock), 0)::int AS total_stock,
        COALESCE(SUM(price * stock), 0) AS total_value
      FROM products
    `)
  ]);

  return {
    title: "Relatorio de produtos",
    subtitle: currentSubtitle("Relatorio de produtos"),
    summary: [
      { label: "Produtos", value: String(summaryResult.rows[0].total_products) },
      { label: "Unidades", value: String(summaryResult.rows[0].total_stock) },
      { label: "Valor em estoque", value: money(summaryResult.rows[0].total_value) }
    ],
    columns: [
      { label: "Produto", width: 220, value: (row) => row.name },
      { label: "SKU", width: 110, value: (row) => row.sku },
      { label: "NCM", width: 90, value: (row) => row.ncm || "-" },
      { label: "Preco", width: 95, value: (row) => money(row.price) },
      { label: "Estoque", width: 70, value: (row) => String(row.stock) },
      { label: "Descricao", width: 190, value: (row) => row.description || "-" }
    ],
    rows: rowsResult.rows
  };
}

async function getCustomersReport() {
  const [rowsResult, summaryResult] = await Promise.all([
    query(`
      SELECT full_name, document, email, phone, city, state
      FROM customers
      ORDER BY full_name
    `),
    query(`
      SELECT COUNT(*)::int AS total_customers
      FROM customers
    `)
  ]);

  return {
    title: "Relatorio de clientes",
    subtitle: currentSubtitle("Relatorio de clientes"),
    summary: [
      { label: "Clientes", value: String(summaryResult.rows[0].total_customers) }
    ],
    columns: [
      { label: "Cliente", width: 220, value: (row) => row.full_name },
      { label: "Documento", width: 120, value: (row) => row.document },
      { label: "E-mail", width: 180, value: (row) => row.email || "-" },
      { label: "Telefone", width: 110, value: (row) => row.phone || "-" },
      { label: "Cidade/UF", width: 145, value: (row) => row.city && row.state ? `${row.city}/${row.state}` : row.city || row.state || "-" }
    ],
    rows: rowsResult.rows
  };
}

async function getCompaniesReport() {
  const [rowsResult, summaryResult] = await Promise.all([
    query(`
      SELECT legal_name, trade_name, cnpj, city, state, certificate_name, invoice_series, invoice_next_number
      FROM companies
      ORDER BY legal_name
    `),
    query(`
      SELECT COUNT(*)::int AS total_companies
      FROM companies
    `)
  ]);

  return {
    title: "Relatorio de empresas",
    subtitle: currentSubtitle("Relatorio de empresas"),
    summary: [
      { label: "Empresas", value: String(summaryResult.rows[0].total_companies) }
    ],
    columns: [
      { label: "Razao social", width: 200, value: (row) => row.legal_name },
      { label: "Fantasia", width: 130, value: (row) => row.trade_name || "-" },
      { label: "CNPJ", width: 120, value: (row) => row.cnpj },
      { label: "Cidade/UF", width: 110, value: (row) => row.city && row.state ? `${row.city}/${row.state}` : row.city || row.state || "-" },
      { label: "Certificado", width: 125, value: (row) => row.certificate_name || "-" },
      { label: "Serie/Prox.", width: 92, value: (row) => `${row.invoice_series || "1"} / ${row.invoice_next_number || 1}` }
    ],
    rows: rowsResult.rows
  };
}

async function getInvoicesReport(filters) {
  const params = [];
  const whereClause = buildFilterClause("invoices.issue_date", filters, params);
  const customerNameResult = filters.customerId
    ? await query("SELECT full_name FROM customers WHERE id = $1", [filters.customerId])
    : { rows: [] };
  const customerName = customerNameResult.rows[0]?.full_name || "";
  const [rowsResult, chartResult, summaryResult] = await Promise.all([
    query(
      `
      SELECT
        invoices.number,
        invoices.series,
        invoices.issue_date,
        invoices.status,
        invoices.total_value,
        companies.trade_name AS company_trade_name,
        companies.legal_name AS company_legal_name,
        customers.full_name AS customer_full_name
      FROM invoices
      LEFT JOIN companies ON companies.id = invoices.company_id
      LEFT JOIN customers ON customers.id = invoices.customer_id
      ${whereClause}
      ORDER BY invoices.issue_date DESC, invoices.id DESC
    `,
      params
    ),
    query(
      `
      SELECT
        TO_CHAR(DATE_TRUNC('month', issue_date), 'MM/YYYY') AS label,
        COALESCE(SUM(total_value), 0) AS value
      FROM invoices
      ${whereClause}
      GROUP BY DATE_TRUNC('month', issue_date)
      ORDER BY DATE_TRUNC('month', issue_date) DESC
      LIMIT 6
    `,
      params
    ),
    query(
      `
      SELECT
        COUNT(*)::int AS total_invoices,
        COALESCE(SUM(total_value), 0) AS total_value,
        COUNT(*) FILTER (WHERE status = 'Cancelada')::int AS cancelled_invoices
      FROM invoices
      ${whereClause}
    `,
      params
    )
  ]);

  return {
    title: "Relatorio de notas",
    subtitle: `${currentSubtitle("Relatorio de notas")}${buildFilterLabel({ ...filters, customerName })}`,
    summary: [
      { label: "Notas", value: String(summaryResult.rows[0].total_invoices) },
      { label: "Canceladas", value: String(summaryResult.rows[0].cancelled_invoices) },
      { label: "Total", value: money(summaryResult.rows[0].total_value) }
    ],
    columns: [
      { label: "Nota", width: 88, value: (row) => `${row.number}${row.series ? `/${row.series}` : ""}` },
      { label: "Data", width: 72, value: (row) => formatDate(row.issue_date) },
      { label: "Empresa", width: 160, value: (row) => row.company_trade_name || row.company_legal_name || "-" },
      { label: "Cliente", width: 170, value: (row) => row.customer_full_name || "-" },
      { label: "Status", width: 110, value: (row) => row.status },
      { label: "Total", width: 92, value: (row) => money(row.total_value) }
    ],
    rows: rowsResult.rows,
    chartTitle: "Totais de notas por mes",
    chartPoints: [...chartResult.rows].reverse()
  };
}

async function getReportDefinition(tipo, filters) {
  switch (tipo) {
    case "vendas":
      return getSalesReport(filters);
    case "produtos":
      return getProductsReport();
    case "clientes":
      return getCustomersReport();
    case "empresas":
      return getCompaniesReport();
    case "notas":
      return getInvoicesReport(filters);
    default:
      throw new Error("Tipo de relatorio nao encontrado.");
  }
}

export async function GET(_, { params }) {
  await requireAuth();
  await ensureSchema();
  const resolvedParams = await params;
  const tipo = String(resolvedParams.tipo || "");
  const url = new URL(_.url);
  const filters = {
    dateFrom: url.searchParams.get("dateFrom") || "",
    dateTo: url.searchParams.get("dateTo") || "",
    customerId: url.searchParams.get("customerId") ? Number(url.searchParams.get("customerId")) : null
  };
  const definition = await getReportDefinition(tipo, filters);
  const pdfBuffer = await buildReportPdf(definition);

  return new Response(pdfBuffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="relatorio-${tipo}.pdf"`,
      "Content-Length": String(pdfBuffer.byteLength),
      "Cache-Control": "no-store"
    }
  });
}
