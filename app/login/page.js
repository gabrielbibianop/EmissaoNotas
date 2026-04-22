import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

function getErrorMessage(error) {
  if (error === "missing") {
    return "Preencha usuario e senha para entrar.";
  }

  if (error === "invalid") {
    return "Usuario ou senha invalidos.";
  }

  if (error === "locked") {
    return "Acesso temporariamente bloqueado para este IP apos 5 tentativas. Tente novamente mais tarde.";
  }

  return null;
}

export default async function LoginPage({ searchParams }) {
  const session = await getSession();

  if (session) {
    redirect("/");
  }

  const params = await searchParams;
  const errorMessage = getErrorMessage(params?.error);

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">Acesso administrativo</p>
        <h1>Entrar no Portal Fiscal</h1>
        <p className="section-copy">
          Entre com o usuario cadastrado.
        </p>

        {errorMessage ? <p className="form-error">{errorMessage}</p> : null}

        <form action="/api/login" method="post" className="login-form">
          <label>
            Usuario
            <input
              name="userCode"
              placeholder="Seu codigo de usuario"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Senha
            <input
              name="password"
              type="password"
              placeholder="Sua senha"
              autoComplete="current-password"
              required
            />
          </label>

          <button className="button primary" type="submit">Entrar</button>
        </form>

        <p className="section-copy">
          Depois do login, voce pode cadastrar empresas, clientes, produtos e registrar notas em uma unica rotina.
        </p>
      </section>
    </main>
  );
}
