export type FieldType = "text" | "color" | "image";
export interface TemplateField {
  id: string;
  label: string;
  type: FieldType;
  slot: string;
  maxLength?: number;
  multiline?: boolean;
  palette?: string[];
  imageWidth?: number;
  imageHeight?: number;
}
export interface TemplateDefinition {
  id: string;
  name: string;
  category: string;
  src: string;
  description: string;
  thumbnail?: string;
  posterFrame?: number;
  fields: TemplateField[];
}
export interface AnimationInfo {
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration: number;
}
export interface DetectedSlot {
  id: string;
  type: string;
  value: unknown;
}
export interface ParsedTemplate {
  format: "json" | "lottie";
  source: Record<string, unknown>;
  data: Record<string, unknown> | ArrayBuffer;
  info: AnimationInfo;
  animationId?: string;
  animationCount: number;
  potentialFallback: boolean;
}
