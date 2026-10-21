import type { DetectedSlot, ParsedTemplate } from "../types/template";
export function Inspector({
  template,
  slots,
}: {
  template: ParsedTemplate;
  slots: DetectedSlot[];
}) {
  const { info } = template;
  const editable = slots.filter((s) =>
    ["text", "color", "image"].includes(s.type),
  );
  const status = editable.length
    ? "green"
    : template.potentialFallback
      ? "orange"
      : "red";
  return (
    <section className="inspector" aria-label="Inspection du template">
      <div className="panel-heading">
        <h2>Inspecteur du template</h2>
        <span className={`compatibility ${status}`}>
          {status === "green"
            ? "Slots natifs disponibles"
            : status === "orange"
              ? "Préparation possible"
              : "Aucun champ éditable"}
        </span>
      </div>
      <dl className="metadata">
        <div>
          <dt>Format</dt>
          <dd>.{template.format}</dd>
        </div>
        <div>
          <dt>Dimensions</dt>
          <dd>
            {info.width} × {info.height}
          </dd>
        </div>
        <div>
          <dt>Ratio</dt>
          <dd>{(info.width / info.height).toFixed(3)}:1</dd>
        </div>
        <div>
          <dt>Durée</dt>
          <dd>{info.duration.toFixed(3)} s</dd>
        </div>
        <div>
          <dt>Cadence</dt>
          <dd>{info.fps} images/s</dd>
        </div>
        <div>
          <dt>Images</dt>
          <dd>{info.frames}</dd>
        </div>
      </dl>
      {template.animationCount > 1 && (
        <p className="field-help">
          {template.animationCount} animations dans l’archive. Cette V1 ouvre la
          première : {template.animationId}.
        </p>
      )}
      {slots.length ? (
        <table>
          <thead>
            <tr>
              <th>Identifiant du slot</th>
              <th>Type</th>
              <th>Test</th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot.id}>
                <td>
                  <code>{slot.id}</code>
                </td>
                <td>{slot.type}</td>
                <td>
                  {["text", "color", "image"].includes(slot.type)
                    ? "Dans Personnaliser →"
                    : "Lecture seule en V1"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="field-help">
          {status === "orange"
            ? "Ce JSON possède des calques texte ou image. Un ciblage explicite pourra être ajouté plus tard ; aucun fallback automatique n’est activé."
            : "Ce template doit être préparé avec des slots natifs pour devenir modifiable."}
        </p>
      )}
    </section>
  );
}
