import Link from "next/link";
import { cloneCustomerToCompany, createCustomer, updateCustomer } from "@/app/actions";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { ensureSchema, query } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getCustomers() {
  await ensureSchema();
  const result = await query(`
    SELECT
      id,
      full_name,
      document,
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
      EXISTS (
        SELECT 1
        FROM invoices
        WHERE invoices.customer_id = customers.id
          AND (
            invoices.sent_at IS NOT NULL OR
            invoices.protocol_number IS NOT NULL OR
            invoices.receipt_number IS NOT NULL OR
            invoices.cancelled_at IS NOT NULL OR
            invoices.status IN ('Autorizada', 'Transmitida', 'Cancelada')
          )
      ) AS has_transmitted_invoice,
      created_at
    FROM customers
    ORDER BY created_at DESC
  `);

  return result.rows;
}

export default async function CustomersPage({ searchParams }) {
  const customers = await getCustomers();
  const params = await searchParams;
  const editingId = Number(params?.edit || 0);
  const successMessage = params?.success ? decodeURIComponent(String(params.success)) : null;
  const errorMessage = params?.error ? decodeURIComponent(String(params.error)) : null;
  const editingCustomer = customers.find((customer) => customer.id === editingId);
  const formAction = editingCustomer ? updateCustomer : createCustomer;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Cadastro Fiscal</p>
          <h2>Clientes</h2>
          <p className="section-copy">
            Estruture os dados do destinatario no mesmo formato usado pela NF-e para evitar rejeicoes na transmissao.
          </p>
        </div>
        <div className="hero-actions">
          <Link href="/clientes/busca" className="button secondary">Buscar clientes</Link>
        </div>
      </header>

      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <form action={formAction} className="panel form-panel form-panel-wide">
        <h3>{editingCustomer ? "Editar cliente" : "Novo cliente"}</h3>
        {editingCustomer ? <input type="hidden" name="id" value={editingCustomer.id} /> : null}

        <div className="form-grid">
          <label>
            Nome / razao social
            <input name="fullName" defaultValue={editingCustomer?.full_name || ""} required />
          </label>
          <label>
            CPF/CNPJ
            <input name="document" defaultValue={editingCustomer?.document || ""} required />
          </label>
          <label>
            IE / RG
            <input name="stateRegistration" defaultValue={editingCustomer?.state_registration || ""} />
          </label>
          <label>
            E-mail
            <input name="email" type="email" defaultValue={editingCustomer?.email || ""} />
          </label>
          <label>
            Telefone
            <input name="phone" defaultValue={editingCustomer?.phone || ""} />
          </label>
          <label className="full">
            Endereco livre
            <textarea name="address" rows="3" defaultValue={editingCustomer?.address || ""} />
          </label>
          <label>
            Logradouro
            <input name="addressLine" defaultValue={editingCustomer?.address_line || ""} />
          </label>
          <label>
            Numero
            <input name="addressNumber" defaultValue={editingCustomer?.address_number || ""} />
          </label>
          <label>
            Complemento
            <input name="addressComplement" defaultValue={editingCustomer?.address_complement || ""} />
          </label>
          <label>
            Bairro
            <input name="district" defaultValue={editingCustomer?.district || ""} />
          </label>
          <label>
            Cidade
            <input name="city" defaultValue={editingCustomer?.city || ""} />
          </label>
          <label>
            UF
            <input name="state" maxLength="2" defaultValue={editingCustomer?.state || ""} />
          </label>
          <label>
            CEP
            <input name="zipCode" defaultValue={editingCustomer?.zip_code || ""} />
          </label>
          <label>
            Codigo IBGE
            <input name="cityCode" defaultValue={editingCustomer?.city_code || ""} />
          </label>
          <label>
            Codigo do pais
            <input name="countryCode" defaultValue={editingCustomer?.country_code || "1058"} />
          </label>
          <label>
            Nome do pais
            <input name="countryName" defaultValue={editingCustomer?.country_name || "Brasil"} />
          </label>
        </div>

        <div className="action-row">
          <FormSubmitButton
            idleText={editingCustomer ? "Salvar alteracoes" : "Salvar cliente"}
            pendingText={editingCustomer ? "Salvando..." : "Criando..."}
          />
          {editingCustomer ? <Link href="/clientes" className="button secondary">Cancelar</Link> : null}
          {editingCustomer ? (
            <form action={cloneCustomerToCompany}>
              <input type="hidden" name="id" value={editingCustomer.id} />
              <button type="submit" className="button secondary">Clonar para empresa</button>
            </form>
          ) : null}
        </div>
      </form>
    </section>
  );
}
