"use client";

import { useFormStatus } from "react-dom";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button ghost" type="submit" disabled={pending}>
      {pending ? "Saindo..." : "Sair"}
    </button>
  );
}

export function LogoutButton({ action }) {
  return (
    <form action={action}>
      <SubmitButton />
    </form>
  );
}
