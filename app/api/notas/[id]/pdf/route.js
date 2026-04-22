import { ensureSchema } from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { buildInvoicePdfDocument } from "@/lib/invoice-documents";

export const runtime = "nodejs";

export async function GET(request, { params }) {
  await requireAuth();
  await ensureSchema();
  const resolvedParams = await params;
  const invoiceId = Number(resolvedParams.id);

  try {
    const { pdfBuffer, pdfFileName } = await buildInvoicePdfDocument(invoiceId);
    const url = new URL(request.url);
    const dispositionType = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    const body = pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer);

    return new Response(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${dispositionType}; filename="${pdfFileName}"`,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Accept-Ranges": "bytes"
      }
    });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Nao foi possivel gerar o PDF da nota.",
      { status: 400 }
    );
  }
}
