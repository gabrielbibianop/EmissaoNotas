import "./globals.css";

export const metadata = {
  title: "Emissao Nota Fiscal",
  description: "Sistema de emissao e gestao de notas fiscais com Node.js e PostgreSQL."
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
