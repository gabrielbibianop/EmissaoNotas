import { saveStockMovement } from "@/app/actions";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { ensureSchema, query } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

function getErrorMessage(error) {
  if (!error) {
    return null;
  }

  return decodeURIComponent(String(error));
}

function getStockStatus(stock) {
  const total = Number(stock || 0);

  if (total <= 0) {
    return { label: "Sem estoque", className: "status-pill subtle" };
  }

  if (total <= 5) {
    return { label: "Estoque baixo", className: "status-pill" };
  }

  return { label: "Disponivel", className: "status-pill" };
}

function formatMovementQuantity(movement) {
  const quantity = Number(movement.quantity || 0);

  if (movement.movement_type === "saida") {
    return `- ${quantity}`;
  }

  if (movement.movement_type === "entrada") {
    return `+ ${quantity}`;
  }

  return `Ajuste (${movement.previous_stock} -> ${movement.resulting_stock})`;
}

async function getStockData() {
  await ensureSchema();

  const [products, movements, summary] = await Promise.all([
    query(`
      SELECT id, name, sku, stock, price, created_at
      FROM products
      ORDER BY stock ASC, name ASC
    `),
    query(`
      SELECT
        stock_movements.id,
        stock_movements.movement_type,
        stock_movements.quantity,
        stock_movements.previous_stock,
        stock_movements.resulting_stock,
        stock_movements.notes,
        stock_movements.created_at,
        products.name AS product_name,
        products.sku AS product_sku
      FROM stock_movements
      INNER JOIN products ON products.id = stock_movements.product_id
      ORDER BY stock_movements.created_at DESC
      LIMIT 20
    `),
    query(`
      SELECT
        COUNT(*)::int AS total_products,
        COALESCE(SUM(stock), 0)::int AS total_units,
        COUNT(*) FILTER (WHERE stock <= 5 AND stock > 0)::int AS low_stock,
        COUNT(*) FILTER (WHERE stock <= 0)::int AS out_of_stock
      FROM products
    `)
  ]);

  return {
    products: products.rows,
    movements: movements.rows,
    summary: summary.rows[0]
  };
}

export default async function StockPage({ searchParams }) {
  const { products, movements, summary } = await getStockData();
  const params = await searchParams;
  const errorMessage = getErrorMessage(params?.error);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operacao</p>
          <h2>Estoque</h2>
          <p className="section-copy">
            Registre entradas, saidas e ajustes manuais para manter o saldo dos produtos consistente antes da emissao.
          </p>
        </div>
      </header>

      <div className="stats-grid">
        <article className="stat-card">
          <span>Produtos controlados</span>
          <strong>{summary.total_products}</strong>
        </article>
        <article className="stat-card">
          <span>Unidades em estoque</span>
          <strong>{summary.total_units}</strong>
        </article>
        <article className="stat-card">
          <span>Estoque baixo</span>
          <strong>{summary.low_stock}</strong>
        </article>
        <article className="stat-card">
          <span>Sem saldo</span>
          <strong>{summary.out_of_stock}</strong>
        </article>
      </div>

      <div className="two-columns">
        <form action={saveStockMovement} className="panel form-panel">
          <h3>Nova movimentacao</h3>
          <p className="section-copy">
            Use entrada para reposicao, saida para baixa manual e ajuste para corrigir o saldo final do produto.
          </p>
          {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

          <div className="form-grid">
            <label className="full">
              Produto
              <select name="productId" required>
                <option value="">Selecione</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} | {product.sku} | saldo atual {product.stock}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tipo
              <select name="movementType" defaultValue="entrada">
                <option value="entrada">Entrada</option>
                <option value="saida">Saida</option>
                <option value="ajuste">Ajuste de saldo</option>
              </select>
            </label>
            <label>
              Quantidade
              <input name="quantity" type="number" min="0" step="1" placeholder="Ex.: 10" required />
            </label>
            <label className="full">
              Observacao
              <textarea
                name="notes"
                rows="4"
                placeholder="Motivo da movimentacao, referencia de compra, baixa interna..."
              />
            </label>
          </div>

          <div className="action-row">
            <FormSubmitButton idleText="Salvar movimentacao" pendingText="Salvando..." />
          </div>
        </form>

        <section className="panel list-panel">
          <h3>Saldos atuais</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th>Saldo</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr>
                    <td colSpan="4">Nenhum produto cadastrado para controlar estoque.</td>
                  </tr>
                ) : (
                  products.map((product) => {
                    const status = getStockStatus(product.stock);

                    return (
                      <tr key={product.id}>
                        <td>{product.name}</td>
                        <td>{product.sku}</td>
                        <td>{product.stock}</td>
                        <td><span className={status.className}>{status.label}</span></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="panel list-panel">
        <h3>Ultimas movimentacoes</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Produto</th>
                <th>Tipo</th>
                <th>Movimento</th>
                <th>Saldo</th>
                <th>Observacao</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan="6">Nenhuma movimentacao registrada ainda.</td>
                </tr>
              ) : (
                movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatDate(movement.created_at)}</td>
                    <td>
                      <strong>{movement.product_name}</strong>
                      <div>{movement.product_sku}</div>
                    </td>
                    <td>{movement.movement_type}</td>
                    <td>{formatMovementQuantity(movement)}</td>
                    <td>{movement.previous_stock} {"->"} {movement.resulting_stock}</td>
                    <td>{movement.notes || "-"}</td>
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
