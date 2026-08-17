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
  'Termina con una línea que empiece por "RIESGO:"',
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

// TODO: Schema

async function naiveReflection() {
  console.log('\n═══ B) REFLEXIÓN INGENUA (sin criterios) ═══\n'.blue);
  const tracer = createTracer('naive-reflection');

  // TODO:

  return { ...tracer.summary() }; // score
}

// ---------------------------------------------------------------------------
// C) REFLEXIÓN CON RÚBRICA — criterios explícitos e iteración
// ---------------------------------------------------------------------------

// TODO: Schema crítico

async function reflectionWithRubric() {
  console.log('\n═══ C) REFLEXIÓN CON RÚBRICA ═══\n'.blue);
  const tracer = createTracer('con-rúbrica-reflexión');

  // TODO:

  return { ...tracer.summary() }; // score e iteraciones
}

// ---------------------------------------------------------------------------
// EJECUCIÓN DEL PROGRAMA
// ---------------------------------------------------------------------------

export async function reflectionMain() {
  const a = await withoutReflection();
  //   const b = await naiveReflection();
  //   const c = await reflectionWithRubric();

  console.log('\n═══ COMPARATIVA ═══\n'.blue);
  console.table({
    'Sin reflexión': a,
    //     'Reflexión ingenua': b,
    //     'Reflexión con rúbrica': c,
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
