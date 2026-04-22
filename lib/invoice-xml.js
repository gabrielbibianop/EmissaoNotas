function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function pad(value, size) {
  return String(value || "").padStart(size, "0");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeSeries(series) {
  const digits = onlyDigits(series || "1");
  return pad(digits || "1", 3);
}

function normalizeInvoiceNumber(number) {
  const digits = onlyDigits(number || "1");
  return pad(digits || "1", 9);
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function buildAdditionalInfo(notes, meta) {
  const normalizedNotes = String(notes || "").trim();
  const shouldInformFunrural = String(meta.funruralMode || "") === "desconta_informa";
  const funruralValue = Number(meta.funruralValue || 0);

  if (!shouldInformFunrural || funruralValue <= 0) {
    return normalizedNotes;
  }

  const funruralText = `Funrural descontado a ${money(meta.funruralPercent || 0)}% no valor de R$ ${money(funruralValue)}.`;
  return normalizedNotes ? `${normalizedNotes} ${funruralText}` : funruralText;
}

function decimal(value) {
  return Number(value || 0).toFixed(4);
}

function modulo11(value) {
  let weight = 2;
  let total = 0;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    total += Number(value[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }

  const mod = total % 11;
  return mod === 0 || mod === 1 ? 0 : 11 - mod;
}

export function generateAccessKey({ companyCnpj, issueDate, series, number }) {
  const date = new Date(issueDate);
  const yearMonth = `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1, 2)}`;
  const cnpj = pad(onlyDigits(companyCnpj), 14).slice(-14);
  const model = "55";
  const emission = "1";
  const randomCode = pad(Math.floor(Math.random() * 99999999) + 1, 8);
  const base = `35${yearMonth}${cnpj}${model}${normalizeSeries(series)}${normalizeInvoiceNumber(number)}${emission}${randomCode}`;
  const digit = modulo11(base);

  return `${base}${digit}`;
}

export function generateInvoiceXml({
  company,
  customer,
  product,
  products = [],
  invoice
}) {
  const issueDateIso = new Date(invoice.issueDate).toISOString();
  const issueDate = issueDateIso.slice(0, 10);
  const meta = invoice.meta || {};
  const transport = meta.transport || {};
  const installments = Array.isArray(meta.installments) ? meta.installments : [];
  const environmentCode = invoice.environmentMode === "producao" ? "1" : "2";
  const operationNature = meta.nature || "Venda";
  const items = Array.isArray(meta.items) && meta.items.length > 0
    ? meta.items
    : [meta.item || {}];
  const productMap = new Map(products.map((item) => [String(item.id), item]));
  const normalizedItems = items.map((item, index) => {
    const linkedProduct = productMap.get(String(item.productId || "")) || (index === 0 ? product : null);
    const quantity = Number(item.quantity || 1);
    const unitValue = Number(item.unitValue || linkedProduct?.price || 0);
    const subtotal = Number(item.subtotalValue || quantity * unitValue || 0);

    return {
      productCode: item.productCode || linkedProduct?.sku || `ITEM${index + 1}`,
      description: item.description || linkedProduct?.name || "Servico / item avulso",
      classFiscal: item.classFiscal || linkedProduct?.ncm || "00000000",
      cbenef: String(item.cbenef || item.cBenef || linkedProduct?.cbenef || "").trim(),
      cfop: item.cfop || meta.cfopCode || "5102",
      unit: item.unit || linkedProduct?.unit || "UN",
      quantity,
      unitValue,
      subtotal
    };
  });
  const totalProducts = normalizedItems.reduce((sum, item) => sum + item.subtotal, 0);
  const icmsValue = money(meta.icmsValue || 0);
  const ipiValue = money(meta.ipiValue || 0);
  const freightValue = money(meta.freightValue || 0);
  const insuranceValue = money(meta.insuranceValue || 0);
  const otherValue = money(meta.otherValue || 0);
  const discountValue = money((meta.discountValue || 0) + (String(meta.funruralMode || "") !== "nao_desconta_nao_informa" ? Number(meta.funruralValue || 0) : 0));
  const totalInvoiceValue = money(meta.totalInvoiceValue || invoice.totalValue || 0);
  const additionalInfo = buildAdditionalInfo(invoice.notes, meta);
  const cobranca = installments.map(({ parcela, vencimento, valor }, index) => `      <dup><nDup>${escapeXml(parcela || `${invoice.number}-${index + 1}`)}</nDup><dVenc>${escapeXml(vencimento || issueDate)}</dVenc><vDup>${Number(valor || 0).toFixed(2)}</vDup></dup>`).join("\n");
  const detItems = normalizedItems.map((item, index) => `    <det nItem="${index + 1}">
      <prod>
        <cProd>${escapeXml(item.productCode)}</cProd>
        <cEAN></cEAN>
        <xProd>${escapeXml(item.description)}</xProd>
        <NCM>${escapeXml(item.classFiscal)}</NCM>
        ${item.cbenef ? `<cBenef>${escapeXml(item.cbenef)}</cBenef>` : ""}
        <CFOP>${escapeXml(item.cfop)}</CFOP>
        <uCom>${escapeXml(item.unit)}</uCom>
        <qCom>${escapeXml(decimal(item.quantity))}</qCom>
        <vUnCom>${escapeXml(money(item.unitValue))}</vUnCom>
        <vProd>${escapeXml(money(item.subtotal))}</vProd>
        <cEANTrib></cEANTrib>
        <uTrib>${escapeXml(item.unit)}</uTrib>
        <qTrib>${escapeXml(decimal(item.quantity))}</qTrib>
        <vUnTrib>${escapeXml(money(item.unitValue))}</vUnTrib>
      </prod>
    </det>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<NFe>
  <infNFe versao="1.00" Id="NFe${escapeXml(invoice.accessKey)}">
    <ide>
      <cUF>35</cUF>
      <natOp>${escapeXml(operationNature)}</natOp>
      <mod>55</mod>
      <serie>${escapeXml(invoice.series)}</serie>
      <nNF>${escapeXml(invoice.number)}</nNF>
      <dhEmi>${escapeXml(issueDateIso)}</dhEmi>
      <dhSaiEnt>${escapeXml(meta.dispatchDate ? `${meta.dispatchDate}T${meta.dispatchTime || "00:00:00"}-03:00` : issueDateIso)}</dhSaiEnt>
      <tpNF>${meta.nfType === "entrada" ? "0" : "1"}</tpNF>
      <idDest>1</idDest>
      <cMunFG>3550308</cMunFG>
      <tpImp>1</tpImp>
      <tpEmis>1</tpEmis>
      <cDV>${escapeXml(invoice.accessKey.slice(-1))}</cDV>
      <tpAmb>${environmentCode}</tpAmb>
      <finNFe>1</finNFe>
      <indFinal>1</indFinal>
      <indPres>${escapeXml(meta.buyerPresence || "1")}</indPres>
      <procEmi>0</procEmi>
      <verProc>PortalFiscal</verProc>
    </ide>
    <emit>
      <xNome>${escapeXml(company.legal_name)}</xNome>
      <xFant>${escapeXml(company.trade_name || company.legal_name)}</xFant>
      <CNPJ>${escapeXml(onlyDigits(company.cnpj))}</CNPJ>
      <IE>${escapeXml(company.state_registration || "ISENTO")}</IE>
      <email>${escapeXml(company.email || "")}</email>
      <fone>${escapeXml(onlyDigits(company.phone || ""))}</fone>
      <enderEmit>
        <xLgr>${escapeXml(company.address || "Nao informado")}</xLgr>
        <xMun>${escapeXml(company.address || "Nao informado")}</xMun>
        <UF>SP</UF>
      </enderEmit>
    </emit>
    <dest>
      <xNome>${escapeXml(customer.full_name)}</xNome>
      <CNPJCPF>${escapeXml(onlyDigits(customer.document))}</CNPJCPF>
      <email>${escapeXml(customer.email || "")}</email>
      <fone>${escapeXml(onlyDigits(customer.phone || ""))}</fone>
      <enderDest>
        <xLgr>${escapeXml(customer.address || "Nao informado")}</xLgr>
        <xMun>${escapeXml(customer.address || "Nao informado")}</xMun>
        <UF>SP</UF>
      </enderDest>
    </dest>
${detItems}
    <total>
      <ICMSTot>
        <vBC>${escapeXml(Number(meta.baseCalcValue || 0).toFixed(2))}</vBC>
        <vICMS>${escapeXml(icmsValue)}</vICMS>
        <vBCST>${escapeXml(Number(meta.baseCalcStValue || 0).toFixed(2))}</vBCST>
        <vST>${escapeXml(Number(meta.icmsStValue || 0).toFixed(2))}</vST>
        <vProd>${escapeXml(money(meta.totalProductsValue || totalProducts))}</vProd>
        <vFrete>${escapeXml(freightValue)}</vFrete>
        <vSeg>${escapeXml(insuranceValue)}</vSeg>
        <vDesc>${escapeXml(discountValue)}</vDesc>
        <vII>0.00</vII>
        <vIPI>${escapeXml(ipiValue)}</vIPI>
        <vOutro>${escapeXml(otherValue)}</vOutro>
        <vNF>${escapeXml(totalInvoiceValue)}</vNF>
      </ICMSTot>
    </total>
    <transp>
      <modFrete>${transport.code ? "0" : "9"}</modFrete>
      ${transport.name ? `<transporta><xNome>${escapeXml(transport.name)}</xNome><xEnder>${escapeXml(transport.address || "")}</xEnder><xMun>${escapeXml(transport.city || "")}</xMun><UF>${escapeXml(transport.state || "SP")}</UF><CNPJCPF>${escapeXml(onlyDigits(transport.cnpj || ""))}</CNPJCPF><IE>${escapeXml(transport.stateRegistration || "")}</IE></transporta>` : ""}
    </transp>
    ${cobranca ? `<cobr>\n${cobranca}\n    </cobr>` : ""}
    <infAdic>
      <infCpl>${escapeXml(additionalInfo)}</infCpl>
      <obsCont xCampo="Certificado">
        <xTexto>${escapeXml(company.certificate_name ? `Certificado cadastrado: ${company.certificate_name}` : "Certificado nao cadastrado")}</xTexto>
      </obsCont>
      <obsCont xCampo="DataGeracao">
        <xTexto>${escapeXml(issueDate)}</xTexto>
      </obsCont>
      <obsCont xCampo="Ambiente">
        <xTexto>${escapeXml(invoice.environmentMode === "producao" ? "Producao" : "Homologacao")}</xTexto>
      </obsCont>
    </infAdic>
  </infNFe>
</NFe>`;
}
