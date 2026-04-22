import { ensureSchema, query } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_, { params }) {
  await requireAuth();
  await ensureSchema();
  const resolvedParams = await params;
  const invoiceId = Number(resolvedParams.id);

  const result = await query(
    `SELECT xml_file_name, xml_file_type, xml_file_data
     FROM invoices
     WHERE id = $1`,
    [invoiceId]
  );

  if (result.rows.length === 0) {
    return new Response("Nota nao encontrada.", { status: 404 });
  }

  const invoice = result.rows[0];

  if (!invoice.xml_file_data) {
    return new Response("Esta nota nao possui XML gerado.", { status: 404 });
  }

  return new Response(invoice.xml_file_data, {
    headers: {
      "Content-Type": invoice.xml_file_type || "application/xml",
      "Content-Disposition": `attachment; filename="${invoice.xml_file_name || `nfe-${invoiceId}.xml`}"`,
      "Cache-Control": "no-store"
    }
  });
}
