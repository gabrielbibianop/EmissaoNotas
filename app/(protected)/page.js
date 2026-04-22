import Link from "next/link";
import { ensureSchema, query } from "@/lib/db";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

async function getDashboardData() {
  await ensureSchema();

  const [customers, companies, products, invoices, totals, sales] = await Promise.all([
    query("SELECT COUNT(*)::int AS total FROM customers"),
    query("SELECT COUNT(*)::int AS total FROM companies"),
    query("SELECT COUNT(*)::int AS total FROM products"),
    query("SELECT COUNT(*)::int AS total FROM invoices"),
    query("SELECT COALESCE(SUM(total_value), 0) AS total FROM invoices"),
    query("SELECT COUNT(*)::int AS total FROM sales")
  ]);

  return {
    customers: customers.rows[0].total,
    companies: companies.rows[0].total,
    products: products.rows[0].total,
    invoices: invoices.rows[0].total,
    billed: totals.rows[0].total,
    sales: sales.rows[0].total
  };
}

export default async function HomePage() {
  const data = await getDashboardData();

  return (
    <section className="page">
      <div className="hero">
        <div>
          <p className="eyebrow">Sistema web para Vercel</p>
          <h2>Gestao fiscal em um so lugar</h2>
          <p className="hero-copy">
            Base pronta em Node.js com PostgreSQL para registrar clientes, empresas, produtos, estoque e manter o historico das notas fiscais enviadas.
          </p>
        </div>

        <div className="hero-actions">
          <Link href="/notas/enviar" className="button primary">Enviar nota</Link>
          <Link href="/vendas" className="button secondary">Registrar venda</Link>
          <Link href="/vendas/busca" className="button secondary">Buscar vendas</Link>
        </div>
      </div>

      <div className="stats-grid">
        <article className="stat-card">
          <span>Clientes</span>
          <strong>{data.customers}</strong>
        </article>
        <article className="stat-card">
          <span>Empresas</span>
          <strong>{data.companies}</strong>
        </article>
        <article className="stat-card">
          <span>Produtos</span>
          <strong>{data.products}</strong>
        </article>
        <article className="stat-card">
          <span>Notas emitidas</span>
          <strong>{data.invoices}</strong>
        </article>
        <article className="stat-card">
          <span>Vendas</span>
          <strong>{data.sales}</strong>
        </article>
      </div>

      <section className="spotlight">
        <div className="spotlight-card warm">
          <p className="eyebrow">Volume fiscal</p>
          <h3>{formatCurrency(data.billed)}</h3>
          <p>Total acumulado em notas registradas no sistema.</p>
        </div>

        <div className="spotlight-card">
          <p className="eyebrow">Fluxo sugerido</p>
          <ol className="steps">
            <li>Cadastre a empresa emissora.</li>
            <li>Cadastre seus clientes.</li>
            <li>Cadastre os produtos.</li>
            <li>Registre a venda.</li>
            <li>Ajuste o estoque quando houver entrada ou saida.</li>
            <li>Gere e envie a nota fiscal com os dados da operacao.</li>
          </ol>
        </div>
      </section>
    </section>
  );
}
