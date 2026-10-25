export function Placeholder({ title, phase, description }: { title: string; phase: string; description: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="card mt-4">
        <p>{description}</p>
        <p className="muted mt-2">Planned for {phase} — see docs/PLAN.md.</p>
      </div>
    </section>
  );
}
