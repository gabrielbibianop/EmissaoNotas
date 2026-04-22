"use client";

import { useEffect } from "react";
import { useFormStatus } from "react-dom";

export function DeleteButton({ disabled = false }) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;

  useEffect(() => {
    if (pending) {
      document.documentElement.classList.add("app-loading");
      return () => {
        document.documentElement.classList.remove("app-loading");
      };
    }

    document.documentElement.classList.remove("app-loading");
  }, [pending]);

  return (
    <button className="button danger small" type="submit" disabled={isDisabled}>
      {pending ? "Excluindo..." : disabled ? "Bloqueado" : "Excluir"}
    </button>
  );
}
