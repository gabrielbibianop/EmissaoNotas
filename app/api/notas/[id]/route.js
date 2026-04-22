import { ensureSchema, query } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_, { params }) {
  await requireAuth();
  await ensureSchema();

  const result = await query(
    `SELECT file_name, file_type, file_data
     FROM invoices
     WHERE id = $1`,
    [Number(params.id)]
  );

  if (result.rows.length === 0) {
    return new Response("Nota não encontrada.", { status: 404 });
  }

  const invoice = result.rows[0];

  if (!invoice.file_data) {
    return new Response("Esta nota não possui arquivo salvo.", { status: 404 });
  }

  return new Response(invoice.file_data, {
    headers: {
      "Content-Type": invoice.file_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${invoice.file_name || `nota-${params.id}`}"`,
      "Cache-Control": "no-store"
    }
  });
}
