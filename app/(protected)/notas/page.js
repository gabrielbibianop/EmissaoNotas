import Link from "next/link";
import {
  cloneInvoice,
  deleteInvoice,
  sendInvoiceEmail
} from "@/app/actions";
import { DeleteButton } from "@/components/DeleteButton";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { InvoiceActionPanel } from "@/components/InvoiceActionPanel";
import { ensureSchema, query } from "@/lib/db";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

function readInvoiceMeta(invoice) {
  if (!invoice?.invoice_meta) {
    return {};
  }

  try {
    return typeof invoice.invoice_meta === "string" ? JSON.parse(invoice.invoice_meta) : invoice.invoice_meta;
  } catch {
    return {};
  }
}

function hasSefazTransmission(invoice) {
  return Boolean(
    invoice.sent_at ||
    invoice.protocol_number ||
    invoice.receipt_number ||
    invoice.cancelled_at ||
    ["Autorizada", "Transmitida", "Cancelada"].includes(String(invoice.status || ""))
  );
}

function canSendInvoice(invoice) {
  return !hasSefazTransmission(invoice);
}

function canConsultInvoice(invoice) {
  return Boolean(invoice.access_key || invoice.generated_access_key);
}

function canCancelInvoice(invoice) {
  return Boolean(invoice.protocol_number) && String(invoice.status || "") !== "Cancelada";
}

function canDeleteInvoice(invoice) {
  return !hasSefazTransmission(invoice);
}

async function getInvoices() {
  await ensureSchema();
  const result = await query(`
    SELECT
      invoices.id,
      invoices.company_id,
      invoices.customer_id,
      invoices.product_id,
      invoices.number,
      invoices.series,
      invoices.access_key,
      invoices.generated_access_key,
      invoices.issue_date,
      invoices.total_value,
      invoices.status,
      invoices.environment_mode,
      invoices.sefaz_status,
      invoices.protocol_number,
      invoices.receipt_number,
      invoices.sent_at,
      invoices.cancelled_at,
      invoices.notes,
      invoices.invoice_meta,
      invoices.file_name,
      invoices.xml_file_name,
      companies.trade_name,
      companies.legal_name,
      customers.full_name,
      products.name AS product_name
    FROM invoices
    LEFT JOIN companies ON companies.id = invoices.company_id
    LEFT JOIN customers ON customers.id = invoices.customer_id
    LEFT JOIN products ON products.id = invoices.product_id
    ORDER BY invoices.issue_date DESC, invoices.created_at DESC
  `);

  return result.rows;
}

export default async function InvoicesPage({ searchParams }) {
  const invoices = await getInvoices();
  const params = await searchParams;
  const errorMessage = params?.error ? decodeURIComponent(String(params.error)) : null;
  const successMessage = params?.success ? decodeURIComponent(String(params.success)) : null;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Manutencao</p>
          <h2>Notas emitidas</h2>
          <p className="section-copy">
            Consulte as notas registradas, veja a chave gerada, baixe o XML e mantenha o arquivo complementar disponivel.
          </p>
        </div>
      </header>

      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      <section className="panel list-panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Numero</th>
                <th>Empresa</th>
                <th>Cliente</th>
                <th>Produto</th>
                <th>Emissao</th>
                <th>Valor</th>
                <th>Status</th>
                <th>SEFAZ</th>
                <th>Arquivos</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan="10">Nenhuma nota registrada ainda.</td>
                </tr>
              ) : (
                invoices.map((invoice) => {
                  const invoiceMeta = readInvoiceMeta(invoice);
                  const items = Array.isArray(invoiceMeta.items) && invoiceMeta.items.length > 0
                    ? invoiceMeta.items
                    : invoiceMeta.item
                      ? [invoiceMeta.item]
                      : [];
                  const productsLabel = items.length > 1
                    ? `${items.length} produtos`
                    : items[0]?.description || invoice.product_name || "-";

                  return (
                    <tr key={invoice.id}>
                    <td>{invoice.number}{invoice.series ? ` / ${invoice.series}` : ""}</td>
                    <td>{invoice.trade_name || invoice.legal_name || "-"}</td>
                    <td>{invoice.full_name || "-"}</td>
                    <td>{productsLabel}</td>
                    <td>{formatDate(invoice.issue_date)}</td>
                    <td>{formatCurrency(invoice.total_value)}</td>
                    <td><span className="status-pill">{invoice.status}</span></td>
                    <td>
                      <div className="stacked-meta">
                        <span className="status-pill subtle">{invoice.environment_mode === "producao" ? "Producao" : "Homologacao"}</span>
                        <span>{invoice.sefaz_status || "Nao transmitida"}</span>
                        <span>{invoice.protocol_number ? `Prot. ${invoice.protocol_number}` : invoice.receipt_number ? `Rec. ${invoice.receipt_number}` : "-"}</span>
                      </div>
                    </td>
                    <td>
                      <div className="table-actions">
                        {invoice.xml_file_name ? (
                          <Link href={`/api/notas/${invoice.id}/xml`} className="download-link">
                            XML
                          </Link>
                        ) : null}
                        <Link
                          href={`/api/notas/${invoice.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="download-link"
                        >
                          PDF
                        </Link>
                        {invoice.file_name ? (
                          <Link href={`/api/notas/${invoice.id}`} className="download-link">
                            Anexo
                          </Link>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Link href={`/notas/enviar?edit=${invoice.id}`} className="button secondary small">Editar</Link>
                        <form action={cloneInvoice}>
                          <input type="hidden" name="id" value={invoice.id} />
                          <button type="submit" className="button secondary small">Clonar nota</button>
                        </form>
                        <form action={sendInvoiceEmail}>
                          <input type="hidden" name="id" value={invoice.id} />
                          <FormSubmitButton
                            className="button secondary small"
                            idleText="Enviar e-mail"
                            pendingText="Enviando..."
                          />
                        </form>
                        <Link
                          href={`/api/notas/${invoice.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="button secondary small"
                        >
                          Salvar PDF
                        </Link>
                        <InvoiceActionPanel
                          invoiceId={invoice.id}
                          canSend={canSendInvoice(invoice)}
                          canConsult={canConsultInvoice(invoice)}
                          canCancel={canCancelInvoice(invoice)}
                        />
                        <form action={deleteInvoice}>
                          <input type="hidden" name="id" value={invoice.id} />
                          <DeleteButton disabled={!canDeleteInvoice(invoice)} />
                        </form>
                      </div>
                    </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
