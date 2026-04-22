"use client";

export function FullscreenLoader({ label = "Carregando..." }) {
  return (
    <div className="global-loading-overlay" role="status" aria-live="polite" aria-label={label}>
      <div className="global-loading-card">
        <span className="global-loading-spinner" aria-hidden="true" />
        <strong>{label}</strong>
      </div>
    </div>
  );
}
