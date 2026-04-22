import { lockDatabaseEditor, unlockDatabaseEditor, updateDatabaseRow } from "@/app/actions";
import { hasDatabaseEditorAccess, requireAuth } from "@/lib/auth";
import { getEditableTables, getTableRows } from "@/lib/db-editor";

export const dynamic = "force-dynamic";

function getInputType(column) {
  if (column.dataType === "date") {
    return "date";
  }

  if (column.dataType.includes("timestamp")) {
    return "datetime-local";
  }

  if (["integer", "smallint", "bigint", "numeric", "real", "double precision"].includes(column.dataType)) {
    return "text";
  }

  return "text";
}

function formatFieldValue(column, value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (column.dataType === "date") {
    return new Date(value).toISOString().slice(0, 10);
  }

  if (column.dataType.includes("timestamp")) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

function TableEditor({ data }) {
  const editableColumns = data.columns.filter((column) => column.editable);

  return (
    <form className="panel list-panel table-panel-wide">
      <input type="hidden" name="tableName" value={data.tableName} />
      <div className="table-wrap table-wrap-wide">
        <table>
          <thead>
            <tr>
              {data.columns.map((column) => (
                <th key={column.name}>{column.name}</th>
              ))}
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={data.columns.length + 1}>Nenhum registro encontrado nesta tabela.</td>
              </tr>
            ) : (
              data.rows.map((row, index) => (
                <tr key={`${data.tableName}-${index}-${row[data.primaryKey]}`}>
                  {data.columns.map((column) => (
                    <td key={`${row[data.primaryKey]}-${column.name}`}>
                      {column.editable ? (
                        column.dataType === "boolean" ? (
                          <select
                            name={`row:${index}:${column.name}`}
                            defaultValue={formatFieldValue(column, row[column.name])}
                          >
                            <option value="">Vazio</option>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : column.dataType === "text" ? (
                          <textarea
                            name={`row:${index}:${column.name}`}
                            rows="3"
                            defaultValue={formatFieldValue(column, row[column.name])}
                          />
                        ) : (
                          <input
                            type={getInputType(column)}
                            name={`row:${index}:${column.name}`}
                            defaultValue={formatFieldValue(column, row[column.name])}
                          />
                        )
                      ) : (
                        <>
                          <strong>{String(row[column.name] ?? "-")}</strong>
                          <input type="hidden" name={`readonly:${index}:${column.name}`} value={String(row[column.name] ?? "")} />
                        </>
                      )}
                    </td>
                  ))}
                  <td>
                    <input type="hidden" name={`pk:${index}`} value={String(row[data.primaryKey] ?? "")} />
                    <button
                      type="submit"
                      className="button primary small"
                      name="rowIndex"
                      value={String(index)}
                      formAction={updateDatabaseRow}
                    >
                      Salvar linha
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </form>
  );
}

export default async function DatabaseEditorPage({ searchParams }) {
  await requireAuth();
  const unlocked = await hasDatabaseEditorAccess();
  const tables = await getEditableTables();
  const params = await searchParams;
  const selectedTable = tables.includes(String(params?.table || "")) ? String(params?.table) : tables[0];
  const successMessage = params?.success ? decodeURIComponent(String(params.success)) : null;
  const errorMessage = params?.error ? decodeURIComponent(String(params.error)) : null;
  const tableData = unlocked && selectedTable ? await getTableRows(selectedTable) : null;

  return (
    <section className="page page-wide">
      <header className="page-header">
        <div>
          <p className="eyebrow">Administrador</p>
          <h2>Editor do banco</h2>
          <p className="section-copy">
            Consulte tabelas, campos e altere registros em grade. Esta area so libera com a senha do usuario 0.
          </p>
        </div>
      </header>

      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

      {!unlocked ? (
        <form action={unlockDatabaseEditor} className="panel form-panel form-panel-wide">
          <h3>Liberar editor</h3>
          <div className="form-grid">
            <label className="full">
              Senha do usuario 0
              <input type="password" name="rootPassword" placeholder="Digite a senha do usuario 0" required />
            </label>
          </div>
          <div className="action-row">
            <button type="submit" className="button primary">Liberar acesso</button>
          </div>
        </form>
      ) : (
        <>
          <section className="panel">
            <div className="action-row">
              <form method="get" className="action-row">
                <label>
                  Tabela
                  <select name="table" defaultValue={selectedTable}>
                    {tables.map((table) => (
                      <option key={table} value={table}>
                        {table}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="button secondary">Abrir tabela</button>
              </form>

              <form action={lockDatabaseEditor}>
                <button type="submit" className="button danger">Bloquear editor</button>
              </form>
            </div>
          </section>

          {tableData ? <TableEditor data={tableData} /> : null}
        </>
      )}
    </section>
  );
}
