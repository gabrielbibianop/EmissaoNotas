import { createInvoiceAndSend, saveInvoiceDraft, updateInvoice } from "@/app/actions";
import { InvoiceForm } from "@/components/InvoiceForm";
import { ensureSchema, query } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getFormData() {
  await ensureSchema();

  const [companies, customers, products] = await Promise.all([
    query(`
      SELECT id, trade_name, legal_name, certificate_name, invoice_series, invoice_next_number, city, state
      FROM companies
      ORDER BY trade_name NULLS LAST, legal_name
    `),
    query(`
      SELECT id, full_name, document, city, state, state_registration
      FROM customers
      ORDER BY full_name
    `),
    query("SELECT id, name, sku, ncm, cbenef, price FROM products ORDER BY name")
  ]);

  return {
    companies: companies.rows,
    customers: customers.rows,
    products: products.rows
  };
}

async function getInvoiceToEdit(invoiceId) {
  if (!invoiceId) {
    return null;
  }

  await ensureSchema();

  const result = await query(
    `SELECT *
     FROM invoices
     WHERE id = $1`,
    [invoiceId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const invoice = result.rows[0];
  let invoiceMeta = {};

  try {
    invoiceMeta = typeof invoice.invoice_meta === "string" ? JSON.parse(invoice.invoice_meta || "{}") : invoice.invoice_meta || {};
  } catch {
    invoiceMeta = {};
  }

  return {
    id: invoice.id,
    saleId: invoice.sale_id || null,
    companyId: invoice.company_id,
    customerId: invoice.customer_id,
    number: invoice.number,
    series: invoice.series || "",
    accessKey: invoice.access_key || invoice.generated_access_key || "",
    issueDate: new Date(invoice.issue_date).toISOString().slice(0, 10),
    status: invoice.status,
    notes: invoice.notes || "",
    invoiceMeta
  };
}

async function getSaleToInvoice(saleId) {
  if (!saleId) {
    return null;
  }

  await ensureSchema();

  const saleResult = await query(
    `SELECT *
     FROM sales
     WHERE id = $1`,
    [saleId]
  );

  if (saleResult.rows.length === 0) {
    return null;
  }

  const sale = saleResult.rows[0];
  let saleMeta = {};

  try {
    saleMeta = typeof sale.sale_meta === "string" ? JSON.parse(sale.sale_meta || "{}") : sale.sale_meta || {};
  } catch {
    saleMeta = {};
  }

  return {
    saleId: sale.id,
    companyId: sale.company_id,
    customerId: sale.customer_id,
    issueDate: new Date(sale.sale_date).toISOString().slice(0, 10),
    number: "",
    series: "",
    accessKey: "",
    status: "XML gerado",
    notes: sale.notes || "",
    invoiceMeta: {
      operationMode: "emissao",
      environmentMode: "homologacao",
      nfType: "saida",
      nature: "Venda",
      cfopCode: saleMeta.items?.[0]?.cfop || "5102",
      paymentMethod: "90",
      paymentType: "A vista",
      buyerPresence: "1",
      discountValue: 0,
      baseCalcValue: sale.total_value,
      icmsValue: 0,
      baseCalcStValue: 0,
      icmsStValue: 0,
      totalProductsValue: sale.total_value,
      freightValue: 0,
      ipiValue: 0,
      insuranceValue: 0,
      otherValue: 0,
      funruralMode: "nao_desconta_nao_informa",
      funruralPercent: 0,
      funruralValue: 0,
      totalInvoiceValue: sale.total_value,
      items: Array.isArray(saleMeta.items) ? saleMeta.items : []
    }
  };
}

function getErrorMessage(error) {
  if (!error) {
    return null;
  }

  return decodeURIComponent(String(error));
}

export default async function SendInvoicePage({ searchParams }) {
  const { companies, customers, products } = await getFormData();
  const params = await searchParams;
  const errorMessage = getErrorMessage(params?.error);
  const editId = Number(params?.edit || 0);
  const saleId = Number(params?.sale || 0);
  const initialData = (await getInvoiceToEdit(editId)) || (await getSaleToInvoice(saleId));

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Emissao Completa</p>
          <h2>Central NF-e</h2>
          <p className="section-copy">
            {initialData
              ? "Edicao completa da nota em uma unica tela, com os dados carregados da manutencao."
              : "Tela refeita a partir do Delphi: identificacao, dados fiscais, item, totais, transporte, faturamento, observacoes e envio real para SEFAZ."}
          </p>
        </div>
      </header>

      <InvoiceForm
        companies={companies}
        customers={customers}
        products={products}
        saveInvoiceDraft={initialData ? updateInvoice : saveInvoiceDraft}
        createInvoiceAndSend={createInvoiceAndSend}
        errorMessage={errorMessage}
        initialData={initialData}
      />
    </section>
  );
}
