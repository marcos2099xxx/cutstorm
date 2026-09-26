/**
 * Minimal in-house i18n: the Spanish dictionary is keyed by the English
 * source string, so a missing entry falls back to English and nothing breaks.
 * No dependencies — the app keeps its tiny bundle.
 */

export type Locale = "en" | "es";

export function detectLocale(): Locale {
  try {
    const langs = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    for (const raw of langs) {
      const l = (raw || "").toLowerCase();
      if (l.startsWith("es")) return "es";
      if (l.startsWith("en")) return "en";
    }
  } catch {
    /* non-browser context */
  }
  return "en";
}

const ES: Record<string, string> = {
  // ---- app shell / errors ----
  "click to dismiss": "clic para cerrar",
  "Transcription failed.": "La transcripción falló.",
  "Transcription was interrupted (server restarted). Reload the video to try again.": "La transcripción se interrumpió (el servidor se reinició). Recarga el video para intentarlo de nuevo.",
  "Transcription seems stuck — no progress for 5 minutes. Cancel and try again.": "La transcripción parece atascada — sin progreso durante 5 minutos. Cancela e inténtalo de nuevo.",

  // ---- top bar ----
  "Saved projects": "Proyectos guardados",
  "Open saved projects": "Abrir proyectos guardados",
  "New Project": "Nuevo proyecto",
  "Export": "Exportar",
  "Exporting…": "Exportando…",
  "Export format": "Formato de exportación",
  "GIF quality": "Calidad del GIF",
  "Export quality/speed": "Calidad/velocidad de exportación",
  "High quality": "Alta calidad",
  "Fast draft": "Borrador rápido",
  "Fast uses a quicker encoder preset (medium/CRF 18) for drafts": "Rápido usa un codificador más veloz (medium/CRF 18) para borradores",
  "Low · 320px · 10fps": "Baja · 320px · 10fps",
  "Medium · 480px · 15fps": "Media · 480px · 15fps",
  "High · 720px · 20fps": "Alta · 720px · 20fps",
  "{n} segment": "{n} segmento",
  "{n} segments": "{n} segmentos",

  // ---- undo/redo ----
  "Undo": "Deshacer",
  "Redo": "Rehacer",

  // ---- hotkeys ----
  "Keyboard shortcuts": "Atajos de teclado",
  "Shortcuts ignore focus on inputs.": "Los atajos se ignoran al escribir en campos.",
  "Playback": "Reproducción",
  "Editing": "Edición",
  "Play / Pause": "Reproducir / Pausar",
  "Pause": "Pausar",
  "−5 sec": "−5 s",
  "+5 sec": "+5 s",
  "Frame step": "Avanzar fotograma",
  "Split segment at playhead": "Dividir segmento en el cursor",
  "Delete segment at playhead": "Eliminar segmento en el cursor",

  // ---- progress phases ----
  "Uploading": "Subiendo",
  "Downloading": "Descargando",
  "Transcribing": "Transcribiendo",
  "Aligning words": "Alineando palabras",
  "Rendering": "Renderizando",
  "Done": "Listo",

  // ---- uploader ----
  "Start a new caption project": "Inicia un proyecto de subtítulos",
  "WhisperX runs locally — nothing leaves your machine.": "WhisperX se ejecuta localmente — nada sale de tu máquina.",
  "Paste a video URL (YouTube, X, Vimeo, TikTok…)": "Pega una URL de video (YouTube, X, Vimeo, TikTok…)",
  "Import": "Importar",
  "Upload video": "Subir video",
  "Cancel": "Cancelar",
  "Generate subtitles": "Generar subtítulos",
  "Language": "Idioma",
  "Quality": "Calidad",
  "All languages": "Todos los idiomas",
  "Search languages…": "Buscar idiomas…",
  "No matches": "Sin resultados",
  "Best (large-v3)": "Mejor (large-v3)",
  "Turbo (large-v3-turbo)": "Turbo (large-v3-turbo)",
  "Fast (small)": "Rápida (small)",
  "Test (tiny)": "Prueba (tiny)",
  "Best quality": "Máxima calidad",
  "Downloading…": "Descargando…",
  "Transcribing…": "Transcribiendo…",
  "Drop a video or audio file or click to browse": "Suelta un archivo de video o audio o haz clic para buscar",
  "Whisper will transcribe after upload": "Whisper transcribirá después de subir",
  "Video editor only — no transcription": "Solo editor de video — sin transcripción",
  "URL must start with http:// or https://": "La URL debe empezar con http:// o https://",
  "Please drop a video or audio file.": "Suelta un archivo de video o audio.",

  // ---- sidebar ----
  "Loading…": "Cargando…",
  "No saved transcripts yet.": "Aún no hay transcripciones guardadas.",
  "Delete transcript + video": "Eliminar transcripción + video",
  "close": "cerrar",
  "just now": "ahora mismo",
  "{n} min ago": "hace {n} min",
  "{n} h ago": "hace {n} h",
  "{n} d ago": "hace {n} d",
  "Using {bytes} across {n} project": "Usando {bytes} en {n} proyecto",
  "Using {bytes} across {n} projects": "Usando {bytes} en {n} proyectos",
  "Cleaning…": "Limpiando…",
  "Clean up orphans": "Limpiar huérfanos",
  "Delete transcript for “{name}”?\n\nNext upload of the same video will re-transcribe from scratch.": "¿Eliminar la transcripción de «{name}»?\n\nLa próxima subida del mismo video se transcribirá desde cero.",
  "delete {name}": "eliminar {name}",

  // ---- transcript panel ----
  "Transcript": "Transcripción",
  "Source": "Fuente",
  "Extra": "Extra",
  "Search transcript…": "Buscar en la transcripción…",
  "{a} of {b}": "{a} de {b}",
  "Replace": "Reemplazar",
  "Replace all": "Reemplazar todo",
  "Find": "Buscar",
  "Replace with": "Reemplazar con",
  "Import .srt/.vtt": "Importar .srt/.vtt",
  "Importing…": "Importando…",
  "Align": "Alinear",
  "Run forced alignment against the audio for accurate word timings (slower)": "Alinea contra el audio para tiempos por palabra precisos (más lento)",
  "Replace the transcript with an .srt/.vtt file": "Reemplaza la transcripción con un archivo .srt/.vtt",
  "Replace the current transcript with the imported subtitles?": "¿Reemplazar la transcripción actual con los subtítulos importados?",
  "No speech detected yet.": "Aún no se detectó habla.",
  "No matches for “{q}”.": "Sin resultados para «{q}».",
  "Click to jump to this segment": "Clic para ir a este segmento",
  "Jump to this segment": "Ir a este segmento",
  "Switch to extra-audio captions": "Cambiar a los subtítulos del audio extra",
  "Generate captions from extra audio first": "Genera primero los subtítulos desde el audio extra",
  "Merge with next segment": "Unir con el segmento siguiente",
  "Delete segment (Del at playhead)": "Eliminar segmento (Del en el cursor)",
  "Transcribing… {n} segment so far · {p}%": "Transcribiendo… {n} segmento hasta ahora · {p}%",
  "Transcribing… {n} segments so far · {p}%": "Transcribiendo… {n} segmentos hasta ahora · {p}%",
  "Transcribing with Whisper…": "Transcribiendo con Whisper…",
  "transcribing": "transcribiendo",
  "Segments will appear here as they're recognised.": "Los segmentos aparecerán aquí a medida que se reconozcan.",
  "jump to segment {i}": "ir al segmento {i}",
  "merge segment {i} with next": "unir el segmento {i} con el siguiente",
  "delete segment {i}": "eliminar el segmento {i}",

  // ---- style panel ----
  "Style": "Estilo",
  "Canvas": "Lienzo",
  "(audio + chromakey)": "(audio + croma)",
  "Drag the rectangle in the preview. Drag corners to resize. Any size, any position.": "Arrastra el rectángulo en la vista previa. Arrastra las esquinas para redimensionar. Cualquier tamaño y posición.",
  "Green": "Verde",
  "Blue": "Azul",
  "Black": "Negro",
  "White": "Blanco",
  "The exported MP4 will have this solid color as its video track. Apply chromakey in your NLE (iMovie / Premiere) to overlay subtitles on another video.": "El MP4 exportado tendrá este color sólido como pista de video. Aplica croma en tu editor (iMovie / Premiere) para superponer los subtítulos sobre otro video.",
  "Preset": "Preajuste",
  "Custom crop": "Recorte personalizado",
  "Crop side": "Lado del recorte",
  "X %": "X %",
  "Y %": "Y %",
  "W %": "An %",
  "H %": "Al %",
  "Full frame": "Cuadro completo",
  "Center vertical": "Centrar vertical",
  "Center horizontal": "Centrar horizontal",
  "Export:": "Exportación:",
  "Background / chromakey": "Fondo / croma",
  "Mode": "Modo",
  "Phrase": "Frase",
  "Word": "Palabra",
  "Karaoke": "Karaoke",
  "Words per chunk": "Palabras por bloque",
  "Active word color": "Color de palabra activa",
  "Font": "Tipografía",
  "Family": "Familia",
  "Size": "Tamaño",
  "Bold": "Negrita",
  "Italic": "Cursiva",
  "Uppercase": "Mayúsculas",
  "Colors": "Colores",
  "Text": "Texto",
  "Outline": "Contorno",
  "Outline width": "Grosor del contorno",
  "Shadow offset": "Desplazamiento de sombra",
  "Shadow color": "Color de sombra",
  "Background Box": "Caja de fondo",
  "Color": "Color",
  "Opacity": "Opacidad",
  "Padding": "Relleno",
  "Radius": "Radio",
  "Auto-cut silences": "Recorte automático de silencios",
  "Trim silences on export": "Recortar silencios al exportar",
  "Remove gaps longer than threshold on export": "Elimina los huecos más largos que el umbral al exportar",
  "Silence threshold (sec)": "Umbral de silencio (s)",
  "Padding around words (sec)": "Margen alrededor de las palabras (s)",
  "{n} gap will be cut · −{s}s ({p}% of video)": "{n} hueco se recortará · −{s}s ({p}% del video)",
  "{n} gaps will be cut · −{s}s ({p}% of video)": "{n} huecos se recortarán · −{s}s ({p}% del video)",
  "gap will be cut": "hueco se recortará",
  "gaps will be cut": "huecos se recortarán",
  "of video": "del video",
  "{v} sec": "{v} s",
  "Generating subtitles — {p}. You can crop, edit style, or export at any time; subs appear as they finish.": "Generando subtítulos — {p}. Puedes recortar, editar el estilo o exportar en cualquier momento; los subtítulos aparecen a medida que terminan.",
  "Position & Timing": "Posición y tiempos",
  "Alignment": "Alineación",
  "Left": "Izquierda",
  "Center": "Centro",
  "Right": "Derecha",
  "Fade in (ms)": "Entrada (ms)",
  "Fade out (ms)": "Salida (ms)",
  "Subtitles": "Subtítulos",
  "Show & export subtitles": "Mostrar y exportar subtítulos",
  "Watermark": "Marca de agua",
  "Keep Cut/Storm watermark on export": "Mantener la marca de agua Cut/Storm al exportar",

  // ---- timeline ----
  "Audio": "Audio",
  "Loop": "Repetir",
  "Loop the selected slice across the extra audio's full duration (Coub mode)": "Repite el fragmento seleccionado durante todo el audio extra (modo Coub)",
  "(needs extra audio)": "(requiere audio extra)",
  "+ Add audio track (mp3/wav/m4a/ogg/flac/aac)": "+ Añadir pista de audio (mp3/wav/m4a/ogg/flac/aac)",
  "Generate subs": "Generar subtítulos",
  "Re-generate subs": "Regenerar subtítulos",
  "Remove extra track": "Quitar pista extra",
  "Stop transcribing this track": "Detener la transcripción de esta pista",
  "Run whisper on this audio track and add a separate subtitle track": "Ejecuta Whisper en esta pista de audio y añade una pista de subtítulos aparte",
  "{s}s kept": "{s}s conservados",
  "{n} cut · −{s}s": "{n} corte · −{s}s",
  "{n} cuts · −{s}s": "{n} cortes · −{s}s",
  "Uploading…": "Subiendo…",

  // ---- preview toolbar ----
  "Original": "Original",
  "Cuts": "Cortes",
  "Preview version": "Versión de previsualización",
  "Play the original, uncut clip": "Reproducir el clip original, sin cortes",
  "Play the cut version — skips silenced gaps": "Reproducir la versión recortada — salta los silencios",
  "Seek": "Buscar posición",
  "Stop (return to trim in)": "Detener (volver al inicio del recorte)",
  "Stop — rewind to trim in": "Detener — vuelve al inicio del recorte",
  "Play": "Reproducir",

  // ---- fonts ----
  "No fonts available": "No hay tipografías disponibles",
  "Pick a font": "Elige una tipografía",
  "Loading fonts…": "Cargando tipografías…",
  "Display": "Display",
  "Sans": "Sans",
  "Geometric": "Geométrica",
  "Serif": "Serif",
  "Handwritten": "Manuscrita",
  "CJK": "CJK",
};

export type T = (key: string, vars?: Record<string, string | number>) => string;

export function makeT(locale: Locale): T {
  return (key, vars) => {
    const template = locale === "es" ? ES[key] ?? key : key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
      vars[name] !== undefined ? String(vars[name]) : `{${name}}`,
    );
  };
}

// ---- backend error localisation -------------------------------------------
// The API answers with English `detail` strings (sometimes embedded in JSON).
// We translate the common ones; anything technical is left untouched.

const ERROR_PREFIXES: Array<[string, string]> = [
  ["transcribe-extra failed", "falló la transcripción del audio extra"],
  ["transcribe failed", "falló la transcripción"],
  ["upload failed", "falló la subida"],
  ["export failed", "falló la exportación"],
  ["fetch-url failed", "falló la importación por URL"],
  ["import failed", "falló la importación de subtítulos"],
  ["download failed", "falló la descarga"],
  ["list failed", "no se pudo cargar la lista"],
];

const ERROR_SUBSTRINGS: Array<[string, string]> = [
  ["subtitle file too large (max 5 MB)", "archivo de subtítulos demasiado grande (máx. 5 MB)"],
  ["no subtitle cues found in the file", "no se encontraron subtítulos en el archivo"],
  ["audio-only file has no frames", "el archivo de solo audio no tiene fotogramas"],
  ["extra audio track is missing on the server", "la pista de audio extra no está en el servidor"],
  ["download produced no file", "la descarga no produjo ningún archivo"],
  ["invalid extra_audio_id", "id de audio extra inválido"],
  ["extra audio not found", "audio extra no encontrado"],
  ["video not found", "video no encontrado"],
  ["transcript not found", "transcripción no encontrada"],
  ["download cancelled", "descarga cancelada"],
  ["missing filename", "falta el nombre del archivo"],
  ["unsupported file type", "tipo de archivo no soportado"],
  ["no media streams in", "no hay pistas de medios en"],
  ["output not found", "salida no encontrada"],
  ["file too large", "archivo demasiado grande"],
  ["invalid url", "URL inválida"],
];

export function translateError(message: string, locale: Locale): string {
  if (locale !== "es" || !message) return message;
  let out = message;
  const lower = out.toLowerCase();
  for (const [en, es] of ERROR_PREFIXES) {
    if (lower.startsWith(en)) {
      out = es + out.slice(en.length);
      break;
    }
  }
  for (const [en, es] of ERROR_SUBSTRINGS) {
    out = out.split(en).join(es);
  }
  return out;
}
