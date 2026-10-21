interface ModelContext {
  registerTool(
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
}
export function registerInspectionTool(read: () => unknown) {
  const context = (document as Document & { modelContext?: ModelContext })
    .modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  try {
    void Promise.resolve(
      context.registerTool(
        {
          name: "inspect_current_template",
          title: "Inspecter le template ouvert",
          description:
            "Lire les dimensions, la cadence et les identifiants des slots affichés dans l’inspecteur SRTB Graphics. Ne lit pas les photos ni les textes saisis et ne modifie rien.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute(input) {
            if (
              !input ||
              typeof input !== "object" ||
              Array.isArray(input) ||
              Object.keys(input).length
            )
              throw new Error("Cet outil ne prend aucun paramètre.");
            return read();
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {
      /* Optional browser feature; no effect on the UI. */
    });
  } catch {
    /* Unsupported implementations must not break editing or export. */
  }
  return () => lifecycle.abort();
}
