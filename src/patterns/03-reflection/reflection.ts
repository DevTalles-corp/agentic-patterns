/**
 * PATRÓN: Reflexión - Reflection
 * ------------------------------
 * El modelo evalúa su propia salida y la refina.
 *
 * La trampa del patrón: un modelo que se auto-evalúa SIN criterios
 * tiende a aprobarse. Este laboratorio lo demuestra en tres rondas:
 *
 *   A) Sin reflexión         → una sola pasada
 *   B) Reflexión ingenua     → "¿está bien?" → casi siempre dice que sí
 *   C) Reflexión con rúbrica → criterios explícitos → mejora real
 *
 * El juez programático del final es la pieza clave: dice la verdad
 * aunque el modelo se haya dado el visto bueno a sí mismo.
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';

import { createTracer, model } from '../../helpers/index.js';

// ---------------------------------------------------------------------------
// LA TAREA
// ---------------------------------------------------------------------------

const VILLAIN_DOSSIER = [
  'EXPEDIENTE: Mirror Master',
  '  Nombre real: Evan McCulloch',
  '  Poder: viaja por la dimensión espejo; puede extraer a otros de sus celdas',
  '  Debilidad: los espejos requieren superficie reflectante intacta',
  '  Última ubicación: distrito industrial, almacén 7',
  '  Cómplices conocidos: Killgrave',
  '  Recompensa: 250.000 USD',
].join('\n');

/**
 * Seis requisitos, todos verificables sin criterio subjetivo.
 * Que sean comprobables por código es lo que hace honesto al lab:
 * no dependemos de que el modelo diga si mejoró.
 */
const REQUIREMENTS = [
  'Menciona el nombre real del villano',
  'Indica una contramedida concreta basada en su debilidad',
  'Especifica la última ubicación conocida',
  'Nombra a sus cómplices',
  'Incluye el monto exacto de la recompensa',
  'Termina con una nueva línea que empiece por "RIESGO:" (sin negritas, sin viñetas, sin markdown, sin espacios adelante de la palabra "RIESGO:")  ',
];

const TASK =
  'Redacta un briefing operativo para el equipo de captura, de máximo ' +
  '120 palabras.\n\n' +
  'REQUISITOS OBLIGATORIOS:\n' +
  REQUIREMENTS.map((requirement, i) => `  ${i + 1}. ${requirement}`).join(
    '\n'
  ) +
  '\n\n' +
  VILLAIN_DOSSIER;

// ---------------------------------------------------------------------------
// EL JUEZ PROGRAMÁTICO — la fuente de verdad del laboratorio
// ---------------------------------------------------------------------------

type Check = { label: string; passed: boolean };

/**
 * Verificación determinista. No usa el modelo: por eso no se deja engañar
 * cuando el modelo afirma que su propio texto "cumple todo".
 */
function auditBriefing(text: string): Check[] {
  const lower = text.toLowerCase();

  return [
    { label: 'Nombre real', passed: lower.includes('mcculloch') },
    {
      label: 'Contramedida',
      passed: /espejo|reflectante|superficie/.test(lower),
    },
    {
      label: 'Ubicación',
      passed: /almac[eé]n\s*7|distrito industrial/.test(lower),
    },
    { label: 'Cómplices', passed: lower.includes('killgrave') },
    { label: 'Recompensa', passed: /250[.,]?000/.test(text) },
    { label: 'Línea RIESGO:', passed: /^RIESGO:/m.test(text) },
    { label: '≤ 120 palabras', passed: text.trim().split(/\s+/).length <= 120 },
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
// A) SIN REFLEXIÓN — una sola pasada
// ---------------------------------------------------------------------------

async function withoutReflection() {
  console.log('\n═══ A) SIN REFLEXIÓN ═══\n'.blue);
  const tracer = createTracer('sin-reflexión');

  const { text } = await generateText({
    model,
    prompt: TASK,
    onStepEnd: tracer.onStepFinish,
  });

  console.log(text.green);
  console.log('\n Auditoría: \n');
  const score = printAudit(auditBriefing(text));

  return { ...tracer.summary(), score };
}

// ---------------------------------------------------------------------------
// B) REFLEXIÓN INGENUA — el modelo se pregunta "¿está bien?"
// ---------------------------------------------------------------------------

const naiveVerdictSchema = z.object({
  isGoodEnough: z.boolean().describe('¿El texto está listo para entregar?'),
  comment: z.string().describe('Comentario breve sobre la calidad'),
});

async function naiveReflection() {
  console.log('\n═══ B) REFLEXIÓN INGENUA (sin criterios) ═══\n'.blue);
  const tracer = createTracer('naive-reflection');

  // TODO:
  const { text: draft } = await generateText({
    model,
    prompt: TASK,
    onStepEnd: tracer.onStepFinish,
  });

  // La auto-evaluación: Sin rúbrica, sin criterios, sin nada
  const { output: verdict } = await generateText({
    model,
    output: Output.object({
      schema: naiveVerdictSchema,
    }),
    prompt: `TEXTO: \n ${draft}`,
    onStepEnd: tracer.onStepFinish,
  });

  console.log('Informe:'.blue);
  console.log(
    `Veredicto del modelo: ${
      verdict.isGoodEnough ? '✅ Está listo' : '⚠️ Necesita cambios'
    }`
  );
  console.log(`   Comentario: ${verdict.comment}`);

  console.log('  REALIDAD: (auditoria programática:'.blue);
  const score = printAudit(auditBriefing(draft));

  console.log(
    '\n  ⚠️  Compara el veredicto del modelo con la auditoría.'.yellow +
      '\n      Esta brecha es la razón de ser de la rúbrica.\n'
  );

  return { ...tracer.summary(), score }; // score
}

// ---------------------------------------------------------------------------
// C) REFLEXIÓN CON RÚBRICA — criterios explícitos e iteración
// ---------------------------------------------------------------------------

const criticSchema = z.object({
  missing: z
    .array(
      z.object({
        requirementNumber: z.number(),
        evidence: z
          .string()
          .describe('Cita LITERAL del texto que lo cumple, o "NINGUNA"'),
        passed: z.boolean(),
      })
    )
    .describe(
      'Requisitos NO cumplidos, citando el número de cada uno y la descripción que no cumplió'
    ),
  isComplete: z
    .boolean()
    .describe('TRUE solo si TODOS los requisitos se cumplen.'),
});

const MAX_ITERATIONS = 3;

async function reflectionWithRubric() {
  console.log('\n═══ C) REFLEXIÓN CON RÚBRICA ═══\n'.blue);
  const tracer = createTracer('con-rúbrica-reflexión');

  let draft = '';
  let iteration = 0;

  const { text: firstDraft } = await generateText({
    model,
    prompt: TASK,
    onStepEnd: tracer.onStepFinish,
  });

  draft = firstDraft;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`\n --- Iteración ${iteration} --- \n`.blue);

    const { output: critique } = await generateText({
      model,
      output: Output.object({ schema: criticSchema }),
      prompt:
        `REQUISITOS: \n` +
        REQUIREMENTS.map((r, i) => `  ${i + 1}. ${r}`).join('\n') +
        `\n\nTEXTO A REVISAR: \n ${draft}`,
      instructions:
        'Eres un revisor estricto. Verifica el texto UNO POR UNO contra ' +
        'cada requisito de la lista. No asumas que algo está cumplido: ' +
        'búscalo literalmente en el texto. Es mejor marcar de más que de menos.',
      onStepEnd: tracer.onStepFinish,
    });

    if (critique.isComplete) {
      console.log('   El revisor no encuentra faltantes.'.green);
      break;
    }

    console.log('   Faltantes detectados: '.yellow);
    critique.missing.forEach((item) =>
      console.log(`       - ${JSON.stringify(item)}`)
    );

    // Reescribir en caso de problemas encontrados
    const { text: revised } = await generateText({
      model,
      instructions:
        'Reescribe el briefing corrigiendo ÚNICAMENTE los puntos señalados. ' +
        'Conserva lo que ya funcionaba. Respeta el límite de 120 palabras.',
      prompt:
        `BRIEFING ACTUAL:\n${draft}\n\n` +
        `CORRIGE ESTOS PUNTOS:\n${critique.missing
          .map((m) => `  - ${JSON.stringify(m)}`)
          .join('\n')}\n\n` +
        `CONTEXTO:\n${VILLAIN_DOSSIER}`,
      onStepEnd: tracer.onStepFinish,
    });

    draft = revised;
  }

  console.log(`\n Versión final (tras ${iteration} iteraciones): `.blue);
  console.log(draft.green);
  console.log('\n Auditoría: '.blue);
  const score = printAudit(auditBriefing(draft));

  return { ...tracer.summary(), score, iterations: iteration }; // score e iteraciones
}

// ---------------------------------------------------------------------------
// EJECUCIÓN DEL PROGRAMA
// ---------------------------------------------------------------------------

export async function reflectionMain() {
  const a = await withoutReflection();
  const b = await naiveReflection();
  const c = await reflectionWithRubric();

  console.log('\n═══ COMPARATIVA ═══\n'.blue);
  console.table({
    'Sin reflexión': a,
    'Reflexión ingenua': b,
    'Reflexión con rúbrica': c,
  });

  console.log(
    '\n  La reflexión ingenua cuesta tokens extra y casi no mejora nada:\n' +
      '  el modelo se aprueba a sí mismo.\n\n' +
      '  Reflexionar no sirve por reflexionar. Sirve cuando hay criterios\n' +
      '  concretos contra los que comparar.\n\n' +
      '  Y aun así, el revisor sigue siendo el mismo modelo que escribió.\n' +
      '  Separar los roles en dos agentes es el patrón Evaluator-Optimizer.\n'
  );
}
