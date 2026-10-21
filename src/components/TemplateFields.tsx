import { RotateCcw, ImagePlus } from "lucide-react";
import type { DetectedSlot, TemplateField } from "../types/template";

interface Props {
  fields: TemplateField[];
  slots: DetectedSlot[];
  values: Record<string, string>;
  disabled: boolean;
  onText: (id: string, text: string) => void;
  onColor: (id: string, color: string) => void;
  onImage: (field: TemplateField, file: File) => void;
  onReset: (id: string) => void;
}
export function TemplateFields({
  fields,
  slots,
  values,
  disabled,
  onText,
  onColor,
  onImage,
  onReset,
}: Props) {
  return (
    <fieldset disabled={disabled}>
      {fields.map((field) => {
        const slot = slots.find((s) => s.id === field.slot);
        const valid = slot?.type === field.type;
        return (
          <div className="field" key={field.id}>
            <div className="field-heading">
              <label htmlFor={`field-${field.id}`}>{field.label}</label>
              <button
                type="button"
                disabled={!valid}
                aria-label={`Restaurer ${field.label}`}
                title={`Restaurer ${field.label}`}
                onClick={() => onReset(field.slot)}
              >
                <RotateCcw size={14} />
              </button>
            </div>
            {!valid ? (
              <p className="field-warning">
                Slot absent ou incompatible : {field.slot}.
              </p>
            ) : field.type === "text" ? (
              <textarea
                id={`field-${field.id}`}
                rows={field.multiline ? 3 : 1}
                maxLength={field.maxLength ?? 500}
                value={values[field.slot] ?? ""}
                onChange={(e) => onText(field.slot, e.target.value)}
              />
            ) : field.type === "color" ? (
              field.palette?.length ? (
                <div className="swatches">
                  {field.palette.map((color) => (
                    <button
                      type="button"
                      key={color}
                      style={{ background: color }}
                      className={values[field.slot] === color ? "active" : ""}
                      aria-label={`${field.label} ${color}`}
                      aria-pressed={values[field.slot] === color}
                      onClick={() => onColor(field.slot, color)}
                    />
                  ))}
                </div>
              ) : (
                <div className="color-input">
                  <input
                    type="color"
                    id={`field-${field.id}`}
                    value={values[field.slot] ?? "#007300"}
                    onChange={(e) => onColor(field.slot, e.target.value)}
                  />
                  <code>{values[field.slot]}</code>
                </div>
              )
            ) : (
              <div className="image-input">
                <label className={`file-button ${disabled ? "disabled" : ""}`}>
                  <ImagePlus size={17} /> Choisir une image
                  <input
                    id={`field-${field.id}`}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) onImage(field, file);
                    }}
                  />
                </label>
                <p className="field-help">
                  {values[field.slot] || "Image originale"}
                  <br />
                  PNG, JPEG, WebP · recadrage centré, sans déformation.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
