"use client";

import { useMemo, useState } from "react";
import { cancelInvoiceOnSefaz, consultInvoiceOnSefaz, sendInvoiceToSefaz } from "@/app/actions";
import { FormSubmitButton } from "@/components/FormSubmitButton";

function normalizeCancelReason(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function InvoiceActionPanel({ invoiceId, canSend, canConsult, canCancel }) {
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const sanitizedReason = useMemo(() => normalizeCancelReason(cancelReason), [cancelReason]);
  const isValidReason = sanitizedReason.trim().length >= 15 && sanitizedReason === cancelReason;

  return (
    <div className="invoice-action-panel">
      <div className="invoice-action-head">
        <strong>Painel SEFAZ</strong>
        <span>Envio, consulta e cancelamento</span>
      </div>

      <div className="invoice-action-buttons">
        {canSend ? (
          <form action={sendInvoiceToSefaz}>
            <input type="hidden" name="id" value={invoiceId} />
            <FormSubmitButton
              className="button secondary small"
              idleText="Enviar"
              pendingText="Enviando..."
            />
          </form>
        ) : (
          <span className="status-pill subtle">Envio bloqueado</span>
        )}

        {canConsult ? (
          <form action={consultInvoiceOnSefaz}>
            <input type="hidden" name="id" value={invoiceId} />
            <FormSubmitButton
              className="button secondary small"
              idleText="Consultar"
              pendingText="Consultando..."
            />
          </form>
        ) : (
          <span className="status-pill subtle">Sem chave</span>
        )}

        {canCancel ? (
          <button
            type="button"
            className="button danger small"
            onClick={() => setShowCancelForm((current) => !current)}
          >
            {showCancelForm ? "Fechar cancelamento" : "Cancelar"}
          </button>
        ) : (
          <span className="status-pill subtle">Sem protocolo</span>
        )}
      </div>

      {showCancelForm && canCancel ? (
        <form action={cancelInvoiceOnSefaz} className="invoice-cancel-panel">
          <input type="hidden" name="id" value={invoiceId} />
          <label className="full">
            Motivo do cancelamento
            <input
              name="cancelReason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              placeholder="Digite o motivo sem acentos"
              minLength={15}
              required
            />
          </label>
          <p className="cancel-help">
            Informe no minimo 15 caracteres e sem acentos.
          </p>
          {sanitizedReason !== cancelReason ? (
            <p className="form-error compact-error">Remova os acentos antes de cancelar.</p>
          ) : null}
          <FormSubmitButton
            className="button danger small"
            idleText="Confirmar cancelamento"
            pendingText="Cancelando..."
            disabled={!isValidReason}
          />
        </form>
      ) : null}
    </div>
  );
}
