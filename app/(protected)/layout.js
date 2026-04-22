import { Sidebar } from "@/components/Sidebar";
import { logoutAction } from "@/app/actions";
import { requireAuth } from "@/lib/auth";

export default async function ProtectedLayout({ children }) {
  const session = await requireAuth();

  return (
    <div className="shell">
      <Sidebar logoutAction={logoutAction} session={session} />
      <main className="content content-topbar">{children}</main>
    </div>
  );
}
