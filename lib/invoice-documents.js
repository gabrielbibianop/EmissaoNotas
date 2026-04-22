import { ensureSchema, query } from "@/lib/db";
import { generateInvoicePdf } from "@/lib/invoice-pdf";

export async function getInvoiceDocumentContext(invoiceId) {
  await ensureSchema();

  const invoiceResult = await query(
    `SELECT
      invoices.*,
      companies.legal_name AS company_legal_name,
      companies.trade_name AS company_trade_name,
      companies.cnpj AS company_cnpj,
      companies.email AS company_email,
      companies.phone AS company_phone,
      companies.state_registration AS company_state_registration,
      companies.address AS company_address,
      companies.address_line AS company_address_line,
      companies.address_number AS company_address_number,
      companies.address_complement AS company_address_complement,
      companies.district AS company_district,
      companies.city AS company_city,
      companies.state AS company_state,
      companies.zip_code AS company_zip_code,
      companies.smtp_host,
      companies.smtp_port,
      companies.smtp_user,
      companies.smtp_password,
      companies.smtp_from_name,
      companies.smtp_from_email,
      companies.smtp_secure,
      customers.full_name AS customer_full_name,
      customers.document AS customer_document,
      customers.email AS customer_email,
      customers.phone AS customer_phone,
      customers.address AS customer_address,
      customers.address_line AS customer_address_line,
      customers.address_number AS customer_address_number,
      customers.address_complement AS customer_address_complement,
      customers.state_registration AS customer_state_registration,
      customers.district AS customer_district,
      customers.city AS customer_city,
      customers.state AS customer_state,
      customers.zip_code AS customer_zip_code
     FROM invoices
     LEFT JOIN companies ON companies.id = invoices.company_id
     LEFT JOIN customers ON customers.id = invoices.customer_id
     WHERE invoices.id = $1`,
    [invoiceId]
  );

  if (invoiceResult.rows.length === 0) {
    throw new Error("Nota fiscal nao encontrada.");
  }

  const row = invoiceResult.rows[0];

  return {
    invoice: row,
    company: {
      id: row.company_id,
      legal_name: row.company_legal_name,
      trade_name: row.company_trade_name,
      cnpj: row.company_cnpj,
      email: row.company_email,
      phone: row.company_phone,
      state_registration: row.company_state_registration,
      address: row.company_address,
      address_line: row.company_address_line,
      address_number: row.company_address_number,
      address_complement: row.company_address_complement,
      district: row.company_district,
      city: row.company_city,
      state: row.company_state,
      zip_code: row.company_zip_code,
      smtp_host: row.smtp_host,
      smtp_port: row.smtp_port,
      smtp_user: row.smtp_user,
      smtp_password: row.smtp_password,
      smtp_from_name: row.smtp_from_name,
      smtp_from_email: row.smtp_from_email,
      smtp_secure: row.smtp_secure
    },
    customer: {
      id: row.customer_id,
      full_name: row.customer_full_name,
      document: row.customer_document,
      email: row.customer_email,
      phone: row.customer_phone,
      address: row.customer_address,
      address_line: row.customer_address_line,
      address_number: row.customer_address_number,
      address_complement: row.customer_address_complement,
      state_registration: row.customer_state_registration,
      district: row.customer_district,
      city: row.customer_city,
      state: row.customer_state,
      zip_code: row.customer_zip_code
    }
  };
}

export async function buildInvoicePdfDocument(invoiceId) {
  const context = await getInvoiceDocumentContext(invoiceId);
  const pdfBuffer = await generateInvoicePdf(context);
  const accessKey = context.invoice.access_key || context.invoice.generated_access_key || `nota-${context.invoice.number || invoiceId}`;

  return {
    ...context,
    pdfBuffer,
    pdfFileName: `${accessKey}.pdf`
  };
}
