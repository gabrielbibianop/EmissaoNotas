"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { LogoutButton } from "@/components/LogoutButton";

function buildMenu(isAdmin) {
  const groups = [
    {
      key: "cadastros",
      label: "Cadastros",
      items: [
        { href: "/", label: "Dashboard" },
        { href: "/clientes", label: "Clientes" },
        { href: "/clientes/busca", label: "Busca clientes" },
        { href: "/empresas", label: "Empresas" },
        { href: "/empresas/busca", label: "Busca empresas" }
      ]
    },
    {
      key: "venda",
      label: "Venda",
      items: [
        { href: "/vendas", label: "Vendas" },
        { href: "/vendas/busca", label: "Busca vendas" }
      ]
    },
    {
      key: "estoque",
      label: "Estoque",
      items: [
        { href: "/produtos", label: "Produtos" },
        { href: "/produtos/busca", label: "Busca produtos" },
        { href: "/estoque", label: "Movimentos" }
      ]
    },
    {
      key: "fiscal",
      label: "Fiscal",
      items: [
        { href: "/notas/enviar", label: "Emitir nota" },
        { href: "/notas", label: "Notas emitidas" }
      ]
    },
    {
      key: "relatorios",
      label: "Relatorios",
      items: [
        { href: "/relatorios", label: "Central de relatorios" }
      ]
    }
  ];

  if (isAdmin) {
    groups[0].items.push({ href: "/usuarios", label: "Usuarios" });
    groups[0].items.push({ href: "/banco", label: "Editor banco" });
  }

  return groups;
}

export function Sidebar({ logoutAction, session }) {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);
  const groups = useMemo(() => buildMenu(Boolean(session?.isAdmin)), [session?.isAdmin]);

  function isGroupActive(group) {
    return group.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  }

  return (
    <header className="topbar-shell">
      <div className="topbar">
        <div className="topbar-brand">
          <p className="eyebrow">Portal Fiscal</p>
          <h1>Envio de Notas</h1>
          <p className="topbar-copy">
            Cadastro, venda, estoque e fiscal no mesmo painel.
          </p>
        </div>

        <button
          type="button"
          className="topbar-menu-button"
          aria-expanded={isMenuOpen}
          aria-label="Abrir menu"
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          Menu
        </button>

        <nav className={isMenuOpen ? "topnav topnav-open" : "topnav"}>
          {groups.map((group) => {
            const active = isGroupActive(group);
            const groupOpen = openGroup === group.key;

            return (
              <div key={group.key} className={active ? "topnav-group active" : "topnav-group"}>
                <button
                  type="button"
                  className="topnav-group-title"
                  aria-expanded={groupOpen}
                  onClick={() => setOpenGroup((current) => (current === group.key ? null : group.key))}
                >
                  <span>{group.label}</span>
                  <span className={groupOpen ? "topnav-caret open" : "topnav-caret"}>▾</span>
                </button>

                <div className={groupOpen ? "topnav-group-links open" : "topnav-group-links"}>
                  {group.items.map((item) => {
                    const itemActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={itemActive ? "topnav-link active" : "topnav-link"}
                        onClick={() => {
                          setIsMenuOpen(false);
                          setOpenGroup(null);
                        }}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="topbar-user">
          <div className="user-badge">
            <strong>{session?.fullName || "Usuario"}</strong>
            <span>{session?.isAdmin ? "Administrador" : "Operador"}</span>
          </div>
          <LogoutButton action={logoutAction} />
        </div>
      </div>
    </header>
  );
}
