"use client";

import { useEffect } from "react";
import { useFormStatus } from "react-dom";

export function FormSubmitButton({
  idleText,
  pendingText,
  className = "button primary",
  formAction,
  disabled = false
}) {
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
    <button className={className} type="submit" formAction={formAction} disabled={isDisabled}>
      {pending ? pendingText : idleText}
    </button>
  );
}
