import { useEffect, useRef, useState } from "react";
import {
  Download,
  Layers3,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  ScanSearch,
  Upload,
  ChevronDown,
} from "lucide-react";
import type { DotLottie } from "@lottiefiles/dotlottie-web";
import { templates } from "./templates/catalogue";
import { colorValue, createPlayer, slotsOf, textValue } from "./lib/player";
import type { VideoFormat } from "./lib/export-video";
import {
  assertFontsAvailable,
  loadOfficial,
  MAX_TEMPLATE_BYTES,
  parseTemplate,
} from "./lib/template-loader";
import { imageSlotSource, prepareLocalImage } from "./lib/local-image";
import { registerInspectionTool } from "./lib/webmcp";
import { TemplateFields } from "./components/TemplateFields";
import { Inspector } from "./components/Inspector";
import type {
  AnimationInfo,
  DetectedSlot,
  ParsedTemplate,
  TemplateField,
} from "./types/template";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const valueOf = (slot: DetectedSlot) =>
  slot.type === "text"
    ? textValue(slot.value).replaceAll("\r", "\n")
    : slot.type === "color"
      ? colorValue(slot.value)
      : "";

export default function App() {
  const [selected, setSelected] = useState(templates[0]);
  const [local, setLocal] = useState<{
    parsed: ParsedTemplate;
    name: string;
  }>();
  const [parsed, setParsed] = useState<ParsedTemplate>();
  const [info, setInfo] = useState<AnimationInfo>();
  const [slots, setSlots] = useState<DetectedSlot[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [exported, setExported] = useState("");
  const [details, setDetails] = useState(false);
  const [fpsMode, setFpsMode] = useState("25");
  const [capabilities, setCapabilities] = useState<{
    mp4: boolean;
    webm: boolean;
  }>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const player = useRef<DotLottie | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const imageAbort = useRef<AbortController | null>(null);
  const downloadUrls = useRef(new Set<string>());
  const busy = progress !== null || preparing;
  const fps = fpsMode === "source" ? (info?.fps ?? 25) : 25;
  const title = local?.name ?? selected.name;
  const inspection = useRef<unknown>({ ready: false });
  useEffect(() => {
    inspection.current = {
      ready: !!info,
      format: parsed?.format,
      info: parsed?.info,
      slots: slots.map(({ id, type }) => ({ id, type })),
    };
  }, [info, parsed, slots]);
  useEffect(() => registerInspectionTool(() => inspection.current), []);

  function present() {
    const target = canvas.current,
      source = player.current?.canvas as OffscreenCanvas | undefined;
    if (target && source) {
      const ctx = target.getContext("2d")!;
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(source, 0, 0);
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    let instance: DotLottie | undefined;
    setInfo(undefined);
    setParsed(undefined);
    setError("");
    setExported("");
    setSlots([]);
    setValues({});
    setFrame(0);
    setPlaying(false);
    canvas.current
      ?.getContext("2d")
      ?.clearRect(0, 0, canvas.current.width, canvas.current.height);
    (async () => {
      if (typeof OffscreenCanvas === "undefined")
        throw new Error(
          "Utilisez Chrome ou Edge récent : le canevas de rendu n’est pas disponible.",
        );
      const document =
        local?.parsed ?? (await loadOfficial(selected.src, abort.signal));
      abort.signal.throwIfAborted();
      setParsed(document);
      assertFontsAvailable(document.source);
      const { width, height } = document.info;
      canvas.current!.width = width;
      canvas.current!.height = height;
      instance = await createPlayer(
        new OffscreenCanvas(width, height),
        document.data,
        abort.signal,
        document.animationId,
      );
      if (abort.signal.aborted) {
        instance.destroy();
        return;
      }
      const size = instance.animationSize();
      if (size.width !== width || size.height !== height)
        throw new Error(
          "Le moteur ne restitue pas les dimensions déclarées du template.",
        );
      player.current = instance;
      const detected = slotsOf(instance);
      setInfo(document.info);
      setSlots(detected);
      setValues(
        Object.fromEntries(detected.map((slot) => [slot.id, valueOf(slot)])),
      );
      instance.addEventListener("frame", () => {
        if (!exportAbort.current && instance) setFrame(instance.currentFrame);
      });
      instance.addEventListener("render", present);
      instance.addEventListener("play", () => setPlaying(true));
      instance.addEventListener("pause", () => setPlaying(false));
      instance.addEventListener("complete", () => setPlaying(false));
      instance.addEventListener("stop", () => setPlaying(false));
      instance.addEventListener("renderError", () => {
        instance?.pause();
        setInfo(undefined);
        setPlaying(false);
        setError(
          "Erreur de rendu. Rechargez le modèle ou choisissez un template préparé.",
        );
        exportAbort.current?.abort();
      });
      instance.setFrame(
        Math.min(
          document.info.frames - 1,
          local
            ? Math.floor(document.info.frames * 0.35)
            : (selected.posterFrame ?? 0),
        ),
      );
      present();
    })().catch((e) => {
      if (!abort.signal.aborted) {
        instance?.destroy();
        player.current = null;
        setError(messageOf(e));
      }
    });
    return () => {
      abort.abort();
      imageAbort.current?.abort();
      instance?.destroy();
      player.current = null;
    };
  }, [selected, local]);

  useEffect(() => {
    let stale = false;
    setCapabilities(undefined);
    import("./lib/export-video")
      .then((module) => module.codecSupport(fps))
      .then((result) => {
        if (!stale) setCapabilities(result);
      })
      .catch(() => {
        if (!stale) setCapabilities({ mp4: false, webm: false });
      });
    return () => {
      stale = true;
    };
  }, [fps]);
  useEffect(
    () => () => {
      exportAbort.current?.abort();
      imageAbort.current?.abort();
      downloadUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  async function inspect(file: File) {
    setError("");
    setPreparing(true);
    try {
      if (file.size > MAX_TEMPLATE_BYTES)
        throw new Error("Template trop volumineux : 20 Mo maximum.");
      const document = parseTemplate(
        new Uint8Array(await file.arrayBuffer()),
        file.name,
      );
      setLocal({ parsed: document, name: file.name });
      setDetails(true);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setPreparing(false);
    }
  }
  function refreshValue(id: string) {
    const slot = slots.find((s) => s.id === id);
    if (slot)
      setValues((v) => ({
        ...v,
        [id]: valueOf({ ...slot, value: player.current?.getSlot(id) }),
      }));
    present();
  }
  function changeText(id: string, text: string) {
    try {
      const current = player.current?.getSlot(id) as
        { k?: { s?: object }[] } | undefined;
      // setTextSlot merges existing style but flattens document keyframes.
      // Refuse animated-style slots rather than silently discarding their animation.
      if ((current?.k?.length ?? 0) > 1)
        throw new Error(
          "Ce texte change de style au cours de l’animation. Préparez un slot de texte à style constant avant modification.",
        );
      if (!player.current?.setTextSlot(id, { t: text.replaceAll("\n", "\r") }))
        throw new Error("Le moteur a refusé la modification de ce texte.");
      setValues((v) => ({ ...v, [id]: text }));
      present();
      setError("");
    } catch (e) {
      setError(messageOf(e));
    }
  }
  function changeColor(id: string, color: string) {
    try {
      if ((player.current?.getSlot(id) as { a?: number } | undefined)?.a === 1)
        throw new Error(
          "Cette couleur est animée. Préparez un slot de couleur constante pour préserver l’animation originale.",
        );
      const rgb = [1, 3, 5].map(
        (i) => parseInt(color.slice(i, i + 2), 16) / 255,
      );
      if (!player.current?.setColorSlot(id, [rgb[0], rgb[1], rgb[2], 1]))
        throw new Error("Le moteur a refusé la modification de cette couleur.");
      setValues((v) => ({ ...v, [id]: color }));
      present();
      setError("");
    } catch (e) {
      setError(messageOf(e));
    }
  }
  async function changeImage(field: TemplateField, file: File) {
    const instance = player.current;
    if (!instance) return;
    imageAbort.current?.abort();
    const abort = new AbortController();
    imageAbort.current = abort;
    setPreparing(true);
    setError("");
    try {
      const raw = instance.getSlot(field.slot) as
        { w?: number; h?: number } | undefined;
      const blob = await prepareLocalImage(
        file,
        field.imageWidth ?? raw?.w,
        field.imageHeight ?? raw?.h,
      );
      const source = await imageSlotSource(blob, abort.signal);
      abort.signal.throwIfAborted();
      if (!(await instance.setImageSlot(field.slot, source)))
        throw new Error("Ce slot ne peut pas recevoir cette image.");
      abort.signal.throwIfAborted();
      setValues((v) => ({ ...v, [field.slot]: file.name }));
      present();
    } catch (e) {
      if (!abort.signal.aborted) setError(messageOf(e));
    } finally {
      if (imageAbort.current === abort) {
        setPreparing(false);
        imageAbort.current = null;
      }
    }
  }
  function reset(id: string) {
    try {
      if (!player.current?.resetSlot(id))
        throw new Error("Impossible de restaurer ce champ.");
      refreshValue(id);
      setError("");
    } catch (e) {
      setError(messageOf(e));
    }
  }
  async function exportVideo(format: VideoFormat) {
    if (!player.current || !info || exportAbort.current) return;
    const instance = player.current,
      abort = new AbortController();
    exportAbort.current = abort;
    setProgress(0);
    setError("");
    setExported("");
    try {
      const { exportVideoFile } = await import("./lib/export-video");
      const blob = await exportVideoFile(
        instance,
        info,
        abort.signal,
        setProgress,
        fps,
        format,
      );
      abort.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      downloadUrls.current.add(url);
      const link = document.createElement("a");
      link.href = url;
      const basename = (local ? "template-local" : selected.id).replace(
        /[^a-z\d_-]/gi,
        "-",
      );
      link.download = `${basename}-1080p${fps}.${format}`;
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        downloadUrls.current.delete(url);
      }, 60_000);
      setExported(
        `Rendu vidéo : 100 %. Votre ${format.toUpperCase()} est prêt. Téléchargement lancé.`,
      );
    } catch (e) {
      setError(
        e instanceof Error && e.name === "AbortError"
          ? "Export annulé. Aucun fichier partiel téléchargé."
          : messageOf(e),
      );
    } finally {
      setProgress(null);
      exportAbort.current = null;
      setFrame(instance.currentFrame);
      present();
    }
  }

  const fields: TemplateField[] = local
    ? slots
        .filter((s) => ["text", "color", "image"].includes(s.type))
        .map((s) => ({
          id: s.id,
          slot: s.id,
          label: s.id,
          type: s.type as TemplateField["type"],
          multiline: s.type === "text",
        }))
    : selected.fields;
  const ready = !!info && !busy;
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="SRTB Graphics — accueil">
          <span className="brand-mark">S</span>
          <span>
            SRTB <strong>GRAPHICS</strong>
          </span>
        </a>
        <span className="workspace-label">ATELIER D’HABILLAGE</span>
        <span className="privacy">
          <ShieldCheck size={16} /> Traitement sur cet ordinateur
        </span>
      </header>
      <div className="workspace">
        <aside className="library">
          <div className="panel-heading">
            <h2>Templates</h2>
            <span className="count">{templates.length}</span>
          </div>
          <p className="section-caption">BIBLIOTHÈQUE SRTB</p>
          {templates.map((t) => (
            <button
              className={`template-card ${!local && selected.id === t.id ? "selected" : ""}`}
              key={t.id}
              onClick={() => {
                setLocal(undefined);
                setSelected(t);
                setDetails(false);
              }}
              disabled={busy}
              aria-pressed={!local && selected.id === t.id}
            >
              <div className="thumbnail">
                {t.thumbnail && (
                  <img src={t.thumbnail} alt="Aperçu du Pop-up BTV" />
                )}
                <span className="thumb-format">16:9</span>
              </div>
              <span className="template-name">{t.name}</span>
              <span className="template-category">{t.category}</span>
            </button>
          ))}
          <p className="section-caption">VOS FICHIERS</p>
          <button
            className="inspect-button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={17} /> Inspecter un template
          </button>
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            aria-label="Fichier à inspecter"
            accept=".json,.lottie"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void inspect(file);
            }}
          />
          <p className="field-help">
            .json ou .lottie · 20 Mo max.
            <br />
            Ouverture locale, sans envoi.
          </p>
          {local && (
            <div className="local-file">
              <ScanSearch size={16} />
              <span>{local.name}</span>
            </div>
          )}
          <div className="library-footer">
            <Layers3 size={18} />
            <p>
              Vos modèles, votre charte.
              <br />
              <span>Seuls les champs prévus sont modifiables.</span>
            </p>
          </div>
        </aside>
        <main className="preview-panel">
          <div className="preview-heading">
            <div>
              <span className="eyebrow">
                {local ? "INSPECTION LOCALE" : selected.category.toUpperCase()}
              </span>
              <h1>{title}</h1>
            </div>
            <span className="badge">
              {parsed
                ? `${parsed.info.width} × ${parsed.info.height}`
                : error
                  ? "Indisponible"
                  : "Chargement…"}
            </span>
          </div>
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {preparing && (
            <p role="status" className="field-help">
              Préparation du fichier sur cet ordinateur…
            </p>
          )}
          <div className="stage">
            <canvas
              ref={canvas}
              width={1920}
              height={1080}
              aria-label="Prévisualisation de l’animation"
            />
          </div>
          <div className="transport">
            <div className="transport-buttons">
              <button
                aria-label="Recommencer"
                title="Recommencer"
                disabled={!ready}
                onClick={() => {
                  player.current?.stop();
                  player.current?.play();
                }}
              >
                <RotateCcw size={18} />
              </button>
              <button
                className="play-button"
                disabled={!ready}
                onClick={() =>
                  playing ? player.current?.pause() : player.current?.play()
                }
              >
                {playing ? <Pause size={17} /> : <Play size={17} />}{" "}
                {playing ? "Pause" : "Lire"}
              </button>
              <button
                aria-label="Arrêter"
                title="Arrêter"
                disabled={!ready}
                onClick={() => player.current?.stop()}
              >
                <Square size={16} />
              </button>
            </div>
            <span className="timecode">
              {info ? (frame / info.fps).toFixed(2) : "0.00"} /{" "}
              {info?.duration.toFixed(2) ?? "—"} s
            </span>
          </div>
          <input
            className="timeline"
            aria-label="Position dans l’animation"
            type="range"
            min={0}
            max={(info?.frames ?? 1) - 1}
            step={0.01}
            value={frame}
            disabled={!ready}
            onInput={(e) => {
              const targetFrame = Number(e.currentTarget.value);
              player.current?.pause();
              player.current?.setFrame(targetFrame);
              setFrame(player.current?.currentFrame ?? targetFrame);
              present();
            }}
          />
          <div className="preview-notes">
            <span>Animation complète · {info?.fps ?? "—"} images/s</span>
            <span>Damier = transparence</span>
          </div>
          <section className="export-panel">
            <div>
              <span className="eyebrow">PRÊT POUR LE MONTAGE</span>
              <h2>Exporter votre animation</h2>
              <p>Full HD · fond noir · sans audio</p>
              <label className="fps-label">
                Cadence{" "}
                <select
                  aria-label="Cadence d’export"
                  value={fpsMode}
                  disabled={!ready}
                  onChange={(e) => setFpsMode(e.target.value)}
                >
                  <option value="25">TV — 25 images/s</option>
                  <option value="source">
                    Source — {info?.fps ?? "…"} images/s
                  </option>
                </select>
              </label>
            </div>
            <div className="export-actions">
              <button
                className="primary-button"
                disabled={!ready || !capabilities?.mp4}
                onClick={() => void exportVideo("mp4")}
              >
                <Download size={18} /> Export MP4 TV
              </button>
              <button
                className="subtle-button"
                disabled={!ready || !capabilities?.webm}
                onClick={() => void exportVideo("webm")}
              >
                WebM · fond noir
              </button>
            </div>
          </section>
          {capabilities && !capabilities.mp4 && (
            <p className="field-warning">
              H.264 indisponible sur ce navigateur.{" "}
              {capabilities.webm
                ? "Utilisez WebM ou ouvrez ce site dans Chrome / Edge récent."
                : "Ouvrez ce site en HTTPS dans Chrome ou Edge récent pour exporter."}
            </p>
          )}
          <div className="alpha-note">
            <button disabled>Export transparent</button>
            <span>
              Export transparent non disponible sur ce navigateur.
              <br />
              L’alpha n’est pas activé dans cette V1.
            </span>
          </div>
          {progress !== null && (
            <div className="export-progress" role="status">
              <span>Rendu vidéo : {progress} %</span>
              <progress max={100} value={progress} />
              <button onClick={() => exportAbort.current?.abort()}>
                Annuler
              </button>
            </div>
          )}
          {exported && (
            <p className="success" role="status">
              {exported}
            </p>
          )}
          <p className="local-note">
            <ShieldCheck size={14} /> Vos photos et vidéos restent sur cet
            ordinateur. Les modifications ne sont pas sauvegardées.
          </p>
          <button
            className="details-button"
            disabled={!parsed}
            aria-expanded={details}
            onClick={() => setDetails((v) => !v)}
          >
            <ScanSearch size={17} /> Informations et slots du template{" "}
            <ChevronDown size={16} />
          </button>
          {details && parsed && <Inspector template={parsed} slots={slots} />}
        </main>
        <aside className="properties">
          <div className="panel-heading">
            <h2>Personnaliser</h2>
            <ScanSearch size={18} />
          </div>
          <p className="property-hint">
            Ajustez le contenu. L’animation et les polices restent fidèles au
            modèle. Vérifiez la longueur des textes dans l’aperçu.
          </p>
          {!slots.length && info && (
            <p className="field-warning">
              Aucun slot natif : lecture et export uniquement. Ce modèle doit
              être préparé pour être modifiable.
            </p>
          )}
          <TemplateFields
            fields={fields}
            slots={slots}
            values={values}
            disabled={!ready}
            onText={changeText}
            onColor={changeColor}
            onImage={(field, file) => void changeImage(field, file)}
            onReset={reset}
          />
          <div className="property-note">
            {local
              ? "Les identifiants viennent du fichier inspecté. Seuls les slots texte, couleur et image sont modifiables en V1."
              : "Les couleurs proposées appartiennent à la palette BTV. Le bouton ↶ restaure la valeur originale de chaque champ."}
          </div>
        </aside>
      </div>
      <footer className="statusbar">
        <span>
          SRTB Graphics <span className="muted">/ MVP 0.1</span>
        </span>
        <span>{slots.length} slots natifs · aucune photo envoyée</span>
      </footer>
    </div>
  );
}
