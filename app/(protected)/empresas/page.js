import Link from "next/link";
import { cloneCompanyToCustomer, createCompany, saveCompanyEmailConfig, updateCompany } from "@/app/actions";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { ensureSchema, query } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getCompanies() {
  await ensureSchema();
  const result = await query(`
    SELECT
      id,
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
      smtp_host,
      smtp_port,
      smtp_user,
      smtp_from_name,
      smtp_from_email,
      smtp_secure,
      invoice_series,
      invoice_next_number,
      (certificate_password IS NOT NULL) AS has_certificate_password,
      (smtp_password IS NOT NULL) AS has_smtp_password,
      EXISTS (
        SELECT 1
        FROM invoices
        WHERE invoices.company_id = companies.id
          AND (
            invoices.sent_at IS NOT NULL OR
            invoices.protocol_number IS NOT NULL OR
            invoices.receipt_number IS NOT NULL OR
            invoices.cancelled_at IS NOT NULL OR
            invoices.status IN ('Autorizada', 'Transmitida', 'Cancelada')
          )
      ) AS has_transmitted_invoice
    FROM companies
    ORDER BY created_at DESC
  `);

  return result.rows;
}

export default async function CompaniesPage({ searchParams }) {
  const companies = await getCompanies();
  const params = await searchParams;
  const editingId = Number(params?.edit || 0);
  const smtpId = Number(params?.smtp || 0);
  const successMessage = params?.success ? decodeURIComponent(String(params.success)) : null;
  const errorMessage = params?.error ? decodeURIComponent(String(params.error)) : null;
  const editingCompany = companies.find((company) => company.id === editingId);
  const smtpCompany = companies.find((company) => company.id === smtpId);
  const formAction = editingCompany ? updateCompany : createCompany;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Cadastro Fiscal</p>
          <h2>Empresas emissoras</h2>
          <p className="section-copy">
            Configure o emitente no padrao da NF-e: certificado A1, endereco fiscal, regime tributario e numeracao sequencial.
          </p>
        </div>
        <div className="hero-actions">
          <Link href="/empresas/busca" className="button secondary">Buscar empresas</Link>
        </div>
      </header>

      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      <form action={formAction} className="panel form-panel form-panel-wide">
        <h3>{editingCompany ? "Editar empresa" : "Nova empresa"}</h3>
        {editingCompany ? <input type="hidden" name="id" value={editingCompany.id} /> : null}

        <div className="form-grid">
          <label>
            Razao social
            <input name="legalName" defaultValue={editingCompany?.legal_name || ""} required />
          </label>
          <label>
            Nome fantasia
            <input name="tradeName" defaultValue={editingCompany?.trade_name || ""} />
          </label>
          <label>
            CNPJ
            <input name="cnpj" defaultValue={editingCompany?.cnpj || ""} required />
          </label>
          <label>
            Inscricao estadual
            <input name="stateRegistration" defaultValue={editingCompany?.state_registration || ""} />
          </label>
          <label>
            Regime tributario
            <select name="taxRegime" defaultValue={editingCompany?.tax_regime || "3"}>
              <option value="1">1 - Simples Nacional</option>
              <option value="2">2 - Simples excesso sublimite</option>
              <option value="3">3 - Regime normal</option>
              <option value="4">4 - MEI</option>
            </select>
          </label>
          <label>
            E-mail
            <input name="email" type="email" defaultValue={editingCompany?.email || ""} />
          </label>
          <label>
            Telefone
            <input name="phone" defaultValue={editingCompany?.phone || ""} />
          </label>
          <label className="full">
            Endereco livre
            <textarea name="address" rows="3" defaultValue={editingCompany?.address || ""} />
          </label>
          <label>
            Logradouro
            <input name="addressLine" defaultValue={editingCompany?.address_line || ""} />
          </label>
          <label>
            Numero
            <input name="addressNumber" defaultValue={editingCompany?.address_number || ""} />
          </label>
          <label>
            Complemento
            <input name="addressComplement" defaultValue={editingCompany?.address_complement || ""} />
          </label>
          <label>
            Bairro
            <input name="district" defaultValue={editingCompany?.district || ""} />
          </label>
          <label>
            Cidade
            <input name="city" defaultValue={editingCompany?.city || ""} />
          </label>
          <label>
            UF
            <input name="state" maxLength="2" defaultValue={editingCompany?.state || ""} />
          </label>
          <label>
            CEP
            <input name="zipCode" defaultValue={editingCompany?.zip_code || ""} />
          </label>
          <label>
            Codigo IBGE
            <input name="cityCode" defaultValue={editingCompany?.city_code || ""} />
          </label>
          <label>
            Codigo do pais
            <input name="countryCode" defaultValue={editingCompany?.country_code || "1058"} />
          </label>
          <label>
            Nome do pais
            <input name="countryName" defaultValue={editingCompany?.country_name || "Brasil"} />
          </label>
          <label>
            Serie padrao
            <input name="invoiceSeries" defaultValue={editingCompany?.invoice_series || "1"} />
          </label>
          <label>
            Proximo numero da nota
            <input name="invoiceNextNumber" type="number" min="1" defaultValue={editingCompany?.invoice_next_number || 1} />
          </label>
          <label className="full">
            Certificado digital da empresa
            <input name="certificateFile" type="file" accept=".pfx,.p12,application/x-pkcs12" />
          </label>
          <label className="full">
            Senha do certificado
            <input
              name="certificatePassword"
              type="password"
              placeholder={editingCompany?.has_certificate_password ? "Digite apenas para trocar a senha atual" : "Digite a senha do certificado"}
              autoComplete="new-password"
            />
            <small>{editingCompany?.has_certificate_password ? "A senha atual permanece protegida se este campo ficar em branco." : "A senha nao sera exibida novamente depois de salva."}</small>
          </label>
        </div>

        <div className="action-row">
          <FormSubmitButton
            idleText={editingCompany ? "Salvar alteracoes" : "Salvar empresa"}
            pendingText={editingCompany ? "Salvando..." : "Criando..."}
          />
          {editingCompany ? <Link href="/empresas" className="button secondary">Cancelar</Link> : null}
          {editingCompany ? (
            <form action={cloneCompanyToCustomer}>
              <input type="hidden" name="id" value={editingCompany.id} />
              <button type="submit" className="button secondary">Clonar para cliente</button>
            </form>
          ) : null}
        </div>
      </form>

      {smtpCompany ? (
        <div className="modal-backdrop">
          <section className="panel modal-panel compact-panel">
            <div className="modal-head">
              <div>
                <p className="eyebrow">SMTP</p>
                <h3>Configuracao de e-mail</h3>
                <p className="section-copy">
                  Defina os dados de envio da empresa <strong>{smtpCompany.trade_name || smtpCompany.legal_name}</strong>.
                </p>
              </div>
              <Link href="/empresas" className="button secondary small">Fechar</Link>
            </div>

            <form action={saveCompanyEmailConfig} className="form-grid">
              <input type="hidden" name="companyId" value={smtpCompany.id} />

              <label>
                Servidor SMTP
                <input name="smtpHost" defaultValue={smtpCompany.smtp_host || ""} required />
              </label>
              <label>
                Porta
                <input name="smtpPort" type="number" min="1" defaultValue={smtpCompany.smtp_port || 587} required />
              </label>
              <label>
                Usuario SMTP
                <input name="smtpUser" defaultValue={smtpCompany.smtp_user || ""} required />
              </label>
              <label>
                Senha SMTP
                <input
                  name="smtpPassword"
                  type="password"
                  placeholder={smtpCompany.has_smtp_password ? "Digite apenas para trocar a senha SMTP" : "Digite a senha SMTP"}
                  autoComplete="new-password"
                />
                <small>{smtpCompany.has_smtp_password ? "A senha atual continua salva e criptografada se voce deixar este campo em branco." : "A senha sera armazenada de forma criptografada."}</small>
              </label>
              <label>
                Nome do remetente
                <input name="smtpFromName" defaultValue={smtpCompany.smtp_from_name || smtpCompany.trade_name || smtpCompany.legal_name || ""} />
              </label>
              <label>
                E-mail remetente
                <input name="smtpFromEmail" type="email" defaultValue={smtpCompany.smtp_from_email || smtpCompany.email || ""} required />
              </label>
              <label className="checkbox-field full">
                <input name="smtpSecure" type="checkbox" defaultChecked={Boolean(smtpCompany.smtp_secure)} />
                <span>Usar conexao segura SSL/TLS</span>
              </label>

              <div className="action-row full">
                <FormSubmitButton idleText="Salvar configuracao" pendingText="Salvando..." />
                <Link href="/empresas" className="button secondary">Cancelar</Link>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
