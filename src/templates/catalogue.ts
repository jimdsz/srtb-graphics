import type { TemplateDefinition } from "../types/template";

export const BRAND_COLORS = ["#007300", "#f0b900", "#eb1905"];
export const templates: TemplateDefinition[] = [
  {
    id: "btv-popup",
    name: "Pop-up BTV",
    category: "Rendez-vous",
    src: "/templates/btv-popup.json",
    posterFrame: 95,
    thumbnail: "/thumbnails/btv-popup.png",
    description: "Votre animation BTV, préparée avec des slots natifs.",
    fields: [
      {
        id: "announcement",
        label: "Annonce",
        type: "text",
        slot: "announcement",
        maxLength: 22,
      },
      {
        id: "program-title",
        label: "Titre du programme",
        type: "text",
        slot: "program-title",
        maxLength: 48,
        multiline: true,
      },
      {
        id: "subtitle",
        label: "Complément",
        type: "text",
        slot: "subtitle",
        maxLength: 35,
      },
      {
        id: "program-image",
        label: "Image du programme",
        type: "image",
        slot: "program-image",
        imageWidth: 392,
        imageHeight: 220,
      },
      {
        id: "panel-color",
        label: "Panneau",
        type: "color",
        slot: "panel-color",
        palette: BRAND_COLORS,
      },
      {
        id: "shutter-green",
        label: "Premier volet",
        type: "color",
        slot: "shutter-green",
        palette: BRAND_COLORS,
      },
      {
        id: "shutter-red",
        label: "Second volet",
        type: "color",
        slot: "shutter-red",
        palette: BRAND_COLORS,
      },
    ],
  },
];
