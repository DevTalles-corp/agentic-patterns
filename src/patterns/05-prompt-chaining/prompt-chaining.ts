/**
 * PATRÓN: Encadenamiento de prompts
 * --------------------------------------------------
 * Dos eslabones y un bucle. Nada más.
 *
 *   Eslabón 1 (modelo) → escribe el anuncio borrador
 *   Gate      (código) → ¿cabe en 280 caracteres?
 *   Eslabón 2 (modelo) → recorta, sabiendo cuánto le sobra
 *
 *
 * Por qué este ejemplo: el modelo NO SABE contar caracteres.
 * No es un problema de prompt. Es que ve tokens, no letras. Puedes
 * escribirle "MÁXIMO 280 CARACTERES" en mayúsculas
 * y puede devolver 340 con total confianza como 100 caracteres más.
 *
 * Y `text.length` nunca se equivoca.
 *
 * Esa asimetría es el patrón entero: el modelo es incapaz de verificar
 * algo que una línea de código verifica siempre. La cadena no MEJORA el
 * resultado, lo GARANTIZA.
 *
 *   A) Sin cadena  → una llamada y a rezar (esperar lo mejor)
 *   B) Con cadena  → gate + reintentos + fallback determinista
 *   C) Riesgo      → el mismo bucle, pero sin tope de reintentos (peligroso, puede no terminar)
 */

import { generateText } from 'ai';

import { createTracer, model } from '../../helpers/index.js';

// ---------------------------------------------------------------------------
// EL ENCARGO
// ---------------------------------------------------------------------------

const MAX_CHARS = 280;
const MAX_RETRIES = 4;

const COURSE = {
  title: 'Patrones de diseño agéntico: Respuestas efectivas a desafíos',
  hours: 18,
  priceUSD: 34.99,
  url: 'https://cursos.devtalles.com/cursos/patrones-diseno-agentico',
};

const BRIEF =
  `Escribe el anuncio de lanzamiento de un curso para publicarlo en X.\n\n` +
  `CURSO: ${COURSE.title}\n` +
  `DURACIÓN: ${COURSE.hours} horas\n` +
  `PRECIO: ${COURSE.priceUSD} USD\n` +
  `ENLACE: ${COURSE.url}\n\n` +
  `REQUISITOS:\n` +
  `  - Máximo ${MAX_CHARS} caracteres, contando espacios y el enlace.\n` +
  // `  - Trata de usar todo el espacio disponible.\n` +
  `  - Usar al menos ${MAX_CHARS - 40} caracteres.\n` +
  `  - Incluye el título exacto, el precio y el enlace.\n` +
  `  - Tono directo, para desarrolladores. Sin markdown.\n` +
  `  - No emojis.\n` +
  `  - No sobre vendas, se honesto con lo que ofreces.\n` +
  `  - Devuelve ÚNICAMENTE el anuncio, sin comillas ni explicaciones.`;

// ---------------------------------------------------------------------------
// EL GATE — Líneas que el modelo no puede replicar
// ---------------------------------------------------------------------------

/**
 * Fíjate en lo que devuelve: no un "hazlo más corto", "hazlo más largo",
 * sino el excedente o el faltante exacto.
 * EXACTO. Un buen gate no dice solo que no. Dice cuánto.
 */
const MIN_CHARS = MAX_CHARS - 40;

function lengthGate(text: string): string | undefined {
  if (text.length > MAX_CHARS) {
    return (
      `El anuncio tiene ${text.length} caracteres. Te sobran ` +
      `${text.length - MAX_CHARS}. Recórtalo a ${MAX_CHARS} o menos SIN ` +
      `eliminar el título exacto, el precio ni el enlace.`
    );
  }

  if (text.length < MIN_CHARS) {
    return (
      `El anuncio tiene ${text.length} caracteres y se queda corto: ` +
      `te faltan ${MIN_CHARS - text.length} para el mínimo de ${MIN_CHARS}. ` +
      `Amplíalo sin pasar de ${MAX_CHARS}: añade un beneficio concreto ` +
      `del curso o menciona las ${COURSE.hours} horas.`
    );
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// EL JUEZ PROGRAMÁTICO
// ---------------------------------------------------------------------------

type Check = { label: string; passed: boolean };

function auditAnnouncement(text: string): Check[] {
  return [
    {
      label: `≤ ${MAX_CHARS} caracteres (${text.length})`,
      passed: text.length <= MAX_CHARS,
    },
    {
      label: `Mínimo ${MAX_CHARS - 40} caracteres. Actual: ${
        text.length
      }. (falta: ${MAX_CHARS - 40 - text.length})`,
      passed: text.length >= MAX_CHARS - 40,
    },
    { label: 'Título exacto', passed: text.includes(COURSE.title) },
    { label: 'Precio', passed: /34[.,]99/.test(text) },
    { label: 'Enlace', passed: text.includes(COURSE.url) },
    { label: 'Sin markdown', passed: !/[#*_`]/.test(text) },
    {
      label: 'Sin emojis',
      passed:
        !/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(
          text
        ),
    },
  ];
}

function printAudit(checks: Check[]) {
  const passed = checks.filter((check) => check.passed).length;

  for (const check of checks) {
    const mark = check.passed ? '✓'.green : '✗'.red;
    console.log(`     ${mark} ${check.label}`);
  }
  console.log(`     → ${passed}/${checks.length} requisitos cumplidos`.blue);

  return passed;
}

// ---------------------------------------------------------------------------
// LOS ESLABONES
// ---------------------------------------------------------------------------

const WRITER_INSTRUCTIONS =
  'Escribes anuncios cortos para redes sociales. Responde en español. ' +
  'Devuelves solo el texto del anuncio, sin comillas, sin markdown, ' +
  'sin explicar lo que hiciste.';

/** Eslabón 1 — el borrador. */
async function writeAnnouncement(tracer: ReturnType<typeof createTracer>) {
  const { text } = await generateText({
    model,
    instructions: WRITER_INSTRUCTIONS,
    prompt: BRIEF,
    onStepEnd: tracer.onStepFinish,
  });

  return text.trim();
}

/** Eslabón 2 — el recorte. Recibe el veredicto del gate, no algo vago. */
// Eventualmente lo puliremos para que sea más robusto y eficiente.
async function updateAnnouncement(
  text: string, // anuncio actual
  feedback: string, // feedback del gate
  tracer: ReturnType<typeof createTracer>
) {
  const { text: newText } = await generateText({
    model,
    instructions: WRITER_INSTRUCTIONS,
    prompt:
      `ANUNCIO ACTUAL: \n---${text}---` +
      `\nPROBLEMA: \n${feedback} ---` +
      // Prevenir el degradado eventualmente
      `\n\nPrompt original: ${BRIEF}---`,
    onStepEnd: tracer.onStepFinish,
  });

  return newText.trim();
}

// ---------------------------------------------------------------------------
// A) SIN CADENA — una llamada y a rezar
// ---------------------------------------------------------------------------

async function withoutChaining() {
  console.log('\n═══ A) SIN CADENA ═══\n'.blue);
  const tracer = createTracer('sin-cadena');

  const announcement = await writeAnnouncement(tracer);
  console.log(announcement.green);
  console.log(`\nLongitud real: ${announcement.length} caracteres`);

  console.log(`\nAuditoría: `.blue);
  const score = printAudit(auditAnnouncement(announcement));

  console.log(
    `\n     ⚠️ El requisito estaba en el prompt.
      El modelo no puede cumplirlo de forma fiable porque no cuenta caracteres
      procesa tokens. Aquí no hay prompt que valga.`.yellow
  );

  return { ...tracer.summary(), score, retries: 0 }; // score
}

// ---------------------------------------------------------------------------
// B) CON CADENA — gate, reintentos acotados y fallback determinista
// ---------------------------------------------------------------------------

async function withChaining() {
  console.log('\n═══ B) CON CADENA ═══\n'.blue);
  const tracer = createTracer('con-cadena');

  let announcement = await writeAnnouncement(tracer);
  let retries = 0;

  console.log(`Borrador: ${announcement.length} caracteres.`.purple);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const feedback = lengthGate(announcement);

    if (!feedback) {
      console.log(` ✅ Gate superado en el intento ${attempt}`);
      break;
    }

    console.log(`🔴 ${feedback}`.yellow);

    announcement = await updateAnnouncement(announcement, feedback, tracer);
    retries++;
    console.log(` Intento ${attempt}: ${announcement.length} caracteres`);
  }

  // Fallback determinista
  if (lengthGate(announcement)) {
    if (announcement.length > MAX_CHARS) {
      announcement = `${announcement.slice(0, MAX_CHARS - 3)}...`;
    }
  }

  console.log(`\n${announcement.green}`);
  console.log(`\n   Longitud final: ${announcement.length} caracteres`);

  console.log('\n Auditoría:'.blue);
  const score = printAudit(auditAnnouncement(announcement));

  return { ...tracer.summary(), retries, score }; // score, retries
}

// ---------------------------------------------------------------------------
// C) RIESGO — el mismo bucle, sin tope de reintentos
// ---------------------------------------------------------------------------

/** Tope de seguridad para el laboratorio. En el bucle "sin tope" real, no lo habría. */
const SAFETY_LIMIT = 10;

async function chainWithoutRetryLimit() {
  console.log('\n═══ C) RIESGO: BUCLE SIN TOPE ═══\n'.blue);
  const tracer = createTracer('sin-tope');

  let announcement = await writeAnnouncement(tracer);
  let retries = 0;
  const history: number[] = [];

  let pendingChecks = auditAnnouncement(announcement).filter(
    (check) => !check.passed
  );

  while (pendingChecks.length > 0 && retries < SAFETY_LIMIT) {
    const feedback = pendingChecks.map((check) => check.label).join('\n');
    history.push(pendingChecks.length);

    console.log({ feedback: `Problemas: \n ${feedback}`.purple });

    announcement = await updateAnnouncement(announcement, feedback, tracer);

    retries++;
    console.log(` Intento: ${retries} \n ${announcement} ---`);
    pendingChecks = auditAnnouncement(announcement).filter(
      (check) => !check.passed
    );
  }

  console.log(`\n  Trayectoria: ${history.join(' -> ').yellow} `);
  console.log(` Auditoria`.blue);
  const score = printAudit(auditAnnouncement(announcement));
  console.log(`Anuncio final\n`.blue, announcement.green);

  console.log(
    `\n\n
  ⚠️  Mira la trayectoria. El modelo se acerca a la solución y se queda
      rondando: 4 → 3 → 2 → 1 → 1 → 1 → 2 → 1... 
      Cada iteración cuesta tokens.
      Sin tope, esto puede no terminar.
      Todo bucle necesita un techo Y una salida determinista.`.yellow
  );

  return { ...tracer.summary(), score, retries };
}

// ---------------------------------------------------------------------------
// EJECUCIÓN DEL PROGRAMA
// ---------------------------------------------------------------------------

export async function promptChainingMain() {
  const a = await withoutChaining();
  const b = await withChaining();
  const c = await chainWithoutRetryLimit();

  console.log('\n═══ COMPARATIVA ═══\n'.blue);
  console.table({
    'Sin cadena': a,
    'Con cadena': b,
    'Bucle sin tope': c,
  });

  console.log(
    '\n  El gate son unas pocas líneas de TypeScript y decide algo que el\n' +
      '  modelo no puede decidir. Esa es toda la idea del patrón.\n\n' +
      '  La cadena no mejora el anuncio: garantiza que cabe y es correcto.\n' +
      '  "Mejor a veces" y "correcto siempre" no son lo mismo.\n\n' +
      '  Y el eslabón que cierra el caso no es un prompt: es el slice.\n'
  );
}
