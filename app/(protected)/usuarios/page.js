import { createUserAction, deleteUserAction, updateUserAction } from "@/app/actions";
import { FormSubmitButton } from "@/components/FormSubmitButton";
import { requireAdmin } from "@/lib/auth";
import { ensureSchema, query } from "@/lib/db";

export const dynamic = "force-dynamic";

async function getUsers() {
  await ensureSchema();
  const result = await query(`
    SELECT id, user_code, full_name, is_admin, created_at
    FROM users
    ORDER BY id
  `);

  return result.rows;
}

export default async function UsersPage({ searchParams }) {
  await requireAdmin();
  const users = await getUsers();
  const params = await searchParams;
  const errorMessage = params?.error ? decodeURIComponent(String(params.error)) : null;
  const successMessage = params?.success ? decodeURIComponent(String(params.success)) : null;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Administracao</p>
          <h2>Usuarios</h2>
          <p className="section-copy">
            Somente o admin pode criar novos usuarios. O usuario 0 e reservado para administracao principal.
          </p>
        </div>
      </header>

      {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
      {successMessage ? <p className="form-success">{successMessage}</p> : null}

      <section className="two-columns">
        <form action={createUserAction} className="panel form-panel">
          <h3>Cadastrar usuario</h3>
          <div className="form-grid">
            <label>
              Usuario
              <input name="userCode" placeholder="Ex.: 1" required />
            </label>
            <label>
              Nome completo
              <input name="fullName" placeholder="Nome do usuario" required />
            </label>
            <label>
              Senha
              <input name="password" type="password" placeholder="Senha" required />
            </label>
            <label className="checkbox-row">
              <input name="isAdmin" type="checkbox" />
              <span>Tornar administrador</span>
            </label>
          </div>
          <div className="action-row">
            <FormSubmitButton idleText="Criar usuario" pendingText="Criando..." />
          </div>
        </form>

        <section className="panel list-panel">
          <h3>Editar funcionarios</h3>
          <p className="section-copy">
            Voce pode atualizar nome, perfil e senha dos funcionarios. O usuario 0 permanece reservado e com a senha fixa definida por voce.
          </p>

          <div className="user-grid">
            {users.map((user) => {
              const isReservedUser = user.id === 0;

              return (
                <article key={user.id} className="panel user-editor-card">
                  <form action={updateUserAction} className="user-edit-form">
                    <input type="hidden" name="id" value={user.id} />
                    <div className="user-editor-head">
                      <div>
                        <strong>{user.full_name}</strong>
                        <div className="stacked-meta">
                          <span>Usuario {user.user_code}</span>
                          <span>ID {user.id}</span>
                        </div>
                      </div>
                      <span className="status-pill subtle">{user.is_admin ? "Admin" : "Operador"}</span>
                    </div>

                    <div className="form-grid">
                      <label>
                        Nome completo
                        <input name="fullName" defaultValue={user.full_name} required />
                      </label>
                      <label>
                        Nova senha
                        <input
                          name="password"
                          type="password"
                          placeholder={isReservedUser ? "Senha reservada do usuario 0" : "Deixe em branco para manter"}
                          disabled={isReservedUser}
                        />
                      </label>
                      <label className="checkbox-row">
                        <input name="isAdmin" type="checkbox" defaultChecked={user.is_admin} disabled={isReservedUser} />
                        <span>{isReservedUser ? "Administrador principal fixo" : "Tornar administrador"}</span>
                      </label>
                    </div>

                    {isReservedUser ? (
                      <p className="section-copy">
                        O usuario 0 fica protegido: a senha nao pode ser alterada nem o cadastro ser excluido.
                      </p>
                    ) : null}

                    <div className="action-row">
                      <FormSubmitButton idleText="Editar" pendingText="Salvando..." />
                    </div>
                  </form>

                  <form action={deleteUserAction}>
                    <input type="hidden" name="id" value={user.id} />
                    <FormSubmitButton
                      idleText="Excluir"
                      pendingText="Excluindo..."
                      className="button danger"
                      disabled={isReservedUser}
                    />
                  </form>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </section>
  );
}
