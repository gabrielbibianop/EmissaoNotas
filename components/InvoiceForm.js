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

function buildInvoiceNotes(baseNotes, funruralMode, funruralPercent, funruralValue) {
  const normalizedNotes = String(baseNotes || "").trim();

  if (funruralMode !== "desconta_informa" || Number(funruralValue || 0) <= 0) {
    return normalizedNotes;
  }

  const funruralNote = `Funrural descontado a ${formatMoney(funruralPercent)}% no valor de R$ ${formatMoney(funruralValue)}.`;
  return normalizedNotes ? `${normalizedNotes}\n${funruralNote}` : funruralNote;
}

function getSaoPauloDateTimeDefaults() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value])
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function createItem(overrides = {}) {
  return {
    productId: "",
    productCode: "",
    description: "",
    cbenef: "",
    unit: "UN",
    cfop: "5102",
    st: "00",
    classFiscal: "",
    quantity: "1",
    unitValue: "0,00",
    icmsAliquot: "18,00",
    ipiAliquot: "0,00",
    ...overrides
  };
}

function calculateItem(item) {
  const quantityNumber = parseMoney(item.quantity) || 0;
  const unitValueNumber = parseMoney(item.unitValue);
  const subtotal = quantityNumber * unitValueNumber;
  const icmsRate = parseMoney(item.icmsAliquot);
  const ipiRate = parseMoney(item.ipiAliquot);
  const icmsValue = (subtotal * icmsRate) / 100;
  const ipiValue = (subtotal * ipiRate) / 100;

  return {
    ...item,
    subtotal,
    icmsValue,
    ipiValue
  };
}

function ActionButtons({ saveInvoiceDraft, createInvoiceAndSend, isEditing = false }) {
  return (
    <div className="action-row">
      <FormSubmitButton
        formAction={saveInvoiceDraft}
        idleText={isEditing ? "Salvar alteracoes" : "Gravar rascunho"}
        pendingText={isEditing ? "Salvando..." : "Gravando..."}
      />
      {!isEditing ? (
        <FormSubmitButton formAction={createInvoiceAndSend} idleText="Assinar e enviar NF-e" pendingText="Assinando e enviando..." />
      ) : null}
    </div>
  );
}

function InstallmentRow({ index }) {
  return (
    <div className="invoice-mini-grid">
      <label>
        Parcela
        <input name={`parc${index}`} placeholder={String(index)} />
      </label>
      <label>
        Vencimento
        <input name={`venc${index}`} type="date" />
      </label>
      <label>
        Valor
        <input name={`val${index}`} placeholder="0,00" />
      </label>
    </div>
  );
}

export function InvoiceForm({
  companies,
  customers,
  products,
  saveInvoiceDraft,
  createInvoiceAndSend,
  errorMessage,
  initialData = null
}) {
  const currentDateTime = useMemo(() => getSaoPauloDateTimeDefaults(), []);
  const meta = initialData?.invoiceMeta || {};
  const initialEnvironmentMode = meta.environmentMode || "homologacao";
  const initialItems = Array.isArray(meta.items) && meta.items.length > 0
    ? meta.items.map((item) => ({
        ...createItem(),
        ...item,
        productId: item.productId ? String(item.productId) : "",
        unitValue: formatMoney(item.unitValue || 0),
        icmsAliquot: formatMoney(item.icmsAliquot || 0),
        ipiAliquot: formatMoney(item.ipiAliquot || 0),
        quantity: String(item.quantity || "1")
      }))
    : [];
  const [companyId, setCompanyId] = useState(String(initialData?.companyId || ""));
  const [customerId, setCustomerId] = useState(String(initialData?.customerId || ""));
  const [items, setItems] = useState(initialItems);
  const [editingIndex, setEditingIndex] = useState(null);
  const [draftItem, setDraftItem] = useState(createItem());
  const [discountValue, setDiscountValue] = useState(formatMoney(meta.discountValue || 0));
  const [freightValue, setFreightValue] = useState(formatMoney(meta.freightValue || 0));
  const [insuranceValue, setInsuranceValue] = useState(formatMoney(meta.insuranceValue || 0));
  const [otherValue, setOtherValue] = useState(formatMoney(meta.otherValue || 0));
  const [funruralMode, setFunruralMode] = useState(meta.funruralMode || "nao_desconta_nao_informa");
  const [funruralPercent, setFunruralPercent] = useState(formatMoney(meta.funruralPercent || 0));
  const [notes, setNotes] = useState(initialData?.notes || "");
  const [collapsedSections, setCollapsedSections] = useState({
    bloco1: false,
    bloco2: false,
    bloco3: false,
    bloco4: false
  });

  const currentItem = useMemo(() => calculateItem(draftItem), [draftItem]);
  const itemsWithCalc = useMemo(() => items.map((item) => calculateItem(item)), [items]);

  const totalProducts = itemsWithCalc.reduce((sum, item) => sum + item.subtotal, 0);
  const baseCalc = totalProducts;
  const icmsValue = itemsWithCalc.reduce((sum, item) => sum + item.icmsValue, 0);
  const ipiValue = itemsWithCalc.reduce((sum, item) => sum + item.ipiValue, 0);
  const discount = parseMoney(discountValue);
  const freight = parseMoney(freightValue);
  const insurance = parseMoney(insuranceValue);
  const other = parseMoney(otherValue);
  const funruralRate = parseMoney(funruralPercent);
  const funruralValue = funruralMode === "nao_desconta_nao_informa"
    ? 0
    : (totalProducts * funruralRate) / 100;
  const totalInvoice = totalProducts - discount + freight + insurance + other + ipiValue - funruralValue;
  const notesWithFunrural = buildInvoiceNotes(notes, funruralMode, funruralRate, funruralValue);

  const serializedItems = JSON.stringify(
    itemsWithCalc.map(({ subtotal, icmsValue: itemIcmsValue, ipiValue: itemIpiValue, ...item }) => ({
      ...item,
      subtotalValue: Number(subtotal.toFixed(2)),
      icmsValue: Number(itemIcmsValue.toFixed(2)),
      ipiValue: Number(itemIpiValue.toFixed(2))
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
      classFiscal: product.ncm || "",
      cbenef: product.cbenef || "",
      unitValue: formatMoney(product.price || 0)
    });
  }

  function resetDraft() {
    setDraftItem(createItem());
    setEditingIndex(null);
  }

  function saveDraftItem() {
    if (!draftItem.description.trim() && !draftItem.productCode.trim() && !draftItem.productId) {
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

  function deleteItem(index) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));

    if (editingIndex === index) {
      resetDraft();
    } else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex((current) => current - 1);
    }
  }

  function toggleSection(sectionKey) {
    setCollapsedSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey]
    }));
  }

  return (
    <form action={saveInvoiceDraft} className="invoice-shell">
      {initialData?.id ? <input type="hidden" name="id" value={initialData.id} /> : null}
      {initialData?.saleId ? <input type="hidden" name="saleId" value={initialData.saleId} /> : null}
      <input type="hidden" name="itemsPayload" value={serializedItems} />
      <input type="hidden" name="productId" value={items[0]?.productId || ""} />

      <section className="invoice-hero panel">
        <div>
          <p className="eyebrow">Painel operacional</p>
          <h3>Emissao, assinatura e transmissao</h3>
          <p className="section-copy">
            {initialData?.id
              ? "Edite a nota carregada, ajuste os produtos na grade e salve as alteracoes."
              : "A tela abre sempre limpa para uma nova nota. Os produtos entram primeiro na grade e depois seguem para o envio."}
          </p>
          {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
        </div>

        <div className="environment-grid">
          <label className="environment-card">
            <input type="radio" name="environmentMode" value="homologacao" defaultChecked={initialEnvironmentMode === "homologacao"} />
            <span>Homologacao</span>
            <small>Testes com SEFAZ sem valor fiscal definitivo.</small>
          </label>
          <label className="environment-card">
            <input type="radio" name="environmentMode" value="producao" defaultChecked={initialEnvironmentMode === "producao"} />
            <span>Producao</span>
            <small>Emissao valida. Use somente com cadastro fiscal completo.</small>
          </label>
        </div>
      </section>

      <section className="invoice-board">
        <article className="panel invoice-section">
          <div className="invoice-section-head">
            <div>
              <p className="eyebrow">Bloco 01</p>
              <h3>Numero / data / destinatario</h3>
            </div>
            <button type="button" className="button secondary small" onClick={() => toggleSection("bloco1")}>
              {collapsedSections.bloco1 ? "Expandir" : "Minimizar"}
            </button>
          </div>

          {!collapsedSections.bloco1 ? (
          <div className="form-grid">
            <label>
              Empresa emissora
              <select name="companyId" required value={companyId || String(initialData?.companyId || "")} onChange={(event) => setCompanyId(event.target.value)}>
                <option value="" disabled>Selecione</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.trade_name || company.legal_name} | Certificado {company.certificate_name ? "OK" : "pendente"} | {company.city || "-"}{company.state ? `/${company.state}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cliente
              <select name="customerId" required value={customerId || String(initialData?.customerId || "")} onChange={(event) => setCustomerId(event.target.value)}>
                <option value="" disabled>Selecione</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.full_name} | {customer.document} | {customer.city || "-"}{customer.state ? `/${customer.state}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Operacao
              <select name="operationMode" defaultValue={meta.operationMode || "emissao"}>
                <option value="emissao">Emissao</option>
                <option value="lancamento">Lancamento</option>
              </select>
            </label>
            <label>
              Tipo de NF
              <select name="nfType" defaultValue={meta.nfType || "saida"}>
                <option value="saida">Saida</option>
                <option value="entrada">Entrada</option>
              </select>
            </label>
            <label>
              Status inicial
              <select name="status" defaultValue={initialData?.status || "XML gerado"}>
                <option>XML gerado</option>
                <option>Digitada</option>
                <option>Validada</option>
              </select>
            </label>
            <label>
              Tipo de emissao
              <select name="fiscalCode" defaultValue={meta.fiscalCode || "000"}>
                <option value="000">000 - Normal</option>
                <option value="001">001 - Ajuste</option>
              </select>
            </label>
            <label>
              Numero da nota
              <input name="number" placeholder="Automatico se vazio" defaultValue={initialData?.number || ""} />
            </label>
            <label>
              Serie
              <input name="series" placeholder="Serie da empresa se vazio" defaultValue={initialData?.series || "1"} />
            </label>
            <label className="full">
              Chave de acesso
              <input name="accessKey" placeholder="Gerada automaticamente" defaultValue={initialData?.accessKey || ""} />
            </label>
            <label>
              Data de emissao
              <input
                name="issueDate"
                type="date"
                required
                defaultValue={initialData?.issueDate || currentDateTime.date}
              />
            </label>
            <label>
              Hora da emissao
              <input name="issueTime" type="time" defaultValue={meta.issueTime || currentDateTime.time} />
            </label>
            <label>
              Data de saida/entrada
              <input name="dispatchDate" type="date" defaultValue={meta.dispatchDate || initialData?.issueDate || currentDateTime.date} />
            </label>
            <label>
              Hora de saida/entrada
              <input name="dispatchTime" type="time" defaultValue={meta.dispatchTime || currentDateTime.time} />
            </label>
            <label className="full">
              Natureza da operacao
              <input name="nature" placeholder="Venda de mercadoria adquirida de terceiros" defaultValue={meta.nature || "Venda de mercadoria adquirida de terceiros"} />
            </label>
            <label>
              CFOP geral
              <input name="cfopCode" placeholder="5102" defaultValue={meta.cfopCode || "5102"} />
            </label>
            <label>
              Forma de pagamento
              <input name="paymentMethod" placeholder="A vista / A prazo" defaultValue={meta.paymentMethod || "A vista"} />
            </label>
            <label>
              Tipo de pagamento
              <input name="paymentType" placeholder="PIX, boleto, transferencia, credito..." defaultValue={meta.paymentType || "PIX"} />
            </label>
            <label>
              Presenca comprador
              <input name="buyerPresence" placeholder="1" defaultValue={meta.buyerPresence || "1"} />
            </label>
            <label>
              Documento referenciado
              <input name="docRef" placeholder="Usar em devolucao/complementar" defaultValue={meta.docRef || ""} />
            </label>
            <label>
              Codigo pais
              <input name="countryCode" defaultValue={meta.countryCode || "1058"} />
            </label>
            <label>
              Nome pais
              <input name="countryName" defaultValue={meta.countryName || "Brasil"} />
            </label>
            <label>
              Codigo SUFRAMA
              <input name="suframaCode" defaultValue={meta.suframaCode || ""} />
            </label>
            <label>
              UF embarque
              <input name="embarkState" maxLength="2" defaultValue={meta.embarkState || ""} />
            </label>
            <label className="full">
              Local embarque
              <input name="embarkLocation" defaultValue={meta.embarkLocation || ""} />
            </label>
          </div>
          ) : null}
        </article>

        <article className="panel invoice-section">
          <div className="invoice-section-head">
            <div>
              <p className="eyebrow">Bloco 02</p>
              <h3>Dados produtos</h3>
            </div>
            <button type="button" className="button secondary small" onClick={() => toggleSection("bloco2")}>
              {collapsedSections.bloco2 ? "Expandir" : "Minimizar"}
            </button>
          </div>

          {!collapsedSections.bloco2 ? (
          <>
          <div className="invoice-item-card">
            <div className="invoice-item-head">
              <div>
                <p className="eyebrow">{editingIndex === null ? "Novo item" : `Editando item ${editingIndex + 1}`}</p>
                <h4>{currentItem.description || "Preencha e adicione ao grid"}</h4>
              </div>
              <div className="table-actions">
                {editingIndex !== null ? (
                  <button type="button" className="button secondary small" onClick={resetDraft}>
                    Cancelar edicao
                  </button>
                ) : null}
                <button type="button" className="button primary small" onClick={saveDraftItem}>
                  {editingIndex === null ? "Adicionar no grid" : "Salvar alteracao"}
                </button>
              </div>
            </div>

            <div className="form-grid compact-grid">
              <label>
                Produto relacionado
                <select value={draftItem.productId} onChange={(event) => handleProductChange(event.target.value)}>
                  <option value="">Opcional</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} | {product.sku} | R$ {Number(product.price || 0).toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Codigo produto
                <input value={draftItem.productCode} onChange={(event) => updateDraftItem({ productCode: event.target.value })} placeholder="SKU / codigo interno" />
              </label>
              <label className="full">
                Descricao do produto
                <input value={draftItem.description} onChange={(event) => updateDraftItem({ description: event.target.value })} placeholder="Descricao fiscal do item" />
              </label>
              <label>
                Unidade
                <input value={draftItem.unit} onChange={(event) => updateDraftItem({ unit: event.target.value })} placeholder="UN" />
              </label>
              <label>
                CFOP item
                <input value={draftItem.cfop} onChange={(event) => updateDraftItem({ cfop: event.target.value })} placeholder="5102" />
              </label>
              <label>
                Situacao tributaria
                <input value={draftItem.st} onChange={(event) => updateDraftItem({ st: event.target.value })} placeholder="00" />
              </label>
              <label>
                Classificacao fiscal / NCM
                <input value={draftItem.classFiscal} onChange={(event) => updateDraftItem({ classFiscal: event.target.value })} placeholder="00000000" />
              </label>
              <label>
                CBenef
                <input value={draftItem.cbenef} onChange={(event) => updateDraftItem({ cbenef: event.target.value })} placeholder="Preencha se o beneficio fiscal exigir" />
              </label>
              <label>
                Quantidade
                <input value={draftItem.quantity} onChange={(event) => updateDraftItem({ quantity: event.target.value })} placeholder="1,0000" />
              </label>
              <label>
                Valor unitario
                <input value={draftItem.unitValue} onChange={(event) => updateDraftItem({ unitValue: event.target.value })} placeholder="0,00" />
              </label>
              <label>
                Subtotal
                <input value={formatMoney(currentItem.subtotal)} readOnly placeholder="0,00" />
              </label>
              <label>
                Aliq. ICMS (%)
                <input value={draftItem.icmsAliquot} onChange={(event) => updateDraftItem({ icmsAliquot: event.target.value })} placeholder="18,00" />
              </label>
              <label>
                Aliq. IPI (%)
                <input value={draftItem.ipiAliquot} onChange={(event) => updateDraftItem({ ipiAliquot: event.target.value })} placeholder="0,00" />
              </label>
            </div>
          </div>

          <div className="invoice-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Produto</th>
                  <th>Qtd.</th>
                  <th>Unit.</th>
                  <th>Subtotal</th>
                  <th>Acoes</th>
                </tr>
              </thead>
              <tbody>
                {itemsWithCalc.length === 0 ? (
                  <tr>
                    <td colSpan="6">Nenhum produto adicionado na nota ainda.</td>
                  </tr>
                ) : (
                  itemsWithCalc.map((item, index) => (
                    <tr key={`${item.productCode}-${index}`}>
                      <td>{index + 1}</td>
                      <td>{item.description || item.productCode || "-"}</td>
                      <td>{item.quantity || "-"}</td>
                      <td>R$ {formatMoney(item.unitValue)}</td>
                      <td>R$ {formatMoney(item.subtotal)}</td>
                      <td>
                        <div className="table-actions">
                          <button type="button" className="button secondary small" onClick={() => editItem(index)}>
                            Alterar
                          </button>
                          <button type="button" className="button danger small" onClick={() => deleteItem(index)}>
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

          <div className="form-grid compact-grid">
            <label>
              Valor total
              <input name="totalValue" value={formatMoney(totalInvoice)} readOnly placeholder="0,00" />
            </label>
            <label>
              Arquivo complementar
              <input name="invoiceFile" type="file" accept=".xml,.pdf,application/pdf,text/xml,application/xml" />
            </label>
          </div>
          </>
          ) : null}
        </article>

        <article className="panel invoice-section">
          <div className="invoice-section-head">
            <div>
              <p className="eyebrow">Bloco 03</p>
              <h3>Totais / transporte / faturamento</h3>
            </div>
            <button type="button" className="button secondary small" onClick={() => toggleSection("bloco3")}>
              {collapsedSections.bloco3 ? "Expandir" : "Minimizar"}
            </button>
          </div>

          {!collapsedSections.bloco3 ? (
          <div className="invoice-columns">
            <div className="invoice-stack">
              <div className="invoice-card">
                <h4>Totais da nota fiscal</h4>
                <div className="form-grid compact-grid">
                  <label>
                    Desconto
                    <input name="discountValue" value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} placeholder="0,00" />
                  </label>
                  <label>
                    Base calculo ICMS
                    <input name="baseCalcValue" value={formatMoney(baseCalc)} readOnly placeholder="0,00" />
                  </label>
                  <label>
                    Valor ICMS
                    <input name="icmsValue" value={formatMoney(icmsValue)} readOnly placeholder="0,00" />
                  </label>
                  <label>
                    Base calc. ST
                    <input name="baseCalcStValue" value="0,00" readOnly placeholder="0,00" />
                  </label>
                  <label>
                    Valor ICMS ST
                    <input name="icmsStValue" value="0,00" readOnly placeholder="0,00" />
                  </label>
                  <label>
                    Valor IPI
                    <input name="ipiValue" value={formatMoney(ipiValue)} readOnly placeholder="0,00" />
                  </label>
                  <label>
                    Valor frete
                    <input name="freightValue" value={freightValue} onChange={(event) => setFreightValue(event.target.value)} placeholder="0,00" />
                  </label>
                  <label>
                    Valor seguro
                    <input name="insuranceValue" value={insuranceValue} onChange={(event) => setInsuranceValue(event.target.value)} placeholder="0,00" />
                  </label>
                  <label>
                    Outras despesas
                    <input name="otherValue" value={otherValue} onChange={(event) => setOtherValue(event.target.value)} placeholder="0,00" />
                  </label>
                  <label>
                    Funrural
                    <select name="funruralMode" value={funruralMode} onChange={(event) => setFunruralMode(event.target.value)}>
                      <option value="desconta_informa">Desconta e informa na observacao</option>
                      <option value="desconta_nao_informa">Desconta mas nao informa</option>
                      <option value="nao_desconta_nao_informa">Nao desconta nem informa</option>
                    </select>
                  </label>
                  <label>
                    % Funrural
                    <input name="funruralPercent" value={funruralPercent} onChange={(event) => setFunruralPercent(event.target.value)} placeholder="0,00" />
                  </label>
                  <label>
                    Valor Funrural
                    <input name="funruralValue" value={formatMoney(funruralValue)} readOnly placeholder="0,00" />
                  </label>
                  <label>
                    Total produtos
                    <input name="totalProductsValue" value={formatMoney(totalProducts)} readOnly placeholder="0,00" />
                  </label>
                  <label>
                    Valor total NF
                    <input name="totalInvoiceValue" value={formatMoney(totalInvoice)} readOnly placeholder="0,00" />
                  </label>
                </div>
              </div>

              <div className="invoice-card">
                <h4>Transportador</h4>
                <div className="form-grid compact-grid">
                  <label>
                    Modalidade frete
                    <select name="transportFreightMode" defaultValue={meta.transport?.freightMode || "9"}>
                      <option value="9">9 - Sem transporte</option>
                      <option value="0">0 - CIF</option>
                      <option value="1">1 - FOB</option>
                      <option value="2">2 - Terceiros</option>
                      <option value="3">3 - Proprio remetente</option>
                      <option value="4">4 - Proprio destinatario</option>
                    </select>
                  </label>
                  <label>
                    Codigo transportadora
                    <input name="transportCode" defaultValue={meta.transport?.code || ""} />
                  </label>
                  <label className="full">
                    Nome transportadora
                    <input name="transportName" defaultValue={meta.transport?.name || ""} />
                  </label>
                  <label className="full">
                    Endereco
                    <input name="transportAddress" defaultValue={meta.transport?.address || ""} />
                  </label>
                  <label>
                    Cidade
                    <input name="transportCity" defaultValue={meta.transport?.city || ""} />
                  </label>
                  <label>
                    UF
                    <input name="transportState" maxLength="2" defaultValue={meta.transport?.state || ""} />
                  </label>
                  <label>
                    CNPJ/CPF
                    <input name="transportCnpj" defaultValue={meta.transport?.cnpj || ""} />
                  </label>
                  <label>
                    IE/RG
                    <input name="transportStateRegistration" defaultValue={meta.transport?.stateRegistration || ""} />
                  </label>
                  <label>
                    Placa
                    <input name="transportPlate" defaultValue={meta.transport?.plate || ""} />
                  </label>
                  <label>
                    UF placa
                    <input name="transportPlateState" maxLength="2" defaultValue={meta.transport?.plateState || ""} />
                  </label>
                  <label>
                    Quant. volumes
                    <input name="transportQuantity" defaultValue={meta.transport?.quantity || ""} />
                  </label>
                  <label>
                    Especie
                    <input name="transportSpecie" defaultValue={meta.transport?.specie || ""} />
                  </label>
                  <label>
                    Marca
                    <input name="transportBrand" defaultValue={meta.transport?.brand || ""} />
                  </label>
                  <label>
                    Peso bruto
                    <input name="transportGrossWeight" defaultValue={meta.transport?.grossWeight || ""} />
                  </label>
                  <label>
                    Peso liquido
                    <input name="transportNetWeight" defaultValue={meta.transport?.netWeight || ""} />
                  </label>
                </div>
              </div>
            </div>

            <div className="invoice-stack">
              <div className="invoice-card">
                <h4>Faturamento</h4>
                <div className="invoice-stack">
                  {[1, 2, 3, 4, 5].map((index) => <InstallmentRow key={index} index={index} />)}
                </div>
              </div>
              <div className="invoice-card">
                <h4>Parcelas complementares</h4>
                <div className="invoice-stack">
                  {[6, 7, 8, 9, 10].map((index) => <InstallmentRow key={index} index={index} />)}
                </div>
              </div>
            </div>
          </div>
          ) : null}
        </article>

        <article className="panel invoice-section">
          <div className="invoice-section-head">
            <div>
              <p className="eyebrow">Bloco 04</p>
              <h3>Observacoes e transmissao</h3>
            </div>
            <button type="button" className="button secondary small" onClick={() => toggleSection("bloco4")}>
              {collapsedSections.bloco4 ? "Expandir" : "Minimizar"}
            </button>
          </div>

          {!collapsedSections.bloco4 ? (
          <>
          <div className="form-grid">
            <input type="hidden" name="notes" value={notesWithFunrural} />
            <label className="full">
              Observacoes da nota
              <textarea
                rows="5"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Informacoes complementares, observacoes do fisco e historico interno"
              />
            </label>
            {notesWithFunrural && notesWithFunrural !== notes ? (
              <label className="full">
                Observacao final enviada
                <textarea rows="4" value={notesWithFunrural} readOnly />
              </label>
            ) : null}
          </div>

          <ActionButtons saveInvoiceDraft={saveInvoiceDraft} createInvoiceAndSend={createInvoiceAndSend} isEditing={Boolean(initialData?.id)} />
          </>
          ) : null}
        </article>
      </section>
    </form>
  );
}
