/**
 * PATRÓN: Paralelización - Parallelization
 * ----------------------------------------
 * Tres fases, cada una con un responsable claro:
 *
 *   1. PLANIFICAR  → un agente lee la petición y devuelve una lista de
 *                    investigaciones independientes (salida estructurada).
 *   2. EJECUTAR    → un worker por investigación, todos a la vez.
 *   3. INTEGRAR    → un agente recibe los hallazgos y redacta la salida.
 *
 * Lo que compra: latencia. Cuatro investigaciones tardan lo que tarda la
 * más lenta, no la suma de las cuatro.
 *
 * El coste oculto: los workers no se ven entre sí. Un multiplataforma
 * aparece en varias ramas y nadie puede evitarlo desde dentro. Por eso
 * la fase 3 no es opcional.
 *
 *   A) UN SOLO AGENTE  → busca y redacta él mismo, en serie.
 *   B) PLAN + FAN-OUT + INTEGRACIÓN
 *
 * REQUISITOS
 *   - Clave gratuita de RAWG: https://rawg.io/apidocs
 *   - export RAWG_API_KEY="..."
 */

import { generateText, tool, stepCountIs, Output } from 'ai';
import { z } from 'zod';

import { createTracer, model } from '../../helpers/index.js';
import { trace } from 'node:console';

const RESEARCH_REQUEST =
  'Quiero saber en los próximos 90 días, qué juegos vienen para ' +
  'Nintendo, PC, PlayStation y XBOX';

// ---------------------------------------------------------------------------
// LA HERRAMIENTA DE BÚSQUEDA — una sola, genérica
// ---------------------------------------------------------------------------

const RAWG_API_KEY = process.env.RAWG_API_KEY ?? '';

/**
 * IDs de plataforma padre en RAWG. Verifícalos con:
 * GET https://api.rawg.io/api/platforms/lists/parents?key=...
 */
const PLATFORMS = {
  pc: 1,
  playstation: 2,
  xbox: 3,
  nintendo: 7,
} as const;

type Platform = keyof typeof PLATFORMS;

const searchUpcomingGames = tool({
  description:
    'Busca los videojuegos que salen en una plataforma dentro de una ' +
    'ventana de días, ordenados por expectación. Úsala antes de responder: ' +
    'no inventes títulos ni fechas.',
  inputSchema: z.object({
    platform: z.enum(['pc', 'playstation', 'xbox', 'nintendo']),
    days: z.number().min(1).max(365).default(90),
    limit: z.number().min(3).max(20).default(10),
  }),
  execute: async ({ platform, days, limit }) => {
    const from = new Date();
    const to = new Date(from.getTime() + days * 86_400_000);
    const iso = (date: Date) => date.toISOString().slice(0, 10);

    const params = new URLSearchParams({
      key: RAWG_API_KEY,
      dates: `${iso(from)},${iso(to)}`,
      parent_platforms: String(PLATFORMS[platform as Platform]),
      ordering: '-added',
      page_size: String(limit),
    });

    const response = await fetch(`https://api.rawg.io/api/games?${params}`);
    if (!response.ok) return { error: `RAWG respondió ${response.status}` };

    const data = (await response.json()) as {
      results: { name: string; released: string | null; added: number }[];
    };

    return {
      platform,
      games: data.results
        .filter((game) => game.released)
        .map((game) => ({
          title: game.name,
          released: game.released,
          hype: game.added,
        })),
    };
  },
});

// ---------------------------------------------------------------------------
// A) UN SOLO AGENTE — busca y redacta él mismo
// ---------------------------------------------------------------------------

async function singleAgent() {
  console.log('\n═══ A) UN SOLO AGENTE ═══\n'.blue);
  const tracer = createTracer('agente-único');
  const startedAt = Date.now();

  const { text } = await generateText({
    model,
    tools: { searchUpcomingGames },
    stopWhen: stepCountIs(8),
    instructions:
      'Eres redactor de una newsletter de videojuegos. Consulta la ' +
      'herramienta para cada plataforma que te pidan y redacta un repaso ' +
      'de máximo 200 palabras con los 2 lanzamientos más relevantes de ' +
      'cada una. Responde en español.',
    prompt: RESEARCH_REQUEST,
    onStepEnd: tracer.onStepFinish,
  });

  console.log(text.green);

  return { ...tracer.summary(), ms: Date.now() - startedAt };
}

// ---------------------------------------------------------------------------
// B) PLANIFICAR → EJECUTAR EN PARALELO → INTEGRAR
// ---------------------------------------------------------------------------

// ----- Fase 1: el plan -----------------------------------------------------

/**
 * Salida estructurada. La forma importa:
 *   - `topic` es lo que vemos en consola y en la comparativa.
 *   - `assignment` es el encargo completo para el worker. Debe ser
 *     autocontenido: el worker no ve la petición original ni a los demás.
 */
const planSchema = z.object({
  tasks: z
    .array(
      z.object({
        topic: z.string().describe('Nombre corto, ej: "PlayStation"'),
        assignment: z
          .string()
          .describe(
            'Encargo completo y autocontenido para un investigador que no conoce la petición original '
          ),
      })
    )
    .min(1)
    .max(8)
    .describe('Investigaciones independientes entre sí '),
});

async function planResearch(tracer: ReturnType<typeof createTracer>) {
  // TODO: Implementar un plan (output) para seguirlo

  const { output } = await generateText({
    model,
    output: Output.object({ schema: planSchema }),
    instructions:
      'Eres un planificador. No investigues.' +
      ' Descompón la petición en investigaciones independientes que puedan hacerse a la vez, ' +
      ' una por tema. No incluyas temas que no se mencionan y responde en español. ',
    prompt: RESEARCH_REQUEST,
    onStepEnd: tracer.onStepFinish,
  });

  return output.tasks;
}

// ----- Fase 2: el worker ---------------------------------------------------

/**
 * Un sub-agente con la herramienta de búsqueda y un encargo.
 * Devuelve texto. Es el mismo runWorker que en los labs anteriores.
 */
async function runWorker(
  assignment: string,
  tracer: ReturnType<typeof createTracer>
) {
  const { text } = await generateText({
    model,
    tools: { searchUpcomingGames },
    stopWhen: stepCountIs(4),
    instructions:
      'Eres un investigador de videojuegos. Cumple tu encargo consultando ' +
      'la herramienta y responde con una lista breve: título, fecha y una ' +
      'frase de por qué importa. Copia títulos y fechas literalmente. ' +
      'Responde en español.',
    prompt: assignment,
    onStepEnd: tracer.onStepFinish,
  });

  return text;
}

// ----- Fase 3: la integración ----------------------------------------------

async function integrateFindings(
  findings: { topic: string; findings: string }[],
  tracer: ReturnType<typeof createTracer>
) {
  const { text } = await generateText({
    model,
    instructions:
      'Eres editor de una newsletter de videojuegos. Integra los hallazgos ' +
      'en un repaso de máximo 200 palabras. Si un juego aparece en varios ' +
      'temas, menciónalo UNA sola vez indicando todas sus plataformas. ' +
      'Responde en español.',
    prompt:
      `Petición original: ${RESEARCH_REQUEST} \n\n` +
      'Hallazgos por tema: \n' +
      JSON.stringify(findings),
    // findings
    //   .map((item) => `--- ${item.topic} --- \n ${item.findings}`)
    //   .join('\n\n'),
    onStepEnd: tracer.onStepFinish,
  });

  return text;
}

// ----- Las tres fases juntas -----------------------------------------------

async function planExecuteIntegrate() {
  console.log('\n═══ B) PLAN → PARALELO → INTEGRACIÓN ═══\n'.blue);

  const tracer = createTracer('paralelo');
  const startedAt = Date.now();

  // 1. Planificar
  const tasks = await planResearch(tracer);

  console.log(` Plan: ${tasks.length} investigaciones`.blue);
  for (const task of tasks) {
    console.log(`   · ${task.topic.yellow}: ${task.assignment}`);
  }

  // 2. Ejecutar en paralelo — aquí es donde se gana la latencia
  const workersStartedAt = Date.now();

  const findings = await Promise.all(
    tasks.map(async (task) => {
      console.log(`\n --> worker [${task.topic.yellow}] arranca`);
      const result = await runWorker(task.assignment, tracer);
      console.log(`\n <-- worker [${task.topic.yellow}] termina`);

      return { topic: task.topic, findings: result };
    })
  );

  const workersMs = Date.now() - workersStartedAt;

  // 3. Integrar
  const report = await integrateFindings(findings, tracer);

  console.log('\n Informe integrado:\n'.blue);
  console.log(report.green);

  return {
    ...tracer.summary(),
    ms: Date.now() - startedAt,
    workersMs,
    workers: tasks.length,
  };
}

// ---------------------------------------------------------------------------
// EJECUCIÓN DEL PROGRAMA
// ---------------------------------------------------------------------------

export async function parallelizationMain() {
  if (!RAWG_API_KEY) {
    console.error(
      '\n  Falta RAWG_API_KEY (gratuita en rawg.io/apidocs).\n'.red
    );
    return;
  }

  const a = await singleAgent();
  const b = await planExecuteIntegrate();

  console.log('\n═══ COMPARATIVA ═══\n'.blue);
  console.table({
    'A) Agente único': a,
    'B) Plan + paralelo + integración': b,
  });
}
