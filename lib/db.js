import { Pool } from "pg";
import { encryptSecretBuffer, encryptSecretText, hashUserPassword, isEncryptedValue } from "@/lib/security";

let pool;
let schemaPromise;

async function encryptLegacyCompanySecrets() {
  const result = await query(`
    SELECT id, certificate_data, certificate_password, smtp_password
    FROM companies
    WHERE certificate_data IS NOT NULL
       OR certificate_password IS NOT NULL
       OR smtp_password IS NOT NULL
  `);

  for (const company of result.rows) {
    const nextCertificateData =
      company.certificate_data && !isEncryptedValue(company.certificate_data)
        ? encryptSecretBuffer(company.certificate_data)
        : company.certificate_data;
    const nextCertificatePassword =
      company.certificate_password && !isEncryptedValue(company.certificate_password)
        ? encryptSecretText(company.certificate_password)
        : company.certificate_password;
    const nextSmtpPassword =
      company.smtp_password && !isEncryptedValue(company.smtp_password)
        ? encryptSecretText(company.smtp_password)
        : company.smtp_password;

    if (
      nextCertificateData !== company.certificate_data ||
      nextCertificatePassword !== company.certificate_password ||
      nextSmtpPassword !== company.smtp_password
    ) {
      await query(
        `UPDATE companies
         SET certificate_data = $1,
             certificate_password = $2,
             smtp_password = $3
         WHERE id = $4`,
        [nextCertificateData, nextCertificatePassword, nextSmtpPassword, company.id]
      );
    }
  }
}

function getPool() {
  const connectionString = String(process.env.DATABASE_URL || "").trim();

  if (!connectionString) {
    throw new Error("Defina a variavel DATABASE_URL para conectar ao PostgreSQL.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString
    });
  }

  return pool;
}

export function getDb() {
  return getPool();
}

export async function query(text, params = []) {
  const db = getPool();
  return db.query(text, params);
}

export async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY,
          user_code VARCHAR(40) NOT NULL UNIQUE,
          full_name VARCHAR(180) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          is_admin BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const adminResult = await query("SELECT 1 FROM users WHERE id = 0");

      if (adminResult.rows.length === 0) {
        await query(
          `INSERT INTO users (id, user_code, full_name, password_hash, is_admin)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            0,
            "0",
            "Administrador",
            hashUserPassword(process.env.ADMIN_PASSWORD || "opense"),
            true
          ]
        );
      }

      await query(`
        CREATE TABLE IF NOT EXISTS login_attempts (
          ip_address VARCHAR(120) PRIMARY KEY,
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          last_failed_at TIMESTAMP,
          locked_until TIMESTAMP
        );
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS companies (
          id SERIAL PRIMARY KEY,
          legal_name VARCHAR(180) NOT NULL,
          trade_name VARCHAR(180),
          cnpj VARCHAR(18) NOT NULL UNIQUE,
          email VARCHAR(180),
          phone VARCHAR(30),
          state_registration VARCHAR(40),
          address TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await query(`
        ALTER TABLE companies
        ADD COLUMN IF NOT EXISTS certificate_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS certificate_type VARCHAR(120),
        ADD COLUMN IF NOT EXISTS certificate_data BYTEA,
        ADD COLUMN IF NOT EXISTS certificate_password VARCHAR(255),
        ADD COLUMN IF NOT EXISTS smtp_host VARCHAR(255),
        ADD COLUMN IF NOT EXISTS smtp_port INTEGER,
        ADD COLUMN IF NOT EXISTS smtp_user VARCHAR(255),
        ADD COLUMN IF NOT EXISTS smtp_password VARCHAR(255),
        ADD COLUMN IF NOT EXISTS smtp_from_name VARCHAR(180),
        ADD COLUMN IF NOT EXISTS smtp_from_email VARCHAR(180),
        ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS address_line VARCHAR(180),
        ADD COLUMN IF NOT EXISTS address_number VARCHAR(30),
        ADD COLUMN IF NOT EXISTS address_complement VARCHAR(120),
        ADD COLUMN IF NOT EXISTS district VARCHAR(120),
        ADD COLUMN IF NOT EXISTS city VARCHAR(120),
        ADD COLUMN IF NOT EXISTS state VARCHAR(2),
        ADD COLUMN IF NOT EXISTS zip_code VARCHAR(12),
        ADD COLUMN IF NOT EXISTS city_code VARCHAR(10),
        ADD COLUMN IF NOT EXISTS country_code VARCHAR(10) DEFAULT '1058',
        ADD COLUMN IF NOT EXISTS country_name VARCHAR(80) DEFAULT 'Brasil',
        ADD COLUMN IF NOT EXISTS tax_regime VARCHAR(4) DEFAULT '3',
        ADD COLUMN IF NOT EXISTS invoice_series VARCHAR(20) DEFAULT '1',
        ADD COLUMN IF NOT EXISTS invoice_next_number INTEGER DEFAULT 1;
      `);

      await query(`
        UPDATE companies
        SET invoice_series = COALESCE(invoice_series, '1'),
            invoice_next_number = COALESCE(invoice_next_number, 1)
        WHERE invoice_series IS NULL OR invoice_next_number IS NULL;
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS customers (
          id SERIAL PRIMARY KEY,
          full_name VARCHAR(180) NOT NULL,
          document VARCHAR(18) NOT NULL UNIQUE,
          email VARCHAR(180),
          phone VARCHAR(30),
          address TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await query(`
        ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS state_registration VARCHAR(40),
        ADD COLUMN IF NOT EXISTS address_line VARCHAR(180),
        ADD COLUMN IF NOT EXISTS address_number VARCHAR(30),
        ADD COLUMN IF NOT EXISTS address_complement VARCHAR(120),
        ADD COLUMN IF NOT EXISTS district VARCHAR(120),
        ADD COLUMN IF NOT EXISTS city VARCHAR(120),
        ADD COLUMN IF NOT EXISTS state VARCHAR(2),
        ADD COLUMN IF NOT EXISTS zip_code VARCHAR(12),
        ADD COLUMN IF NOT EXISTS city_code VARCHAR(10),
        ADD COLUMN IF NOT EXISTS country_code VARCHAR(10) DEFAULT '1058',
        ADD COLUMN IF NOT EXISTS country_name VARCHAR(80) DEFAULT 'Brasil';
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS products (
          id SERIAL PRIMARY KEY,
          name VARCHAR(180) NOT NULL,
          sku VARCHAR(80) NOT NULL UNIQUE,
          ncm VARCHAR(20),
          price NUMERIC(12, 2) NOT NULL DEFAULT 0,
          stock INTEGER NOT NULL DEFAULT 0,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS stock_movements (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          movement_type VARCHAR(20) NOT NULL,
          quantity INTEGER NOT NULL,
          previous_stock INTEGER NOT NULL DEFAULT 0,
          resulting_stock INTEGER NOT NULL DEFAULT 0,
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS invoices (
          id SERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
          customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
          product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
          number VARCHAR(40) NOT NULL,
          series VARCHAR(20),
          access_key VARCHAR(60),
          issue_date DATE NOT NULL,
          total_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
          status VARCHAR(40) NOT NULL DEFAULT 'Recebida',
          notes TEXT,
          file_name VARCHAR(255),
          file_type VARCHAR(120),
          file_data BYTEA,
          xml_file_name VARCHAR(255),
          xml_file_type VARCHAR(120),
          xml_file_data BYTEA,
          generated_access_key VARCHAR(44),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS sales (
          id SERIAL PRIMARY KEY,
          company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
          customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
          sale_number VARCHAR(40) NOT NULL,
          sale_date DATE NOT NULL,
          status VARCHAR(40) NOT NULL DEFAULT 'aberta',
          total_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
          notes TEXT,
          sale_meta TEXT,
          invoiced_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS sale_items (
          id SERIAL PRIMARY KEY,
          sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
          product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
          product_code VARCHAR(80),
          description VARCHAR(255) NOT NULL,
          quantity NUMERIC(12, 4) NOT NULL DEFAULT 0,
          unit VARCHAR(20) DEFAULT 'UN',
          unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
          total_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await query(`
        CREATE TABLE IF NOT EXISTS maintenance_orders (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
          equipment VARCHAR(180) NOT NULL,
          serial_number VARCHAR(120),
          problem_description TEXT,
          service_description TEXT,
          status VARCHAR(40) NOT NULL DEFAULT 'aberta',
          total_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await query(`
        ALTER TABLE invoices
        ADD COLUMN IF NOT EXISTS xml_file_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS xml_file_type VARCHAR(120),
        ADD COLUMN IF NOT EXISTS xml_file_data BYTEA,
        ADD COLUMN IF NOT EXISTS generated_access_key VARCHAR(44),
        ADD COLUMN IF NOT EXISTS environment_mode VARCHAR(20) DEFAULT 'homologacao',
        ADD COLUMN IF NOT EXISTS invoice_meta TEXT,
        ADD COLUMN IF NOT EXISTS sefaz_status VARCHAR(60),
        ADD COLUMN IF NOT EXISTS protocol_number VARCHAR(60),
        ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(60),
        ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS cancel_protocol_number VARCHAR(60),
        ADD COLUMN IF NOT EXISTS sefaz_response TEXT,
        ADD COLUMN IF NOT EXISTS sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS signed_xml_data BYTEA,
        ADD COLUMN IF NOT EXISTS signed_xml_file_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS signed_xml_file_type VARCHAR(120);
      `);

      await query(`
        ALTER TABLE invoices
        ALTER COLUMN sefaz_status TYPE TEXT,
        ALTER COLUMN protocol_number TYPE TEXT,
        ALTER COLUMN receipt_number TYPE TEXT,
        ALTER COLUMN cancel_protocol_number TYPE TEXT;
      `);

      await encryptLegacyCompanySecrets();
    })();
  }

  return schemaPromise;
}
