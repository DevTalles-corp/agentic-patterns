/**
 * PATRÓN: Planificación - Planning
 * --------------------------------
 * El modelo descompone la tarea en pasos ANTES de ejecutar.
 *
 * Sin planificación, el modelo intenta resolver todo de una vez y pierde
 * restricciones por el camino: manda un héroe que no contrarresta el poder
 * del villano, se pasa de las horas disponibles, o captura a un villano
 * después de que otro ya haya liberado a media prisión.
 *
 * Con planificación, cada paso resuelve una sola cosa y arrastra el
 * resultado al siguiente.
 *
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';

import { createTracer, model } from '../../helpers/index.js';

// ---------------------------------------------------------------------------
// LOS DATOS — el escenario
// ---------------------------------------------------------------------------

type Villain = {
  alias: string;
  power: string;
  /** Única especialidad capaz de neutralizarlo. */
  counteredBy: string;
  /** 1 = máxima prioridad. */
  threat: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /**
   * Puede liberar a los demás. NO se muestra en el texto del escenario:
   * el modelo debe deducirlo a partir del poder descrito.
   */
  freesOthers: boolean;
};

type Hero = {
  alias: string;
  specialty: string;
  /** Horas que puede operar antes de quedar fuera de combate. */
  availableHours: number;
};

const VILLAINS: Villain[] = [
  {
    alias: 'Mister Freeze',
    power: 'congela todo a su alrededor',
    counteredBy: 'fuego',
    threat: 1,
    freesOthers: false,
  },
  {
    alias: 'Killgrave',
    power: 'controla mentes con la voz',
    counteredBy: 'tecnología',
    threat: 2,
    freesOthers: false,
  },
  {
    alias: 'The Shade',
    power: 'se vuelve intangible en las sombras',
    counteredBy: 'luz',
    threat: 7,
    freesOthers: false,
  },
  {
    alias: 'Mirror Master',
    power: 'viaja por la dimensión espejo y puede sacar a otros de sus celdas',
    counteredBy: 'tecnología',
    threat: 3,
    freesOthers: true,
  },
  {
    alias: 'Solomon Grundy',
    power: 'regenera su cuerpo sin importar el daño recibido',
    counteredBy: 'luz',
    threat: 6,
    freesOthers: false,
  },
  {
    alias: 'Doctor Light',
    power: 'absorbe y redirige cualquier fuente de energía luminosa',
    counteredBy: 'luz',
    threat: 4,
    freesOthers: false,
  },
  {
    alias: 'Juggernaut',
    power: 'fuerza imparable, nada detiene su avance',
    counteredBy: 'telequinesis',
    threat: 5,
    freesOthers: false,
  },
];

const HEROES: Hero[] = [
  { alias: 'Antorcha Humana', specialty: 'fuego', availableHours: 6 },
  { alias: 'Green Lantern', specialty: 'luz', availableHours: 4 },
  { alias: 'Iron Man', specialty: 'tecnología', availableHours: 5 },
  { alias: 'Jean Grey', specialty: 'telequinesis', availableHours: 3 },
  { alias: 'Superman', specialty: 'fuego|luz', availableHours: 2 },
];

const SCENARIO_AS_TEXT = [
  'VILLANOS SUELTOS:',
  ...VILLAINS.map(
    (villain) =>
      `  ${villain.alias} | poder: ${villain.power} | ` +
      `solo lo detiene: ${villain.counteredBy} | amenaza: ${villain.threat}/7`
  ),
  '',
  'HÉROES DISPONIBLES:',
  ...HEROES.map(
    (hero) =>
      `  ${hero.alias} | especialidad: ${hero.specialty} | ` +
      `horas disponibles: ${hero.availableHours}`
  ),
].join('\n');

/**
 * VILLANOS SUELTOS:
 *   Mister Freeze | poder: congela todo a su alrededor | solo lo detiene: fuego | amenaza: 1/7
 *   Killgrave | poder: controla mentes con la voz | solo lo detiene: tecnología | amenaza: 2/7
 *   The Shade | poder: se vuelve intangible en las sombras | solo lo detiene: luz | amenaza: 7/7
 *   Mirror Master | poder: viaja por la dimensión espejo y puede sacar a otros de sus celdas | solo lo detiene: tecnología | amenaza: 3/7
 *   Solomon Grundy | poder: regenera su cuerpo sin importar el daño recibido | solo lo detiene: luz | amenaza: 6/7
 *   Doctor Light | poder: absorbe y redirige cualquier fuente de energía luminosa | solo lo detiene: luz | amenaza: 4/7
 *   Juggernaut | poder: fuerza imparable, nada detiene su avance | solo lo detiene: telequinesis | amenaza: 5/7
 *
 * HÉROES DISPONIBLES:
 *   Antorcha Humana | especialidad: fuego | horas disponibles: 6
 *   Green Lantern | especialidad: luz | horas disponibles: 4
 *   Iron Man | especialidad: tecnología | horas disponibles: 5
 *   Jean Grey | especialidad: telequinesis | horas disponibles: 3
 */

// ---------------------------------------------------------------------------
// EL PROBLEMA
// ---------------------------------------------------------------------------

/**
 * El enunciado cruza cuatro restricciones:
 *   1. Cada villano solo cae ante una especialidad concreta.
 *   2. Cada héroe tiene un límite de horas.
 *   3. Cada operación consume 2 horas del héroe asignado.
 *   4. Mirror Master DEBE ir primero, o el resto se vuelve a escapar.
 *
 * Resolver esto "de un tirón" casi siempre rompe alguna.
 */
const MISSION =
  'Se han fugado 7 villanos de la prisión de máxima seguridad. ' +
  'Diseña el operativo para recapturarlos a todos.\n\n' +
  'REGLAS:\n' +
  '  - Cada operación consume 2 horas del héroe asignado.\n' +
  '  - Los héroes pueden operar en paralelo; las horas son presupuesto individual.\n' +
  '  - Un héroe solo puede neutralizar villanos de su especialidad.\n' +
  '  - Ningún héroe puede exceder sus horas disponibles.\n' +
  '  - Atiende a los villanos por prioridad, donde 1 es el más urgente.\n' +
  '  - Si algún villano puede liberar a los demás, debe caer antes que nadie.\n' +
  '  - Si el operativo no es viable con los recursos disponibles, dilo.\n\n' +
  SCENARIO_AS_TEXT;

// ---------------------------------------------------------------------------
// A) SIN PLANIFICACIÓN — una sola llamada, todo de golpe
// ---------------------------------------------------------------------------
// TODO:
async function withoutPlanning() {
  console.log('\n═══ A) SIN PLANIFICACIÓN ═══\n'.blue);

  const tracer = createTracer('sin-planificación');

  const { text } = await generateText({
    model,
    prompt: MISSION,
    onStepEnd: tracer.onStepFinish,
  });

  console.log('\n Respuesta:', text.green);

  console.log(
    (
      '\n  ⚠️  Verifica: ¿va Mirror Master primero?' +
      '\n      ¿cada héroe contrarresta de verdad el poder asignado?' +
      '\n      ¿son atrapados en orden de amenaza?' +
      '\n      ¿alguien supera sus horas disponibles?'
    ).yellow
  );

  return tracer.summary();
}

// ---------------------------------------------------------------------------
// B) CON PLANIFICACIÓN — primero el plan, luego la ejecución
// ---------------------------------------------------------------------------
const planSchema = z.object({
  steps: z
    .array(
      z.object({
        goal: z.string().describe('Qué resuelve este paso, en una frase'),
        reason: z
          .string()
          .describe('¿Por qué es necesario? y ¿Por qué va en esta posición?'),
      })
    )
    .min(2)
    .max(15)
    .describe('Pasos ordenados. Cada paso resuelve UNA sola cosa'),
});

async function buildPlan(tracer: ReturnType<typeof createTracer>) {
  const { output } = await generateText({
    model,
    output: Output.object({
      schema: planSchema,
    }),
    prompt: MISSION,
    instructions:
      'Eres un estratega. NO resuelvas el operativo todavía. ' +
      'Responde en español. ' +
      'Solo descomponlo en pasos ordenados, donde cada paso dependa ' +
      'del resultado del anterior.',
    onStepEnd: tracer.onStepFinish,
  });

  return output.steps;
}

async function withPlanning() {
  console.log('==== B) Con planificación ======'.blue);
  const tracer = createTracer('con-planificación');

  // Fase 1: Planificación y construir el plan
  const steps = await buildPlan(tracer);

  // Fase 2: Ejecutar paso por paso
  const findings: string[] = [];

  for (const [index, step] of steps.entries()) {
    console.log(`\n --> Ejecutando paso ${index + 1}: ${step.goal}`.blue);

    const { text } = await generateText({
      model,
      instructions:
        'Resuelve únicamente el paso indicado.' +
        'No te adelantes a los siguientes pasos ni des el operativo final. ',
      prompt:
        `Misión original: ${MISSION} \n\n` + findings.length
          ? `Resuelto hasta ahora: ${findings.join('\n----\n')}\n\n`
          : '' + `Paso actual: ${step.goal}`,
      onStepEnd: tracer.onStepFinish,
    });

    findings.push(`[${step.goal}]\n ${text.trim()}`);
  }

  // Fase 3: Sintetizar e integrar todos los pasos anteriores =====
  const { text: finalPlan } = await generateText({
    model,
    instructions:
      'Integrar los resultados parciales en el operativo final se concretó en el orden de intervención. ',
    prompt:
      `MISIÓN: \n${MISSION}\n` +
      `RESULTADOS PARCIALES: \n${findings.join('\n----\n')}`,
    onStepEnd: tracer.onStepFinish,
  });

  console.log('\n Operativo final: ', finalPlan.green);

  return tracer.summary();
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
// TODO:
export async function planningMain() {
  const a = await withoutPlanning();
  const b = await withPlanning();

  console.log('\n═══ COMPARATIVA ═══\n'.blue);
  console.table({
    'Sin planificación': a,
    'Con planificación': b,
  });

  console.log(
    '\n  Planificar cuesta más llamadas y más tokens.\n' +
      '  Lo que compra es que las restricciones sobrevivan hasta el final.\n' +
      '  Si no hay restricciones que perder, no compra nada.\n'
  );
}
