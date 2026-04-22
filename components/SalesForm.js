"use client";

import { useMemo, useState } from "react";
import { FormSubmitButton } from "@/components/FormSubmitButton";

function parseMoney(value) {
  const raw = String(value ?? "").trim();

  if (!raw) return 0;
  if (raw.includes(",") && raw.includes(".")) {
    return Number(raw.replace(/\./g, "").replace(",", "."));
  }
  if (raw.includes(",")) {
    return Number(raw.replace(",", "."));
  }

  return Number(raw);
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2).replace(".", ",");
}

function getSaoPauloDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(new Date());
}

function createItem(overrides = {}) {
  return {
    productId: "",
    productCode: "",
    description: "",
    unit: "UN",
    quantity: "1",
    unitPrice: "0,00",
    ncm: "",
    cfop: "5102",
    st: "00",
    icmsAliquot: "18,00",
    ipiAliquot: "0,00",
    ...overrides
  };
}

function calculateItem(item) {
  const quantity = parseMoney(item.quantity);
  const unitPrice = parseMoney(item.unitPrice);

  return {
    ...item,
    totalPrice: quantity * unitPrice
  };
}

export function SalesForm({ companies, customers, products, action, errorMessage }) {
  const [items, setItems] = useState([]);
  const [draftItem, setDraftItem] = useState(createItem());
  const [editingIndex, setEditingIndex] = useState(null);
  const calculatedItems = useMemo(() => items.map((item) => calculateItem(item)), [items]);
  const totalValue = calculatedItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const serializedItems = JSON.stringify(
    calculatedItems.map((item) => ({
      ...item,
      quantity: parseMoney(item.quantity),
      unitPrice: parseMoney(item.unitPrice),
      totalPrice: Number(item.totalPrice.toFixed(2))
    }))
  );

  function updateDraftItem(patch) {
    setDraftItem((current) => ({ ...current, ...patch }));
  }

  function handleProductChange(nextProductId) {
    const product = products.find((candidate) => String(candidate.id) === String(nextProductId));

    if (!product) {
      updateDraftItem({ productId: nextProductId });
      return;
    }

    updateDraftItem({
      productId: nextProductId,
      productCode: product.sku || "",
      description: product.name || "",
      unitPrice: formatMoney(product.price || 0),
      ncm: product.ncm || ""
    });
  }

  function resetDraft() {
    setDraftItem(createItem());
    setEditingIndex(null);
  }

  function saveDraftItem() {
    if (!draftItem.description.trim()) {
      return;
    }

    if (editingIndex === null) {
      setItems((current) => [...current, draftItem]);
    } else {
      setItems((current) => current.map((item, index) => (index === editingIndex ? draftItem : item)));
    }

    resetDraft();
  }

  function editItem(index) {
    setDraftItem(items[index]);
    setEditingIndex(index);
  }

  function removeItem(index) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
    if (editingIndex === index) {
      resetDraft();
    }
  }

  return (
    <form action={action} className="invoice-shell">
      <input type="hidden" name="itemsPayload" value={serializedItems} />

      <section className="panel invoice-section">
        <div className="invoice-section-head">
          <div>
            <p className="eyebrow">Venda</p>
            <h3>Nova venda</h3>
            <p className="section-copy">
              Registre a venda, mantenha os itens organizados e gere a NF-e depois com um clique.
            </p>
          </div>
        </div>

        {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

        <div className="form-grid">
          <label>
            Empresa
            <select name="companyId" required>
              <option value="">Selecione</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.trade_name || company.legal_name}
                </option>
              ))}
            </select>
          </label>
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
            Data da venda
            <input name="saleDate" type="date" defaultValue={getSaoPauloDate()} required />
          </label>
          <label>
            Status
            <select name="status" defaultValue="aberta">
              <option value="aberta">Aberta</option>
              <option value="concluida">Concluida</option>
              <option value="faturada">Faturada</option>
            </select>
          </label>
          <label className="full">
            Observacoes
            <textarea name="notes" rows="3" placeholder="Detalhes da venda, combinados, prazo..." />
          </label>
        </div>
      </section>

      <section className="invoice-columns">
        <article className="panel invoice-card">
          <h4>{editingIndex === null ? "Adicionar item" : "Editar item"}</h4>
          <div className="form-grid">
            <label className="full">
              Produto
              <select
                value={draftItem.productId}
                onChange={(event) => handleProductChange(event.target.value)}
              >
                <option value="">Selecione</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} | {product.sku}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Codigo
              <input value={draftItem.productCode} onChange={(event) => updateDraftItem({ productCode: event.target.value })} />
            </label>
            <label>
              NCM
              <input value={draftItem.ncm} onChange={(event) => updateDraftItem({ ncm: event.target.value })} />
            </label>
            <label className="full">
              Descricao
              <input value={draftItem.description} onChange={(event) => updateDraftItem({ description: event.target.value })} />
            </label>
            <label>
              Quantidade
              <input value={draftItem.quantity} onChange={(event) => updateDraftItem({ quantity: event.target.value })} />
            </label>
            <label>
              Unidade
              <input value={draftItem.unit} onChange={(event) => updateDraftItem({ unit: event.target.value })} />
            </label>
            <label>
              Valor unitario
              <input value={draftItem.unitPrice} onChange={(event) => updateDraftItem({ unitPrice: event.target.value })} />
            </label>
            <label>
              CFOP
              <input value={draftItem.cfop} onChange={(event) => updateDraftItem({ cfop: event.target.value })} />
            </label>
          </div>

          <div className="action-row">
            <button type="button" className="button secondary" onClick={saveDraftItem}>
              {editingIndex === null ? "Adicionar item" : "Atualizar item"}
            </button>
            {editingIndex !== null ? (
              <button type="button" className="button secondary" onClick={resetDraft}>
                Cancelar edicao
              </button>
            ) : null}
          </div>
        </article>

        <section className="panel list-panel">
          <h3>Itens da venda</h3>
          <div className="invoice-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Qtd.</th>
                  <th>Unit.</th>
                  <th>Total</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {calculatedItems.length === 0 ? (
                  <tr>
                    <td colSpan="5">Nenhum item adicionado.</td>
                  </tr>
                ) : (
                  calculatedItems.map((item, index) => (
                    <tr key={`${item.productCode}-${index}`}>
                      <td>
                        <strong>{item.description}</strong>
                        <div>{item.productCode}</div>
                      </td>
                      <td>{item.quantity}</td>
                      <td>R$ {formatMoney(item.unitPrice)}</td>
                      <td>R$ {formatMoney(item.totalPrice)}</td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="button secondary small" onClick={() => editItem(index)}>
                            Editar
                          </button>
                          <button type="button" className="button danger small" onClick={() => removeItem(index)}>
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="stacked-meta">
            <strong>Total da venda: R$ {formatMoney(totalValue)}</strong>
            <span>Depois de salvar, a venda aparece pronta para gerar a nota fiscal.</span>
          </div>
        </section>
      </section>

      <div className="action-row">
        <FormSubmitButton idleText="Salvar venda" pendingText="Salvando venda..." />
      </div>
    </form>
  );
}
