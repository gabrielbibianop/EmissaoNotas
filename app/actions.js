"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import nodemailer from "nodemailer";
import { createUserAccount, loginUser, logoutUser, requireAdmin } from "@/lib/auth";
import { ensureSchema, getDb, query } from "@/lib/db";
import { buildInvoicePdfDocument } from "@/lib/invoice-documents";
import {
  decryptSecretText,
  encryptSecretBuffer,
  encryptSecretText,
  hashUserPassword
} from "@/lib/security";
import { generateAccessKey, generateInvoiceXml } from "@/lib/invoice-xml";
import {
  buildCancelPayload,
  buildNfePayload,
  loadNfeWizard
} from "@/lib/nfe-service";

function required(value, field) {
  if (!value) {
    throw new Error(`O campo "${field}" e obrigatorio.`);
  }

  return value;
}

function asMoney(value) {
  const raw = String(value || "0").trim();

  if (!raw) {
    return 0;
  }

  if (raw.includes(",") && raw.includes(".")) {
    return Number(raw.replace(/\./g, "").replace(",", "."));
  }

  if (raw.includes(",")) {
    return Number(raw.replace(",", "."));
  }

  return Number(raw);
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function asInteger(value, fallback = 0) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function incrementCode(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "1";
  }

  const match = normalized.match(/(\d+)$/);

  if (!match) {
    return `${normalized}-1`;
  }

  const digits = match[1];
  const nextValue = String(Number(digits) + 1).padStart(digits.length, "0");
  return `${normalized.slice(0, -digits.length)}${nextValue}`;
}

function parseJsonPayload(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(String(value));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeSaleItems(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];

  return items
    .map((item, index) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = asMoney(item.unitPrice ?? item.unitValue ?? 0);
      const totalPrice = asMoney(item.totalPrice ?? item.subtotalValue ?? quantity * unitPrice);

      return {
        productId: item.productId ? Number(item.productId) : null,
        productCode: String(item.productCode || item.sku || `ITEM${index + 1}`),
        description: String(item.description || item.name || "").trim(),
        quantity,
        unit: String(item.unit || "UN"),
        unitPrice,
        totalPrice,
        ncm: String(item.ncm || item.classFiscal || ""),
        cfop: String(item.cfop || "5102"),
        st: String(item.st || "00"),
        icmsAliquot: asMoney(item.icmsAliquot ?? 18),
        ipiAliquot: asMoney(item.ipiAliquot ?? 0)
      };
    })
    .filter((item) => item.description && item.quantity > 0);
}

function validateCancelReason(value) {
  const normalized = String(value || "").trim();

  if (normalized.length < 15) {
    throw new Error("A justificativa do cancelamento deve ter no minimo 15 caracteres.");
  }

  if (normalized !== normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "")) {
    throw new Error("A justificativa do cancelamento deve ser informada sem acentos.");
  }

  return normalized;
}

function normalizeEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function shortenStatus(value, maxLength = 60) {
  const normalized = String(value || "").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function redirectWithError(path, error) {
  const message = error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function rethrowIfRedirectError(error) {
  if (isRedirectError(error)) {
    throw error;
  }
}

function hasSefazTransmission(invoice) {
  return Boolean(
    invoice?.sent_at ||
    invoice?.protocol_number ||
    invoice?.receipt_number ||
    invoice?.cancelled_at ||
    ["Autorizada", "Transmitida", "Cancelada"].includes(String(invoice?.status || ""))
  );
}

function canSendInvoice(invoice) {
  return !hasSefazTransmission(invoice);
}

function canConsultInvoice(invoice) {
  return Boolean(invoice?.access_key || invoice?.generated_access_key);
}

function canCancelInvoice(invoice) {
  return Boolean(invoice?.protocol_number) && String(invoice?.status || "") !== "Cancelada";
}

function assertInvoiceCanSend(invoice) {
  if (!canSendInvoice(invoice)) {
    throw new Error("Esta nota ja foi enviada para a SEFAZ e nao pode ser reenviada.");
  }
}

function assertInvoiceCanConsult(invoice) {
  if (!canConsultInvoice(invoice)) {
    throw new Error("A nota precisa ter uma chave de acesso antes da consulta.");
  }
}

function assertInvoiceCanCancel(invoice) {
  if (String(invoice?.status || "") === "Cancelada") {
    throw new Error("Esta nota ja foi cancelada.");
  }

  if (!invoice?.protocol_number) {
    throw new Error("A nota precisa estar autorizada antes do cancelamento.");
  }
}

function assertInvoiceCanDelete(invoice) {
  if (hasSefazTransmission(invoice)) {
    throw new Error("Notas ja enviadas para a SEFAZ nao podem ser apagadas.");
  }
}

function resolveConsultStatus(sefazResponse, currentStatus) {
  const statusCode =
    String(
      sefazResponse?.protNFe?.infProt?.cStat ||
      sefazResponse?.retConsSitNFe?.protNFe?.infProt?.cStat ||
      sefazResponse?.retConsSitNFe?.procEventoNFe?.retEvento?.infEvento?.cStat ||
      sefazResponse?.procEventoNFe?.retEvento?.infEvento?.cStat ||
      sefazResponse?.retConsSitNFe?.cStat ||
      ""
    );
  const reason = String(
    sefazResponse?.protNFe?.infProt?.xMotivo ||
    sefazResponse?.retConsSitNFe?.protNFe?.infProt?.xMotivo ||
    sefazResponse?.retConsSitNFe?.procEventoNFe?.retEvento?.infEvento?.xMotivo ||
    sefazResponse?.procEventoNFe?.retEvento?.infEvento?.xMotivo ||
    sefazResponse?.retConsSitNFe?.xMotivo ||
    ""
  ).toLowerCase();

  if (statusCode === "100") {
    return "Autorizada";
  }

  if (
    statusCode === "101" ||
    statusCode === "135" ||
    statusCode === "155" ||
    reason.includes("cancelad")
  ) {
    return "Cancelada";
  }

  return currentStatus || "XML gerado";
}

function isInvoiceMissingOnSefaz(errorOrResponse) {
  const message =
    errorOrResponse instanceof Error
      ? errorOrResponse.message
      : String(
          errorOrResponse?.protNFe?.infProt?.xMotivo ||
            errorOrResponse?.retConsSitNFe?.xMotivo ||
            errorOrResponse?.xMotivo ||
            ""
        );

  return message.includes("NF-e nao consta na base de dados da SEFAZ") ||
    message.includes("NF-e não consta na base de dados da SEFAZ");
}

function isForbiddenSefazError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("status code 403");
}

function getFriendlySefazError(error) {
  if (isForbiddenSefazError(error)) {
    return new Error("A SEFAZ bloqueou temporariamente a consulta desta nota. Aguarde alguns minutos antes de tentar novamente.");
  }

  return error instanceof Error ? error : new Error("Falha ao consultar a SEFAZ.");
}

async function consultProtocolWithRetry(wizard, accessKey, options = {}) {
  const delays = options.delays || [1500, 3000, 5000];
  let lastError = null;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const response = await wizard.NFE_ConsultaProtocolo(accessKey);

      if (!isInvoiceMissingOnSefaz(response)) {
        return response;
      }

      lastError = new Error(
        response?.retConsSitNFe?.xMotivo || "NF-e nao consta na base de dados da SEFAZ."
      );
    } catch (error) {
      if (isForbiddenSefazError(error)) {
        throw getFriendlySefazError(error);
      }

      if (!isInvoiceMissingOnSefaz(error)) {
        throw error;
      }

      lastError = error;
    }

    if (attempt < delays.length) {
      await wait(delays[attempt]);
    }
  }

  throw lastError || new Error("NF-e nao consta na base de dados da SEFAZ.");
}

function getAddressFields(formData) {
  return {
    address: formData.get("address") || null,
    addressLine: formData.get("addressLine") || null,
    addressNumber: formData.get("addressNumber") || null,
    addressComplement: formData.get("addressComplement") || null,
    district: formData.get("district") || null,
    city: formData.get("city") || null,
    state: formData.get("state") || null,
    zipCode: formData.get("zipCode") || null,
    cityCode: formData.get("cityCode") || null,
    countryCode: formData.get("countryCode") || "1058",
    countryName: formData.get("countryName") || "Brasil"
  };
}

function getInstallments(formData) {
  const installments = [];

  for (let index = 1; index <= 10; index += 1) {
    const parcela = String(formData.get(`parc${index}`) || "").trim();
    const vencimento = String(formData.get(`venc${index}`) || "").trim();
    const valor = String(formData.get(`val${index}`) || "").trim();

    if (parcela || vencimento || valor) {
      installments.push({
        parcela,
        vencimento,
        valor: asMoney(valor)
      });
    }
  }

  return installments;
}

function normalizeInvoiceItems(formData) {
  const rawPayload = String(formData.get("itemsPayload") || "").trim();

  if (rawPayload) {
    try {
      const parsed = JSON.parse(rawPayload);

      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, index) => ({
          productId: item.productId ? asInteger(item.productId, 0) || null : null,
          productCode: String(item.productCode || "").trim(),
          description: String(item.description || "").trim(),
          classFiscal: String(item.classFiscal || "").trim(),
          cfop: String(item.cfop || "").trim(),
          st: String(item.st || "").trim(),
          quantity: String(item.quantity || "").trim() || "1",
          unit: String(item.unit || "").trim() || "UN",
          unitValue: asMoney(item.unitValue),
          subtotalValue: asMoney(item.subtotalValue),
          icmsAliquot: asMoney(item.icmsAliquot),
          ipiAliquot: asMoney(item.ipiAliquot),
          icmsValue: asMoney(item.icmsValue),
          ipiValue: asMoney(item.ipiValue),
          itemNumber: index + 1
        })).filter((item) => item.description || item.productCode || item.productId);
      }
    } catch {
      // Fallback para o modelo antigo de item unico.
    }
  }

  return [
    {
      productId: formData.get("productId") ? Number(formData.get("productId")) : null,
      productCode: String(formData.get("itemProductCode") || "").trim(),
      description: String(formData.get("itemDescription") || "").trim(),
      classFiscal: String(formData.get("itemClassFiscal") || "").trim(),
      cfop: String(formData.get("itemCfop") || "").trim(),
      st: String(formData.get("itemSt") || "").trim(),
      quantity: String(formData.get("itemQuantity") || "").trim() || "1",
      unit: String(formData.get("itemUnit") || "").trim() || "UN",
      unitValue: asMoney(formData.get("itemUnitValue")),
      subtotalValue: asMoney(formData.get("itemSubtotalValue")),
      icmsAliquot: asMoney(formData.get("itemIcmsAliquot")),
      ipiAliquot: asMoney(formData.get("itemIpiAliquot")),
      icmsValue: 0,
      ipiValue: 0,
      itemNumber: 1
    }
  ].filter((item) => item.description || item.productCode || item.productId);
}

function getInvoiceMeta(formData) {
  const items = normalizeInvoiceItems(formData);
  const firstItem = items[0] || {};

  return {
    operationMode: String(formData.get("operationMode") || "emissao"),
    environmentMode: String(formData.get("environmentMode") || "homologacao"),
    nfType: String(formData.get("nfType") || "saida"),
    nature: String(formData.get("nature") || "Venda"),
    fiscalCode: String(formData.get("fiscalCode") || ""),
    cfopCode: String(formData.get("cfopCode") || ""),
    issueTime: String(formData.get("issueTime") || ""),
    dispatchDate: String(formData.get("dispatchDate") || ""),
    dispatchTime: String(formData.get("dispatchTime") || ""),
    paymentMethod: String(formData.get("paymentMethod") || ""),
    paymentType: String(formData.get("paymentType") || ""),
    buyerPresence: String(formData.get("buyerPresence") || ""),
    docRef: String(formData.get("docRef") || ""),
    countryCode: String(formData.get("countryCode") || ""),
    countryName: String(formData.get("countryName") || ""),
    suframaCode: String(formData.get("suframaCode") || ""),
    embarkState: String(formData.get("embarkState") || ""),
    embarkLocation: String(formData.get("embarkLocation") || ""),
    discountValue: asMoney(formData.get("discountValue")),
    baseCalcValue: asMoney(formData.get("baseCalcValue")),
    icmsValue: asMoney(formData.get("icmsValue")),
    baseCalcStValue: asMoney(formData.get("baseCalcStValue")),
    icmsStValue: asMoney(formData.get("icmsStValue")),
    totalProductsValue: asMoney(formData.get("totalProductsValue")),
    freightValue: asMoney(formData.get("freightValue")),
    ipiValue: asMoney(formData.get("ipiValue")),
    insuranceValue: asMoney(formData.get("insuranceValue")),
    otherValue: asMoney(formData.get("otherValue")),
    funruralMode: String(formData.get("funruralMode") || "nao_desconta_nao_informa"),
    funruralPercent: asMoney(formData.get("funruralPercent")),
    funruralValue: asMoney(formData.get("funruralValue")),
    totalInvoiceValue: asMoney(formData.get("totalInvoiceValue")),
    transport: {
      code: String(formData.get("transportCode") || ""),
      freightMode: String(formData.get("transportFreightMode") || ""),
      name: String(formData.get("transportName") || ""),
      address: String(formData.get("transportAddress") || ""),
      city: String(formData.get("transportCity") || ""),
      state: String(formData.get("transportState") || ""),
      cnpj: String(formData.get("transportCnpj") || ""),
      stateRegistration: String(formData.get("transportStateRegistration") || ""),
      plate: String(formData.get("transportPlate") || ""),
      plateState: String(formData.get("transportPlateState") || ""),
      quantity: String(formData.get("transportQuantity") || ""),
      specie: String(formData.get("transportSpecie") || ""),
      brand: String(formData.get("transportBrand") || ""),
      grossWeight: String(formData.get("transportGrossWeight") || ""),
      netWeight: String(formData.get("transportNetWeight") || "")
    },
    item: {
      productId: firstItem.productId || null,
      productCode: firstItem.productCode || "",
      description: firstItem.description || "",
      classFiscal: firstItem.classFiscal || "",
      cfop: firstItem.cfop || "",
      st: firstItem.st || "",
      quantity: firstItem.quantity || "",
      unit: firstItem.unit || "",
      unitValue: firstItem.unitValue || 0,
      subtotalValue: firstItem.subtotalValue || 0,
      icmsAliquot: firstItem.icmsAliquot || 0,
      ipiAliquot: firstItem.ipiAliquot || 0
    },
    items,
    installments: getInstallments(formData)
  };
}

async function syncProductPricesFromInvoiceItems(client, items) {
  const normalizedItems = Array.isArray(items) ? items : [];

  for (const item of normalizedItems) {
    const productId = asInteger(item.productId, 0);
    const unitValue = asMoney(item.unitValue);

    if (!productId || unitValue <= 0) {
      continue;
    }

    await client.query(
      `UPDATE products
       SET price = $1
       WHERE id = $2`,
      [unitValue, productId]
    );
  }
}

async function hasTransmittedInvoiceReference(client, field, id) {
  const directReference = await client.query(
    `SELECT 1
     FROM invoices
     WHERE ${field} = $1
       AND (
         sent_at IS NOT NULL OR
         protocol_number IS NOT NULL OR
         receipt_number IS NOT NULL OR
         cancelled_at IS NOT NULL OR
         status IN ('Autorizada', 'Transmitida', 'Cancelada')
       )
     LIMIT 1`,
    [id]
  );

  return directReference.rows.length > 0;
}

async function hasTransmittedInvoiceProductReference(client, productId) {
  const directReference = await client.query(
    `SELECT 1
     FROM invoices
     WHERE (
       product_id = $1 OR
       EXISTS (
         SELECT 1
         FROM jsonb_array_elements(COALESCE(invoice_meta::jsonb -> 'items', '[]'::jsonb)) AS item
         WHERE (item ->> 'productId') = $2
       )
     )
       AND (
         sent_at IS NOT NULL OR
         protocol_number IS NOT NULL OR
         receipt_number IS NOT NULL OR
         cancelled_at IS NOT NULL OR
         status IN ('Autorizada', 'Transmitida', 'Cancelada')
       )
     LIMIT 1`,
    [productId, String(productId)]
  );

  return directReference.rows.length > 0;
}

async function assertCustomerCanDelete(customerId) {
  const db = getDb();
  const client = await db.connect();

  try {
    if (await hasTransmittedInvoiceReference(client, "customer_id", customerId)) {
      throw new Error("Nao e permitido excluir cliente com nota ja enviada.");
    }
  } finally {
    client.release();
  }
}

async function assertCompanyCanDelete(companyId) {
  const db = getDb();
  const client = await db.connect();

  try {
    if (await hasTransmittedInvoiceReference(client, "company_id", companyId)) {
      throw new Error("Nao e permitido excluir empresa com nota ja enviada.");
    }
  } finally {
    client.release();
  }
}

async function assertProductCanDelete(productId) {
  const db = getDb();
  const client = await db.connect();

  try {
    if (await hasTransmittedInvoiceProductReference(client, productId)) {
      throw new Error("Nao e permitido excluir produto com nota ja enviada.");
    }
  } finally {
    client.release();
  }
}

async function getInvoiceContext(client, invoiceId) {
  const invoiceResult = await client.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);

  if (invoiceResult.rows.length === 0) {
    throw new Error("Nota fiscal nao encontrada.");
  }

  const invoice = invoiceResult.rows[0];
  const [companyResult, customerResult, productResult, allProductsResult] = await Promise.all([
    client.query("SELECT * FROM companies WHERE id = $1", [invoice.company_id]),
    client.query("SELECT * FROM customers WHERE id = $1", [invoice.customer_id]),
    invoice.product_id ? client.query("SELECT * FROM products WHERE id = $1", [invoice.product_id]) : Promise.resolve({ rows: [] }),
    client.query("SELECT * FROM products ORDER BY id")
  ]);

  if (companyResult.rows.length === 0) {
    throw new Error("Empresa nao encontrada para a nota.");
  }

  if (customerResult.rows.length === 0) {
    throw new Error("Cliente nao encontrado para a nota.");
  }

  return {
    invoice,
    company: companyResult.rows[0],
    customer: customerResult.rows[0],
    product: productResult.rows[0] || null,
    products: allProductsResult.rows
  };
}

async function getNextSaleNumber(client) {
  const result = await client.query(
    `SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(sale_number, '\D', '', 'g'), '')::bigint), 0) + 1 AS next_number
     FROM sales`
  );

  return String(result.rows[0]?.next_number || 1).padStart(6, "0");
}

async function markSaleAsInvoiced(client, saleId) {
  if (!saleId) {
    return;
  }

  await client.query(
    `UPDATE sales
     SET status = 'faturada',
         invoiced_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [saleId]
  );
}

function isDuplicateNfeError(message) {
  return message.includes("Duplicidade de NF-e");
}

function isDuplicateWithDifferentAccessKey(message) {
  return message.includes("539") ||
    message.includes("diferenca na Chave de Acesso") ||
    message.includes("diferença na Chave de Acesso");
}

async function bumpInvoiceNumberAfterDuplicate(client, context) {
  const nextNumber = String(asInteger(context.invoice.number, 0) + 1);
  const series = String(context.invoice.series || context.company.invoice_series || "1");
  const invoiceMeta =
    typeof context.invoice.invoice_meta === "string"
      ? JSON.parse(context.invoice.invoice_meta || "{}")
      : context.invoice.invoice_meta || {};
  const accessKey = generateAccessKey({
    companyCnpj: context.company.cnpj,
    issueDate: context.invoice.issue_date,
    series,
    number: nextNumber
  });
  const xml = generateInvoiceXml({
    company: context.company,
    customer: context.customer,
    product: context.product,
    products: context.products,
    invoice: {
      number: nextNumber,
      series,
      issueDate: context.invoice.issue_date,
      totalValue: context.invoice.total_value,
      notes: context.invoice.notes,
      accessKey,
      environmentMode: context.invoice.environment_mode,
      meta: invoiceMeta
    }
  });

  await client.query(
    `UPDATE invoices
     SET number = $1,
         series = $2,
         access_key = $3,
         generated_access_key = $4,
         xml_file_name = $5,
         xml_file_type = $6,
         xml_file_data = $7,
         sefaz_status = $8
     WHERE id = $9`,
    [
      nextNumber,
      series,
      accessKey,
      accessKey,
      `nfe-${nextNumber}.xml`,
      "application/xml",
      Buffer.from(xml, "utf-8"),
      shortenStatus(`Numero ${context.invoice.number} ja existente na SEFAZ. Ajustado para ${nextNumber}.`),
      context.invoice.id
    ]
  );

  await client.query(
    `UPDATE companies
     SET invoice_next_number = GREATEST(COALESCE(invoice_next_number, 1), $1)
     WHERE id = $2`,
    [Number(nextNumber) + 1, context.company.id]
  );
}

async function transmitInvoice(invoiceId) {
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    let context = await getInvoiceContext(client, invoiceId);
    assertInvoiceCanSend(context.invoice);
    const wizard = await loadNfeWizard({
      company: context.company,
      invoiceId,
      environmentMode: context.invoice.environment_mode
    });
    let sefazResponse;
    let currentContext = context;

    for (let attempt = 0; attempt < 15; attempt += 1) {
      const payload = buildNfePayload(currentContext);

      try {
        sefazResponse = await wizard.NFE_Autorizacao(payload);
        context = currentContext;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || "");

        if (!isDuplicateNfeError(message)) {
          throw error;
        }

        if (isDuplicateWithDifferentAccessKey(message)) {
          await bumpInvoiceNumberAfterDuplicate(client, currentContext);
          currentContext = await getInvoiceContext(client, invoiceId);
          context = currentContext;
          continue;
        }

        const duplicateReceiptNumber = message.match(/nRec:(\d+)/)?.[1] || null;
        const duplicateResponse = await consultProtocolWithRetry(
          wizard,
          currentContext.invoice.access_key || currentContext.invoice.generated_access_key
        );

        sefazResponse = {
          ...duplicateResponse,
          duplicateReceiptNumber
        };
        context = currentContext;
        break;
      }
    }

    if (!sefazResponse) {
      throw new Error("Nao foi possivel encontrar um numero livre para emissao na SEFAZ.");
    }

    const serialized = JSON.stringify(sefazResponse);
    const protocolNumber =
      sefazResponse?.protNFe?.infProt?.nProt ||
      sefazResponse?.retEnviNFe?.protNFe?.infProt?.nProt ||
      sefazResponse?.retConsSitNFe?.protNFe?.infProt?.nProt ||
      null;
    const receiptNumber =
      sefazResponse?.duplicateReceiptNumber ||
      sefazResponse?.infRec?.nRec ||
      sefazResponse?.retEnviNFe?.infRec?.nRec ||
      null;

    await client.query(
      `UPDATE invoices
       SET status = $1,
           sefaz_status = $2,
           protocol_number = COALESCE($3, protocol_number),
           receipt_number = COALESCE($4, receipt_number),
           sent_at = CURRENT_TIMESTAMP,
           sefaz_response = $5
       WHERE id = $6`,
      [
        protocolNumber ? "Autorizada" : "Transmitida",
        protocolNumber ? "Autorizada pela SEFAZ" : "Lote enviado para SEFAZ",
        protocolNumber,
        receiptNumber,
        serialized,
        invoiceId
      ]
    );

    await client.query(
      `UPDATE companies
       SET invoice_next_number = GREATEST(COALESCE(invoice_next_number, 1), $1)
       WHERE id = $2`,
      [asInteger(context.invoice.number, 0) + 1, context.company.id]
    );

    await client.query("COMMIT");
    return { protocolNumber, receiptNumber, sefazResponse };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createCustomer(formData) {
  await ensureSchema();
  const address = getAddressFields(formData);

  await query(
    `INSERT INTO customers (
      full_name, document, email, phone, address, state_registration,
      address_line, address_number, address_complement, district, city, state,
      zip_code, city_code, country_code, country_name
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      required(formData.get("fullName"), "Nome do cliente"),
      required(formData.get("document"), "CPF/CNPJ"),
      normalizeEmail(formData.get("email")),
      formData.get("phone") || null,
      address.address,
      formData.get("stateRegistration") || null,
      address.addressLine,
      address.addressNumber,
      address.addressComplement,
      address.district,
      address.city,
      address.state,
      digits(address.zipCode) || null,
      digits(address.cityCode) || null,
      digits(address.countryCode) || "1058",
      address.countryName
    ]
  );

  revalidatePath("/clientes");
  revalidatePath("/");
}

export async function updateCustomer(formData) {
  await ensureSchema();
  const address = getAddressFields(formData);

  await query(
    `UPDATE customers
     SET full_name = $1, document = $2, email = $3, phone = $4, address = $5,
         state_registration = $6, address_line = $7, address_number = $8, address_complement = $9,
         district = $10, city = $11, state = $12, zip_code = $13, city_code = $14,
         country_code = $15, country_name = $16
     WHERE id = $17`,
    [
      required(formData.get("fullName"), "Nome do cliente"),
      required(formData.get("document"), "CPF/CNPJ"),
      normalizeEmail(formData.get("email")),
      formData.get("phone") || null,
      address.address,
      formData.get("stateRegistration") || null,
      address.addressLine,
      address.addressNumber,
      address.addressComplement,
      address.district,
      address.city,
      address.state,
      digits(address.zipCode) || null,
      digits(address.cityCode) || null,
      digits(address.countryCode) || "1058",
      address.countryName,
      Number(required(formData.get("id"), "ID do cliente"))
    ]
  );

  revalidatePath("/clientes");
  redirect("/clientes");
}

export async function deleteCustomer(formData) {
  await ensureSchema();
  const customerId = Number(required(formData.get("id"), "ID do cliente"));
  await assertCustomerCanDelete(customerId);
  await query("DELETE FROM customers WHERE id = $1", [customerId]);
  revalidatePath("/clientes");
  revalidatePath("/notas");
  redirect("/clientes");
}

export async function cloneCustomerToCompany(formData) {
  try {
    await ensureSchema();
    const customerId = Number(required(formData.get("id"), "ID do cliente"));
    const customerResult = await query("SELECT * FROM customers WHERE id = $1", [customerId]);
    const customer = customerResult.rows[0];

    if (!customer) {
      throw new Error("Cliente nao encontrado.");
    }

    const existingCompany = await query("SELECT id FROM companies WHERE cnpj = $1", [customer.document]);

    if (existingCompany.rows[0]) {
      revalidatePath("/empresas");
      revalidatePath("/empresas/busca");
      redirect(`/empresas?edit=${existingCompany.rows[0].id}&success=${encodeURIComponent("Empresa existente aberta para revisao.")}`);
    }

    const insertResult = await query(
      `INSERT INTO companies (
        legal_name,
        trade_name,
        cnpj,
        email,
        phone,
        state_registration,
        address,
        address_line,
        address_number,
        address_complement,
        district,
        city,
        state,
        zip_code,
        city_code,
        country_code,
        country_name,
        tax_regime,
        invoice_series,
        invoice_next_number
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, '3', '1', 1)
      RETURNING id`,
      [
        customer.full_name,
        customer.full_name,
        customer.document,
        customer.email,
        customer.phone,
        customer.state_registration,
        customer.address,
        customer.address_line,
        customer.address_number,
        customer.address_complement,
        customer.district,
        customer.city,
        customer.state,
        customer.zip_code,
        customer.city_code,
        customer.country_code || "1058",
        customer.country_name || "Brasil"
      ]
    );

    const companyId = insertResult.rows[0]?.id;
    revalidatePath("/empresas");
    revalidatePath("/empresas/busca");
    redirect(`/empresas?edit=${companyId}&success=${encodeURIComponent("Empresa criada a partir do cliente.")}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    redirectWithError("/clientes", error);
  }
}

export async function createCompany(formData) {
  await ensureSchema();
  const address = getAddressFields(formData);

  const certificateFile = formData.get("certificateFile");
  let certificateData = null;
  let certificateName = null;
  let certificateType = null;

  if (certificateFile && typeof certificateFile.arrayBuffer === "function" && certificateFile.size > 0) {
    certificateData = encryptSecretBuffer(Buffer.from(await certificateFile.arrayBuffer()));
    certificateName = certificateFile.name;
    certificateType = certificateFile.type || "application/x-pkcs12";
  }

  const certificatePassword = encryptSecretText(formData.get("certificatePassword"));

  await query(
    `INSERT INTO companies (
      legal_name,
      trade_name,
      cnpj,
      email,
      phone,
      state_registration,
      address,
      address_line,
      address_number,
      address_complement,
      district,
      city,
      state,
      zip_code,
      city_code,
      country_code,
      country_name,
      tax_regime,
      certificate_name,
      certificate_type,
      certificate_data,
      certificate_password,
      invoice_series,
      invoice_next_number
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
    [
      required(formData.get("legalName"), "Razao social"),
      formData.get("tradeName") || null,
      required(formData.get("cnpj"), "CNPJ"),
      normalizeEmail(formData.get("email")),
      formData.get("phone") || null,
      formData.get("stateRegistration") || null,
      address.address,
      address.addressLine,
      address.addressNumber,
      address.addressComplement,
      address.district,
      address.city,
      address.state,
      digits(address.zipCode) || null,
      digits(address.cityCode) || null,
      digits(address.countryCode) || "1058",
      address.countryName,
      formData.get("taxRegime") || "3",
      certificateName,
      certificateType,
      certificateData,
      certificatePassword,
      formData.get("invoiceSeries") || "1",
      Number(formData.get("invoiceNextNumber") || 1)
    ]
  );

  revalidatePath("/empresas");
  revalidatePath("/");
}

export async function updateCompany(formData) {
  await ensureSchema();
  const address = getAddressFields(formData);
  const companyId = Number(required(formData.get("id"), "ID da empresa"));
  const existingCompanyResult = await query(
    "SELECT certificate_password FROM companies WHERE id = $1",
    [companyId]
  );
  const existingCompany = existingCompanyResult.rows[0];

  if (!existingCompany) {
    throw new Error("Empresa nao encontrada.");
  }

  const certificateFile = formData.get("certificateFile");
  const hasNewCertificate = certificateFile && typeof certificateFile.arrayBuffer === "function" && certificateFile.size > 0;
  const nextCertificatePassword =
    encryptSecretText(formData.get("certificatePassword")) || existingCompany.certificate_password || null;

  if (hasNewCertificate) {
    const certificateData = encryptSecretBuffer(Buffer.from(await certificateFile.arrayBuffer()));

    await query(
      `UPDATE companies
       SET legal_name = $1, trade_name = $2, cnpj = $3, email = $4, phone = $5, state_registration = $6, address = $7,
           address_line = $8, address_number = $9, address_complement = $10, district = $11, city = $12, state = $13,
           zip_code = $14, city_code = $15, country_code = $16, country_name = $17, tax_regime = $18,
           certificate_name = $19, certificate_type = $20, certificate_data = $21, certificate_password = $22,
           invoice_series = $23, invoice_next_number = $24
       WHERE id = $25`,
      [
        required(formData.get("legalName"), "Razao social"),
        formData.get("tradeName") || null,
        required(formData.get("cnpj"), "CNPJ"),
        normalizeEmail(formData.get("email")),
        formData.get("phone") || null,
        formData.get("stateRegistration") || null,
        address.address,
        address.addressLine,
        address.addressNumber,
        address.addressComplement,
        address.district,
        address.city,
        address.state,
        digits(address.zipCode) || null,
        digits(address.cityCode) || null,
        digits(address.countryCode) || "1058",
        address.countryName,
        formData.get("taxRegime") || "3",
        certificateFile.name,
        certificateFile.type || "application/x-pkcs12",
        certificateData,
        nextCertificatePassword,
        formData.get("invoiceSeries") || "1",
        Number(formData.get("invoiceNextNumber") || 1),
        companyId
      ]
    );
  } else {
    await query(
      `UPDATE companies
       SET legal_name = $1, trade_name = $2, cnpj = $3, email = $4, phone = $5, state_registration = $6, address = $7,
           address_line = $8, address_number = $9, address_complement = $10, district = $11, city = $12, state = $13,
           zip_code = $14, city_code = $15, country_code = $16, country_name = $17, tax_regime = $18,
           certificate_password = $19, invoice_series = $20, invoice_next_number = $21
       WHERE id = $22`,
      [
        required(formData.get("legalName"), "Razao social"),
        formData.get("tradeName") || null,
        required(formData.get("cnpj"), "CNPJ"),
        normalizeEmail(formData.get("email")),
        formData.get("phone") || null,
        formData.get("stateRegistration") || null,
        address.address,
        address.addressLine,
        address.addressNumber,
        address.addressComplement,
        address.district,
        address.city,
        address.state,
        digits(address.zipCode) || null,
        digits(address.cityCode) || null,
        digits(address.countryCode) || "1058",
        address.countryName,
        formData.get("taxRegime") || "3",
        nextCertificatePassword,
        formData.get("invoiceSeries") || "1",
        Number(formData.get("invoiceNextNumber") || 1),
        companyId
      ]
    );
  }

  revalidatePath("/empresas");
  redirect("/empresas");
}

export async function saveCompanyEmailConfig(formData) {
  try {
    await ensureSchema();
    const companyId = Number(required(formData.get("companyId"), "Empresa"));
    const companyResult = await query(
      "SELECT smtp_password FROM companies WHERE id = $1",
      [companyId]
    );
    const company = companyResult.rows[0];

    if (!company) {
      throw new Error("Empresa nao encontrada.");
    }

    const smtpHost = String(required(formData.get("smtpHost"), "Servidor SMTP")).trim();
    const smtpPort = asInteger(formData.get("smtpPort"), 587);
    const smtpUser = String(required(formData.get("smtpUser"), "Usuario SMTP")).trim();
    const smtpPasswordInput = String(formData.get("smtpPassword") || "").trim();
    const smtpPassword = encryptSecretText(smtpPasswordInput) || company.smtp_password || null;
    const smtpFromEmail = normalizeEmail(required(formData.get("smtpFromEmail"), "E-mail remetente"));
    const smtpFromName = String(formData.get("smtpFromName") || "").trim() || null;
    const smtpSecure = String(formData.get("smtpSecure") || "") === "on";

    if (!smtpFromEmail) {
      throw new Error("Informe um e-mail remetente valido.");
    }

    if (!smtpPassword) {
      throw new Error("Informe a senha SMTP.");
    }

    await query(
      `UPDATE companies
       SET smtp_host = $1,
           smtp_port = $2,
           smtp_user = $3,
           smtp_password = $4,
           smtp_from_name = $5,
           smtp_from_email = $6,
           smtp_secure = $7
       WHERE id = $8`,
      [smtpHost, smtpPort, smtpUser, smtpPassword, smtpFromName, smtpFromEmail, smtpSecure, companyId]
    );

    revalidatePath("/empresas");
    redirect("/empresas?success=" + encodeURIComponent("Configuracao de e-mail salva com sucesso."));
  } catch (error) {
    rethrowIfRedirectError(error);
    redirectWithError(`/empresas?smtp=${encodeURIComponent(String(formData.get("companyId") || ""))}`, error);
  }
}

export async function deleteCompany(formData) {
  await ensureSchema();
  const companyId = Number(required(formData.get("id"), "ID da empresa"));
  await assertCompanyCanDelete(companyId);
  await query("DELETE FROM companies WHERE id = $1", [companyId]);
  revalidatePath("/empresas");
  revalidatePath("/notas");
  redirect("/empresas");
}

export async function cloneCompanyToCustomer(formData) {
  try {
    await ensureSchema();
    const companyId = Number(required(formData.get("id"), "ID da empresa"));
    const companyResult = await query("SELECT * FROM companies WHERE id = $1", [companyId]);
    const company = companyResult.rows[0];

    if (!company) {
      throw new Error("Empresa nao encontrada.");
    }

    const existingCustomer = await query("SELECT id FROM customers WHERE document = $1", [company.cnpj]);

    if (existingCustomer.rows[0]) {
      revalidatePath("/clientes");
      revalidatePath("/clientes/busca");
      redirect(`/clientes?edit=${existingCustomer.rows[0].id}&success=${encodeURIComponent("Cliente existente aberto para revisao.")}`);
    }

    const insertResult = await query(
      `INSERT INTO customers (
        full_name,
        document,
        email,
        phone,
        address,
        state_registration,
        address_line,
        address_number,
        address_complement,
        district,
        city,
        state,
        zip_code,
        city_code,
        country_code,
        country_name
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id`,
      [
        company.legal_name,
        company.cnpj,
        company.email,
        company.phone,
        company.address,
        company.state_registration,
        company.address_line,
        company.address_number,
        company.address_complement,
        company.district,
        company.city,
        company.state,
        company.zip_code,
        company.city_code,
        company.country_code || "1058",
        company.country_name || "Brasil"
      ]
    );

    const customerId = insertResult.rows[0]?.id;
    revalidatePath("/clientes");
    revalidatePath("/clientes/busca");
    redirect(`/clientes?edit=${customerId}&success=${encodeURIComponent("Cliente criado a partir da empresa.")}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    redirectWithError("/empresas", error);
  }
}

export async function createProduct(formData) {
  await ensureSchema();

  await query(
    `INSERT INTO products (name, sku, ncm, price, stock, description)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      required(formData.get("name"), "Nome do produto"),
      required(formData.get("sku"), "SKU"),
      formData.get("ncm") || null,
      asMoney(formData.get("price")),
      Number(formData.get("stock") || 0),
      formData.get("description") || null
    ]
  );

  revalidatePath("/produtos");
  revalidatePath("/");
}

export async function updateProduct(formData) {
  await ensureSchema();

  await query(
    `UPDATE products
     SET name = $1, sku = $2, ncm = $3, price = $4, stock = $5, description = $6
     WHERE id = $7`,
    [
      required(formData.get("name"), "Nome do produto"),
      required(formData.get("sku"), "SKU"),
      formData.get("ncm") || null,
      asMoney(formData.get("price")),
      Number(formData.get("stock") || 0),
      formData.get("description") || null,
      Number(required(formData.get("id"), "ID do produto"))
    ]
  );

  revalidatePath("/produtos");
  redirect("/produtos");
}

export async function deleteProduct(formData) {
  await ensureSchema();
  const productId = Number(required(formData.get("id"), "ID do produto"));
  await assertProductCanDelete(productId);
  await query("DELETE FROM products WHERE id = $1", [productId]);
  revalidatePath("/produtos");
  revalidatePath("/notas");
  redirect("/produtos");
}

export async function cloneProduct(formData) {
  try {
    await ensureSchema();
    const productId = Number(required(formData.get("id"), "ID do produto"));
    const result = await query("SELECT * FROM products WHERE id = $1", [productId]);
    const product = result.rows[0];

    if (!product) {
      throw new Error("Produto nao encontrado.");
    }

    let nextSku = incrementCode(product.sku);
    let attempts = 0;

    while (attempts < 50) {
      const existing = await query("SELECT 1 FROM products WHERE sku = $1 LIMIT 1", [nextSku]);

      if (existing.rows.length === 0) {
        break;
      }

      nextSku = incrementCode(nextSku);
      attempts += 1;
    }

    if (attempts >= 50) {
      throw new Error("Nao foi possivel gerar um novo codigo de produto livre.");
    }

    const insertResult = await query(
      `INSERT INTO products (name, sku, ncm, price, stock, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        `${product.name} (copia)`,
        nextSku,
        product.ncm,
        product.price,
        product.stock,
        product.description
      ]
    );

    const clonedId = insertResult.rows[0]?.id;
    revalidatePath("/produtos");
    revalidatePath("/produtos/busca");
    redirect(`/produtos?edit=${clonedId}&success=${encodeURIComponent("Produto clonado com sucesso.")}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    redirectWithError("/produtos/busca", error);
  }
}

export async function saveStockMovement(formData) {
  let client;

  try {
    await ensureSchema();

    const productId = Number(required(formData.get("productId"), "Produto"));
    const movementType = String(required(formData.get("movementType"), "Tipo de movimentacao")).trim().toLowerCase();
    const quantity = asInteger(formData.get("quantity"));
    const notes = String(formData.get("notes") || "").trim() || null;

    if (!["entrada", "saida", "ajuste"].includes(movementType)) {
      throw new Error("Tipo de movimentacao invalido.");
    }

    if (movementType === "ajuste") {
      if (quantity < 0) {
        throw new Error("O estoque ajustado nao pode ser negativo.");
      }
    } else if (quantity <= 0) {
      throw new Error("Informe uma quantidade maior que zero.");
    }

    const db = getDb();
    client = await db.connect();
    await client.query("BEGIN");

    const productResult = await client.query(
      "SELECT id, name, stock FROM products WHERE id = $1 FOR UPDATE",
      [productId]
    );

    if (productResult.rows.length === 0) {
      throw new Error("Produto nao encontrado para movimentacao.");
    }

    const product = productResult.rows[0];
    const previousStock = Number(product.stock || 0);
    let resultingStock = previousStock;
    let storedQuantity = quantity;

    if (movementType === "entrada") {
      resultingStock = previousStock + quantity;
    } else if (movementType === "saida") {
      if (quantity > previousStock) {
        throw new Error(`Estoque insuficiente para saida. Saldo atual de ${product.name}: ${previousStock}.`);
      }

      resultingStock = previousStock - quantity;
    } else {
      resultingStock = quantity;
      storedQuantity = Math.abs(resultingStock - previousStock);
    }

    await client.query(
      "UPDATE products SET stock = $1 WHERE id = $2",
      [resultingStock, productId]
    );

    await client.query(
      `INSERT INTO stock_movements (
        product_id,
        movement_type,
        quantity,
        previous_stock,
        resulting_stock,
        notes
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [productId, movementType, storedQuantity, previousStock, resultingStock, notes]
    );

    await client.query("COMMIT");
    revalidatePath("/estoque");
    revalidatePath("/produtos");
    revalidatePath("/");
    redirect("/estoque");
  } catch (error) {
    rethrowIfRedirectError(error);
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }
    redirectWithError("/estoque", error);
  } finally {
    client?.release();
  }
}

export async function createSale(formData) {
  await ensureSchema();
  const companyId = Number(required(formData.get("companyId"), "Empresa"));
  const customerId = Number(required(formData.get("customerId"), "Cliente"));
  const saleDate = required(formData.get("saleDate"), "Data da venda");
  const status = String(formData.get("status") || "aberta");
  const notes = String(formData.get("notes") || "").trim() || null;
  const items = normalizeSaleItems(parseJsonPayload(formData.get("itemsPayload"), []));

  if (items.length === 0) {
    throw new Error("Adicione pelo menos um item na venda.");
  }

  const totalValue = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const saleNumber = await getNextSaleNumber(client);
    const saleMeta = {
      items,
      generatedFrom: "sales-module"
    };
    const saleResult = await client.query(
      `INSERT INTO sales (
        company_id,
        customer_id,
        sale_number,
        sale_date,
        status,
        total_value,
        notes,
        sale_meta
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        companyId,
        customerId,
        saleNumber,
        saleDate,
        status,
        totalValue,
        notes,
        JSON.stringify(saleMeta)
      ]
    );

    const saleId = saleResult.rows[0]?.id;

    for (const item of items) {
      await client.query(
        `INSERT INTO sale_items (
          sale_id,
          product_id,
          product_code,
          description,
          quantity,
          unit,
          unit_price,
          total_price
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          saleId,
          item.productId,
          item.productCode,
          item.description,
          item.quantity,
          item.unit,
          item.unitPrice,
          item.totalPrice
        ]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  revalidatePath("/vendas");
  revalidatePath("/");
  redirect("/vendas?success=" + encodeURIComponent("Venda registrada com sucesso."));
}

export async function updateSaleStatus(formData) {
  await ensureSchema();
  const saleId = Number(required(formData.get("id"), "ID da venda"));
  const status = required(formData.get("status"), "Status da venda");

  await query(
    `UPDATE sales
     SET status = $1,
         invoiced_at = CASE WHEN $1 = 'faturada' THEN COALESCE(invoiced_at, CURRENT_TIMESTAMP) ELSE invoiced_at END
     WHERE id = $2`,
    [status, saleId]
  );

  revalidatePath("/vendas");
  redirect("/vendas");
}

export async function createMaintenance(formData) {
  await ensureSchema();
  const customerId = Number(required(formData.get("customerId"), "Cliente"));

  await query(
    `INSERT INTO maintenance_orders (
      customer_id,
      equipment,
      serial_number,
      problem_description,
      service_description,
      status,
      total_value,
      notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      customerId,
      required(formData.get("equipment"), "Equipamento"),
      String(formData.get("serialNumber") || "").trim() || null,
      String(formData.get("problemDescription") || "").trim() || null,
      String(formData.get("serviceDescription") || "").trim() || null,
      String(formData.get("status") || "aberta"),
      asMoney(formData.get("totalValue")),
      String(formData.get("notes") || "").trim() || null
    ]
  );

  revalidatePath("/manutencao");
  revalidatePath("/");
  redirect("/manutencao?success=" + encodeURIComponent("Ordem de manutencao registrada com sucesso."));
}

export async function updateMaintenanceStatus(formData) {
  await ensureSchema();
  const orderId = Number(required(formData.get("id"), "ID da manutencao"));
  const status = required(formData.get("status"), "Status");

  await query(
    `UPDATE maintenance_orders
     SET status = $1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [status, orderId]
  );

  revalidatePath("/manutencao");
  redirect("/manutencao");
}

export async function createInvoice(formData) {
  await ensureSchema();

  const file = formData.get("invoiceFile");
  let fileBuffer = null;
  let fileName = null;
  let fileType = null;

  if (file && typeof file.arrayBuffer === "function" && file.size > 0) {
    fileBuffer = Buffer.from(await file.arrayBuffer());
    fileName = file.name;
    fileType = file.type || "application/octet-stream";
  }
  const companyId = Number(required(formData.get("companyId"), "Empresa"));
  const customerId = Number(required(formData.get("customerId"), "Cliente"));
  const issueDate = required(formData.get("issueDate"), "Data de emissao");
  const totalValue = asMoney(formData.get("totalValue"));
  const notes = formData.get("notes") || null;
  const invoiceMeta = getInvoiceMeta(formData);
  const firstItem = invoiceMeta.items?.[0];
  const productId = firstItem?.productId || null;
  const saleId = asInteger(formData.get("saleId"), null);
  const environmentMode = invoiceMeta.environmentMode;
  const status = formData.get("status") || "XML gerado";
  const db = getDb();
  const client = await db.connect();

  if (!invoiceMeta.items?.length) {
    throw new Error("Adicione pelo menos um produto antes de gravar a nota.");
  }

  try {
    await client.query("BEGIN");

    const companyResult = await client.query(
      `UPDATE companies
       SET invoice_next_number = COALESCE(invoice_next_number, 1) + 1
       WHERE id = $1
       RETURNING *`,
      [companyId]
    );

    if (companyResult.rows.length === 0) {
      throw new Error("Empresa nao encontrada para gerar a nota.");
    }

    const company = companyResult.rows[0];
    const customerResult = await client.query("SELECT * FROM customers WHERE id = $1", [customerId]);
    const productResult = productId
      ? await client.query("SELECT * FROM products WHERE id = $1", [productId])
      : { rows: [] };
    const allProductsResult = await client.query("SELECT * FROM products ORDER BY id");

    if (customerResult.rows.length === 0) {
      throw new Error("Cliente nao encontrado para gerar a nota.");
    }

    await syncProductPricesFromInvoiceItems(client, invoiceMeta.items);

    const generatedNumber = String((company.invoice_next_number || 2) - 1);
    const series = String(formData.get("series") || company.invoice_series || "1");
    const accessKey = String(formData.get("accessKey") || generateAccessKey({
      companyCnpj: company.cnpj,
      issueDate,
      series,
      number: generatedNumber
    }));

    const xml = generateInvoiceXml({
      company,
      customer: customerResult.rows[0],
      product: productResult.rows[0] || null,
      products: allProductsResult.rows,
      invoice: {
        number: generatedNumber,
        series,
        issueDate,
        totalValue,
        notes,
        accessKey,
        environmentMode,
        meta: invoiceMeta
      }
    });

    const xmlBuffer = Buffer.from(xml, "utf-8");
    const xmlFileName = `nfe-${generatedNumber}.xml`;

    const insertResult = await client.query(
      `INSERT INTO invoices (
        company_id,
        customer_id,
        product_id,
        number,
        series,
        access_key,
        issue_date,
        total_value,
        status,
        notes,
        file_name,
        file_type,
        file_data,
        xml_file_name,
        xml_file_type,
        xml_file_data,
        generated_access_key,
        environment_mode,
        invoice_meta,
        sefaz_status,
        sale_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING id`,
      [
        companyId,
        customerId,
        productId,
        generatedNumber,
        series,
        accessKey,
        issueDate,
        totalValue,
        status,
        notes,
        fileName,
        fileType,
        fileBuffer,
        xmlFileName,
        "application/xml",
        xmlBuffer,
        accessKey,
        environmentMode,
        JSON.stringify(invoiceMeta),
        environmentMode === "producao" ? "Pendente envio producao" : "Pendente envio homologacao",
        saleId
      ]
    );

    await markSaleAsInvoiced(client, saleId);

    await client.query("COMMIT");
    const insertedId = insertResult.rows[0]?.id;

    revalidatePath("/notas");
    revalidatePath("/notas/enviar");
    revalidatePath("/");
    return insertedId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateInvoice(formData) {
  await ensureSchema();

  const file = formData.get("invoiceFile");
  const companyId = Number(required(formData.get("companyId"), "Empresa"));
  const customerId = Number(required(formData.get("customerId"), "Cliente"));
  const number = required(formData.get("number"), "Numero da nota");
  const series = formData.get("series") || "1";
  const issueDate = required(formData.get("issueDate"), "Data de emissao");
  const totalValue = asMoney(formData.get("totalValue"));
  const invoiceMeta = getInvoiceMeta(formData);
  const firstItem = invoiceMeta.items?.[0];
  const productId = firstItem?.productId || null;
  const saleId = asInteger(formData.get("saleId"), null);
  const environmentMode = invoiceMeta.environmentMode;
  const status = formData.get("status") || "XML gerado";
  const notes = formData.get("notes") || null;
  const invoiceId = Number(required(formData.get("id"), "ID da nota"));
  const db = getDb();
  const client = await db.connect();

  if (!invoiceMeta.items?.length) {
    throw new Error("Adicione pelo menos um produto antes de salvar a nota.");
  }

  try {
    await client.query("BEGIN");

    const [companyResult, customerResult, productResult, allProductsResult] = await Promise.all([
      client.query("SELECT * FROM companies WHERE id = $1", [companyId]),
      client.query("SELECT * FROM customers WHERE id = $1", [customerId]),
      productId ? client.query("SELECT * FROM products WHERE id = $1", [productId]) : Promise.resolve({ rows: [] }),
      client.query("SELECT * FROM products ORDER BY id")
    ]);

    if (companyResult.rows.length === 0) {
      throw new Error("Empresa nao encontrada para atualizar a nota.");
    }

    if (customerResult.rows.length === 0) {
      throw new Error("Cliente nao encontrado para atualizar a nota.");
    }

    await syncProductPricesFromInvoiceItems(client, invoiceMeta.items);

    const accessKey = String(formData.get("accessKey") || generateAccessKey({
      companyCnpj: companyResult.rows[0].cnpj,
      issueDate,
      series,
      number
    }));

    const xml = generateInvoiceXml({
      company: companyResult.rows[0],
      customer: customerResult.rows[0],
      product: productResult.rows[0] || null,
      products: allProductsResult.rows,
      invoice: {
        number,
        series,
        issueDate,
        totalValue,
        notes,
        accessKey,
        environmentMode,
        meta: invoiceMeta
      }
    });

    const xmlBuffer = Buffer.from(xml, "utf-8");
    const xmlFileName = `nfe-${number}.xml`;

    if (file && typeof file.arrayBuffer === "function" && file.size > 0) {
      const fileBuffer = Buffer.from(await file.arrayBuffer());

      await client.query(
        `UPDATE invoices
         SET company_id = $1, customer_id = $2, product_id = $3, number = $4, series = $5,
             access_key = $6, issue_date = $7, total_value = $8, status = $9, notes = $10,
             file_name = $11, file_type = $12, file_data = $13,
             xml_file_name = $14, xml_file_type = $15, xml_file_data = $16, generated_access_key = $17,
             environment_mode = $18, invoice_meta = $19, sefaz_status = $20, sale_id = $21
         WHERE id = $22`,
        [
          companyId,
          customerId,
          productId,
          number,
          series,
          accessKey,
          issueDate,
          totalValue,
          status,
          notes,
          file.name,
          file.type || "application/octet-stream",
          fileBuffer,
          xmlFileName,
          "application/xml",
          xmlBuffer,
          accessKey,
          environmentMode,
          JSON.stringify(invoiceMeta),
          environmentMode === "producao" ? "Pendente envio producao" : "Pendente envio homologacao",
          saleId,
          invoiceId
        ]
      );
    } else {
      await client.query(
        `UPDATE invoices
         SET company_id = $1, customer_id = $2, product_id = $3, number = $4, series = $5,
             access_key = $6, issue_date = $7, total_value = $8, status = $9, notes = $10,
             xml_file_name = $11, xml_file_type = $12, xml_file_data = $13, generated_access_key = $14,
             environment_mode = $15, invoice_meta = $16, sefaz_status = $17, sale_id = $18
         WHERE id = $19`,
        [
          companyId,
          customerId,
          productId,
          number,
          series,
          accessKey,
          issueDate,
          totalValue,
          status,
          notes,
          xmlFileName,
          "application/xml",
          xmlBuffer,
          accessKey,
          environmentMode,
          JSON.stringify(invoiceMeta),
          environmentMode === "producao" ? "Pendente envio producao" : "Pendente envio homologacao",
          saleId,
          invoiceId
        ]
      );
    }

    await markSaleAsInvoiced(client, saleId);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  revalidatePath("/notas");
  revalidatePath("/");
  redirect("/notas");
}

export async function createInvoiceAndSend(formData) {
  try {
    const invoiceId = await createInvoice(formData);

    if (!invoiceId) {
      throw new Error("Nao foi possivel registrar a nota antes do envio.");
    }

    await transmitInvoice(invoiceId);
    revalidatePath("/notas");
    revalidatePath("/notas/enviar");
    revalidatePath("/");
    redirect("/notas");
  } catch (error) {
    rethrowIfRedirectError(error);
    redirectWithError("/notas/enviar", error);
  }
}

export async function saveInvoiceDraft(formData) {
  try {
    await createInvoice(formData);
    revalidatePath("/notas");
    revalidatePath("/notas/enviar");
    revalidatePath("/");
    redirect("/notas");
  } catch (error) {
    rethrowIfRedirectError(error);
    redirectWithError("/notas/enviar", error);
  }
}

export async function sendInvoiceToSefaz(formData) {
  try {
    await ensureSchema();
    const invoiceId = Number(required(formData.get("id"), "ID da nota"));
    await transmitInvoice(invoiceId);
    revalidatePath("/notas");
    revalidatePath("/");
    redirect("/notas");
  } catch (error) {
    rethrowIfRedirectError(error);
    redirectWithError("/notas", error);
  }
}

export async function sendInvoiceEmail(formData) {
  try {
    await ensureSchema();
    const invoiceId = Number(required(formData.get("id"), "ID da nota"));
    const { invoice, company, customer, pdfBuffer, pdfFileName } = await buildInvoicePdfDocument(invoiceId);
    const customerEmail = normalizeEmail(customer.email);

    if (!customerEmail) {
      throw new Error("O cliente desta nota nao possui e-mail cadastrado.");
    }

    if (!invoice.xml_file_data) {
      throw new Error("A nota ainda nao possui XML gerado para envio.");
    }

    if (!company.smtp_host || !company.smtp_port || !company.smtp_user || !company.smtp_password || !company.smtp_from_email) {
      throw new Error("Configure o SMTP da empresa antes de enviar e-mail.");
    }

    const smtpPassword = decryptSecretText(company.smtp_password);

    if (!smtpPassword) {
      throw new Error("A senha SMTP criptografada da empresa nao esta disponivel.");
    }

    const transporter = nodemailer.createTransport({
      host: company.smtp_host,
      port: Number(company.smtp_port),
      secure: Boolean(company.smtp_secure),
      auth: {
        user: company.smtp_user,
        pass: smtpPassword
      }
    });

    await transporter.sendMail({
      from: company.smtp_from_name
        ? `"${company.smtp_from_name}" <${company.smtp_from_email}>`
        : company.smtp_from_email,
      to: customerEmail,
      subject: `Nota fiscal ${invoice.number}${invoice.series ? `/${invoice.series}` : ""}`,
      text: [
        `Segue a nota fiscal ${invoice.number}${invoice.series ? `/${invoice.series}` : ""}.`,
        "",
        `Emitente: ${company.trade_name || company.legal_name || "-"}`,
        `Cliente: ${customer.full_name || "-"}`,
        `Valor total: R$ ${Number(invoice.total_value || 0).toFixed(2).replace(".", ",")}`
      ].join("\n"),
      attachments: [
        {
          filename: pdfFileName,
          content: pdfBuffer,
          contentType: "application/pdf"
        },
        {
          filename: invoice.xml_file_name || `nfe-${invoice.number || invoiceId}.xml`,
          content: invoice.xml_file_data,
          contentType: invoice.xml_file_type || "application/xml"
        }
      ]
    });

    redirect("/notas?success=" + encodeURIComponent("E-mail da nota enviado com sucesso."));
  } catch (error) {
    rethrowIfRedirectError(error);
    redirectWithError("/notas", error);
  }
}

export async function consultInvoiceOnSefaz(formData) {
  let client;

  try {
    await ensureSchema();
    const invoiceId = Number(required(formData.get("id"), "ID da nota"));
    const db = getDb();
    client = await db.connect();

    await client.query("BEGIN");
    const context = await getInvoiceContext(client, invoiceId);
    assertInvoiceCanConsult(context.invoice);
    const wizard = await loadNfeWizard({
      company: context.company,
      invoiceId,
      environmentMode: context.invoice.environment_mode
    });
    const sefazResponse = await consultProtocolWithRetry(
      wizard,
      context.invoice.access_key || context.invoice.generated_access_key
    );
    const serialized = JSON.stringify(sefazResponse);
    const protocolNumber =
      sefazResponse?.protNFe?.infProt?.nProt ||
      sefazResponse?.retConsSitNFe?.protNFe?.infProt?.nProt ||
      context.invoice.protocol_number ||
      null;
    const statusText =
      sefazResponse?.protNFe?.infProt?.xMotivo ||
      sefazResponse?.retConsSitNFe?.protNFe?.infProt?.xMotivo ||
      sefazResponse?.retConsSitNFe?.procEventoNFe?.retEvento?.infEvento?.xMotivo ||
      sefazResponse?.procEventoNFe?.retEvento?.infEvento?.xMotivo ||
      sefazResponse?.retConsSitNFe?.xMotivo ||
      "Consulta realizada";
    const updatedStatus = resolveConsultStatus(sefazResponse, context.invoice.status);
    const cancelProtocol =
      sefazResponse?.retConsSitNFe?.procEventoNFe?.retEvento?.infEvento?.nProt ||
      sefazResponse?.procEventoNFe?.retEvento?.infEvento?.nProt ||
      sefazResponse?.retEvento?.infEvento?.nProt ||
      context.invoice.cancel_protocol_number ||
      null;

    await client.query(
      `UPDATE invoices
       SET status = $1::text,
           sefaz_status = $2::text,
           protocol_number = COALESCE($3::text, protocol_number),
           cancel_protocol_number = CASE WHEN $1::text = 'Cancelada' THEN COALESCE($4::text, cancel_protocol_number) ELSE cancel_protocol_number END,
           cancelled_at = CASE WHEN $1::text = 'Cancelada' THEN COALESCE(cancelled_at, CURRENT_TIMESTAMP) ELSE cancelled_at END,
           sefaz_response = $5::text
       WHERE id = $6::integer`,
      [updatedStatus, statusText, protocolNumber, cancelProtocol, serialized, invoiceId]
    );
    await client.query("COMMIT");
    revalidatePath("/notas");
    revalidatePath("/");
    redirect("/notas");
  } catch (error) {
    rethrowIfRedirectError(error);
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }

    if (isForbiddenSefazError(error) || String(error?.message || "").includes("bloqueou temporariamente")) {
      try {
        const fallbackMessage = "A SEFAZ bloqueou temporariamente a consulta. Os ultimos dados salvos da nota continuam disponiveis.";
        redirect("/notas?success=" + encodeURIComponent(fallbackMessage));
      } catch {
        // Se o redirect falhar por qualquer motivo, cai para a mensagem amigavel abaixo.
      }
    }

    redirectWithError("/notas", getFriendlySefazError(error));
  } finally {
    client?.release();
  }
}

export async function cancelInvoiceOnSefaz(formData) {
  let client;

  try {
    await ensureSchema();
    const invoiceId = Number(required(formData.get("id"), "ID da nota"));
    const justification = validateCancelReason(
      required(formData.get("cancelReason"), "Justificativa do cancelamento")
    );
    const db = getDb();
    client = await db.connect();

    await client.query("BEGIN");
    const context = await getInvoiceContext(client, invoiceId);
    assertInvoiceCanCancel(context.invoice);
    const wizard = await loadNfeWizard({
      company: context.company,
      invoiceId,
      environmentMode: context.invoice.environment_mode
    });
    const payload = buildCancelPayload({
      invoice: context.invoice,
      company: context.company,
      justification
    });
    const sefazResponse = await wizard.NFE_Cancelamento(payload);
    const serialized = JSON.stringify(sefazResponse);
    const cancelProtocol =
      sefazResponse?.retEvento?.infEvento?.nProt ||
      sefazResponse?.procEventoNFe?.retEvento?.infEvento?.nProt ||
      null;

    await client.query(
      `UPDATE invoices
       SET status = 'Cancelada',
           sefaz_status = 'Cancelamento enviado',
           cancelled_at = CURRENT_TIMESTAMP,
           cancel_protocol_number = COALESCE($1, cancel_protocol_number),
           sefaz_response = $2
       WHERE id = $3`,
      [cancelProtocol, serialized, invoiceId]
    );
    await client.query("COMMIT");
    revalidatePath("/notas");
    revalidatePath("/");
    redirect("/notas");
  } catch (error) {
    rethrowIfRedirectError(error);
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }
    redirectWithError("/notas", error);
  } finally {
    client?.release();
  }
}

export async function deleteInvoice(formData) {
  let client;

  try {
    await ensureSchema();
    const invoiceId = Number(required(formData.get("id"), "ID da nota"));
    const db = getDb();
    client = await db.connect();
    await client.query("BEGIN");
    const context = await getInvoiceContext(client, invoiceId);
    assertInvoiceCanDelete(context.invoice);
    await client.query("DELETE FROM invoices WHERE id = $1", [invoiceId]);
    await client.query("COMMIT");
    revalidatePath("/notas");
    revalidatePath("/");
    redirect("/notas");
  } catch (error) {
    rethrowIfRedirectError(error);
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }
    redirectWithError("/notas", error);
  } finally {
    client?.release();
  }
}

export async function cloneInvoice(formData) {
  let client;

  try {
    await ensureSchema();
    const invoiceId = Number(required(formData.get("id"), "ID da nota"));
    const db = getDb();
    client = await db.connect();
    await client.query("BEGIN");

    const invoiceResult = await client.query("SELECT * FROM invoices WHERE id = $1", [invoiceId]);
    const invoice = invoiceResult.rows[0];

    if (!invoice) {
      throw new Error("Nota fiscal nao encontrada.");
    }

    const companyResult = await client.query(
      `UPDATE companies
       SET invoice_next_number = COALESCE(invoice_next_number, 1) + 1
       WHERE id = $1
       RETURNING *`,
      [invoice.company_id]
    );

    if (companyResult.rows.length === 0) {
      throw new Error("Empresa nao encontrada para clonar a nota.");
    }

    const company = companyResult.rows[0];
    const customerResult = await client.query("SELECT * FROM customers WHERE id = $1", [invoice.customer_id]);
    const productResult = invoice.product_id
      ? await client.query("SELECT * FROM products WHERE id = $1", [invoice.product_id])
      : { rows: [] };
    const allProductsResult = await client.query("SELECT * FROM products ORDER BY id");

    if (customerResult.rows.length === 0) {
      throw new Error("Cliente nao encontrado para clonar a nota.");
    }

    const invoiceMeta =
      typeof invoice.invoice_meta === "string"
        ? JSON.parse(invoice.invoice_meta || "{}")
        : invoice.invoice_meta || {};
    const generatedNumber = String((company.invoice_next_number || 2) - 1);
    const series = String(invoice.series || company.invoice_series || "1");
    const accessKey = generateAccessKey({
      companyCnpj: company.cnpj,
      issueDate: invoice.issue_date,
      series,
      number: generatedNumber
    });
    const xml = generateInvoiceXml({
      company,
      customer: customerResult.rows[0],
      product: productResult.rows[0] || null,
      products: allProductsResult.rows,
      invoice: {
        number: generatedNumber,
        series,
        issueDate: invoice.issue_date,
        totalValue: invoice.total_value,
        notes: invoice.notes,
        accessKey,
        environmentMode: invoice.environment_mode,
        meta: invoiceMeta
      }
    });
    const xmlBuffer = Buffer.from(xml, "utf-8");

    const insertResult = await client.query(
      `INSERT INTO invoices (
        company_id,
        customer_id,
        product_id,
        number,
        series,
        access_key,
        issue_date,
        total_value,
        status,
        notes,
        file_name,
        file_type,
        file_data,
        xml_file_name,
        xml_file_type,
        xml_file_data,
        generated_access_key,
        environment_mode,
        invoice_meta,
        sefaz_status,
        protocol_number,
        receipt_number,
        sent_at,
        cancelled_at,
        cancel_protocol_number,
        sefaz_response,
        signed_xml_data,
        signed_xml_file_name,
        signed_xml_file_type
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, 'XML gerado', $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      )
      RETURNING id`,
      [
        invoice.company_id,
        invoice.customer_id,
        invoice.product_id,
        generatedNumber,
        series,
        accessKey,
        invoice.issue_date,
        invoice.total_value,
        invoice.notes,
        invoice.file_name,
        invoice.file_type,
        invoice.file_data,
        `${accessKey}.xml`,
        "application/xml",
        xmlBuffer,
        accessKey,
        invoice.environment_mode,
        JSON.stringify(invoiceMeta),
        invoice.environment_mode === "producao" ? "Pendente envio producao" : "Pendente envio homologacao"
      ]
    );

    await client.query("COMMIT");
    const clonedId = insertResult.rows[0]?.id;
    revalidatePath("/notas");
    revalidatePath("/notas/enviar");
    redirect(`/notas/enviar?edit=${clonedId}&success=${encodeURIComponent("Nota clonada com sucesso.")}`);
  } catch (error) {
    rethrowIfRedirectError(error);
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }
    redirectWithError("/notas", error);
  } finally {
    client?.release();
  }
}

export async function loginAction(formData) {
  await loginUser(
    required(formData.get("userCode"), "Usuario"),
    required(formData.get("password"), "Senha")
  );

  redirect("/");
}

export async function logoutAction() {
  await logoutUser();
  redirect("/login");
}

export async function createUserAction(formData) {
  try {
    await requireAdmin();
    const userCode = required(formData.get("userCode"), "Usuario");

    if (String(userCode).trim() === "0") {
      throw new Error("O usuario 0 ja existe e e reservado para a administracao principal.");
    }

    await createUserAccount({
      userCode,
      fullName: required(formData.get("fullName"), "Nome completo"),
      password: required(formData.get("password"), "Senha"),
      isAdmin: String(formData.get("isAdmin") || "") === "on"
    });

    revalidatePath("/usuarios");
    redirect("/usuarios");
  } catch (error) {
    rethrowIfRedirectError(error);
    redirectWithError("/usuarios", error);
  }
}

export async function updateUserAction(formData) {
  try {
    await requireAdmin();
    await ensureSchema();

    const userId = Number(required(formData.get("id"), "ID do usuario"));
    const fullName = required(formData.get("fullName"), "Nome completo");
    const nextPassword = String(formData.get("password") || "");
    const isReservedUser = userId === 0;
    const isAdmin = isReservedUser ? true : String(formData.get("isAdmin") || "") === "on";

    if (isReservedUser) {
      await query(
        `UPDATE users
         SET full_name = $1,
             is_admin = true
         WHERE id = 0`,
        [fullName]
      );
    } else if (nextPassword.trim()) {
      await query(
        `UPDATE users
         SET full_name = $1,
             is_admin = $2,
             password_hash = $3
         WHERE id = $4`,
        [fullName, isAdmin, hashUserPassword(nextPassword), userId]
      );
    } else {
      await query(
        `UPDATE users
         SET full_name = $1,
             is_admin = $2
         WHERE id = $3`,
        [fullName, isAdmin, userId]
      );
    }

    revalidatePath("/usuarios");
    redirect("/usuarios?success=" + encodeURIComponent("Usuario atualizado com sucesso."));
  } catch (error) {
    rethrowIfRedirectError(error);
    redirectWithError("/usuarios", error);
  }
}

export async function deleteUserAction(formData) {
  try {
    await requireAdmin();
    await ensureSchema();

    const userId = Number(required(formData.get("id"), "ID do usuario"));

    if (userId === 0) {
      throw new Error("O usuario 0 nao pode ser excluido.");
    }

    await query("DELETE FROM users WHERE id = $1", [userId]);

    revalidatePath("/usuarios");
    redirect("/usuarios?success=" + encodeURIComponent("Usuario excluido com sucesso."));
  } catch (error) {
    rethrowIfRedirectError(error);
    redirectWithError("/usuarios", error);
  }
}
