import { query } from "@/lib/db";

const ALLOWED_TABLES = [
  "users",
  "login_attempts",
  "companies",
  "customers",
  "products",
  "stock_movements",
  "sales",
  "sale_items",
  "maintenance_orders",
  "invoices"
];

function quoteIdentifier(value) {
  return `"${String(value || "").replace(/"/g, "\"\"")}"`;
}

export async function getEditableTables() {
  const result = await query(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name = ANY($1::text[])
    ORDER BY table_name
  `,
    [ALLOWED_TABLES]
  );

  return result.rows.map((row) => row.table_name);
}

export async function getTableSchema(tableName) {
  if (!ALLOWED_TABLES.includes(tableName)) {
    throw new Error("Tabela nao permitida no editor.");
  }

  const [columnsResult, primaryKeyResult] = await Promise.all([
    query(
      `
      SELECT
        column_name,
        data_type,
        udt_name,
        is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND data_type <> 'bytea'
      ORDER BY ordinal_position
    `,
      [tableName]
    ),
    query(
      `
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_attribute a
        ON a.attrelid = i.indrelid
       AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass
        AND i.indisprimary = true
      LIMIT 1
    `,
      [`public.${tableName}`]
    )
  ]);

  const primaryKey = primaryKeyResult.rows[0]?.column_name || "id";
  const columns = columnsResult.rows.map((column) => ({
    name: column.column_name,
    dataType: column.data_type,
    udtName: column.udt_name,
    nullable: column.is_nullable === "YES",
    editable: column.column_name !== primaryKey
  }));

  return {
    tableName,
    primaryKey,
    columns
  };
}

export async function getTableRows(tableName, limit = 50) {
  const schema = await getTableSchema(tableName);
  const selectColumns = schema.columns.map((column) => quoteIdentifier(column.name)).join(", ");
  const rowsResult = await query(
    `
    SELECT ${selectColumns}
    FROM ${quoteIdentifier(tableName)}
    ORDER BY ${quoteIdentifier(schema.primaryKey)} DESC NULLS LAST
    LIMIT $1
  `,
    [limit]
  );

  return {
    ...schema,
    rows: rowsResult.rows
  };
}

export function normalizeEditorValue(column, rawValue) {
  const value = String(rawValue ?? "").trim();

  if (!value) {
    if (column.nullable) {
      return null;
    }

    throw new Error(`O campo "${column.name}" nao pode ficar vazio.`);
  }

  switch (column.dataType) {
    case "boolean":
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
      throw new Error(`Valor invalido para o campo "${column.name}".`);
    case "integer":
    case "smallint":
    case "bigint": {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Valor invalido para o campo "${column.name}".`);
      }
      return parsed;
    }
    case "numeric":
    case "real":
    case "double precision": {
      const parsed = Number(value.replace(",", "."));
      if (!Number.isFinite(parsed)) {
        throw new Error(`Valor invalido para o campo "${column.name}".`);
      }
      return parsed;
    }
    default:
      return value;
  }
}
