import { createMaintenance, updateMaintenanceStatus } from "@/app/actions";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { ensureSchema, query } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

async function getMaintenanceData() {
  await ensureSchema();

  const [customers, orders, summary] = await Promise.all([
    query(`
      SELECT id, full_name, document
      FROM customers
      ORDER BY full_name
    `),
    query(`
      SELECT
        maintenance_orders.id,
        maintenance_orders.equipment,
        maintenance_orders.serial_number,
        maintenance_orders.problem_description,
        maintenance_orders.service_description,
        maintenance_orders.status,
        maintenance_orders.total_value,
        maintenance_orders.notes,
        maintenance_orders.created_at,
        customers.full_name AS customer_full_name
      FROM maintenance_orders
      LEFT JOIN customers ON customers.id = maintenance_orders.customer_id
      ORDER BY maintenance_orders.created_at DESC
      LIMIT 20
    `),
    query(`
      SELECT
        COUNT(*)::int AS total_orders,
        COUNT(*) FILTER (WHERE status = 'aberta')::int AS open_orders,
        COUNT(*) FILTER (WHERE status = 'em_execucao')::int AS in_progress,
        COUNT(*) FILTER (WHERE status = 'entregue')::int AS delivered
      FROM maintenance_orders
    `)
  ]);

  return {
    customers: customers.rows,
    orders: orders.rows,
    summary: summary.rows[0]
  };
}

export default async function MaintenancePage({ searchParams }) {
  const { customers, orders, summary } = await getMaintenanceData();
  const params = await searchParams;
  const errorMessage = params?.error ? decodeURIComponent(String(params.error)) : null;
  const successMessage = params?.success ? decodeURIComponent(String(params.success)) : null;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Venda</p>
          <h2>Modulo de manutencao</h2>
          <p className="section-copy">
            Controle as entradas de equipamentos, o servico executado e o andamento da entrega ao cliente.
          </p>
        </div>
      </header>

      <div className="stats-grid">
        <article className="stat-card">
          <span>Ordens</span>
          <strong>{summary.total_orders}</strong>
        </article>
        <article className="stat-card">
          <span>Abertas</span>
          <strong>{summary.open_orders}</strong>
        </article>
        <article className="stat-card">
          <span>Em execucao</span>
          <strong>{summary.in_progress}</strong>
        </article>
        <article className="stat-card">
          <span>Entregues</span>
          <strong>{summary.delivered}</strong>
        </article>
      </div>

      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <div className="two-columns">
        <form action={createMaintenance} className="panel form-panel">
          <h3>Nova ordem</h3>
          <div className="form-grid">
            <label>
              Cliente
              <select name="customerId" required>
                <option value="">Selecione</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.full_name} | {customer.document}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Equipamento
              <input name="equipment" placeholder="Notebook, impressora, celular..." required />
            </label>
            <label>
              Serie / patrimonio
              <input name="serialNumber" placeholder="Numero de serie" />
            </label>
            <label>
              Status inicial
              <select name="status" defaultValue="aberta">
                <option value="aberta">Aberta</option>
                <option value="em_execucao">Em execucao</option>
                <option value="aguardando_peca">Aguardando peca</option>
                <option value="entregue">Entregue</option>
              </select>
            </label>
            <label className="full">
              Defeito informado
              <textarea name="problemDescription" rows="4" placeholder="Relato do cliente" />
            </label>
            <label className="full">
              Servico executado
              <textarea name="serviceDescription" rows="4" placeholder="Preencher durante ou ao final da manutencao" />
            </label>
            <label>
              Valor
              <input name="totalValue" placeholder="0,00" />
            </label>
            <label className="full">
              Observacoes
              <textarea name="notes" rows="3" placeholder="Pecas, prazo, garantia..." />
            </label>
          </div>

          <div className="action-row">
            <FormSubmitButton idleText="Salvar ordem" pendingText="Salvando..." />
          </div>
        </form>

        <section className="panel list-panel">
          <h3>Ordens recentes</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Equipamento</th>
                  <th>Status</th>
                  <th>Valor</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan="6">Nenhuma ordem de manutencao registrada.</td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id}>
                      <td>{formatDate(order.created_at)}</td>
                      <td>{order.customer_full_name || "-"}</td>
                      <td>
                        <strong>{order.equipment}</strong>
                        <div>{order.serial_number || "-"}</div>
                      </td>
                      <td><span className="status-pill subtle">{order.status}</span></td>
                      <td>{formatCurrency(order.total_value)}</td>
                      <td>
                        <div className="table-actions">
                          <form action={updateMaintenanceStatus}>
                            <input type="hidden" name="id" value={order.id} />
                            <input type="hidden" name="status" value="em_execucao" />
                            <button type="submit" className="button secondary small">Em execucao</button>
                          </form>
                          <form action={updateMaintenanceStatus}>
                            <input type="hidden" name="id" value={order.id} />
                            <input type="hidden" name="status" value="entregue" />
                            <button type="submit" className="button secondary small">Entregar</button>
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
      </div>
    </section>
  );
}
