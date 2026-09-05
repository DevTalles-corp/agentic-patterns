/**
 * PATRÓN: Enrutamiento - Router & Specialist Routing
 * ---------------------------------------------------
 * La centralita telefónica de DevTalles. Cada llamada entra, un
 * clasificador decide UNA sola vez a qué departamento va, y se retira.
 * No es un orquestador: no reintenta ni vuelve a tomar el control.
 *
 *   A) Sin router        → una sola persona atiende todo con todas las tools
 *   B) Con router        → clasificar → transferir → fin
 *
 * Garantía estructural: cada departamento tiene UNA herramienta y son
 * disjuntas. Una llamada transferida al departamento equivocado no puede
 * resolverse: nadie ahí tiene la herramienta. No es "probablemente falle",
 * es imposible por construcción.
 */

import { generateText, tool, stepCountIs, Output } from 'ai';
import { z } from 'zod';

import { createTracer, model } from '../../helpers/index.js';

// ---------------------------------------------------------------------------
// LAS HERRAMIENTAS — una por departamento, disjuntas
// ---------------------------------------------------------------------------

const sendCatalog = tool({
  description: 'Envía el catálogo de cursos y precios al cliente. Solo ventas.',
  inputSchema: z.object({
    interest: z.string().describe('Tema de interés, ej: "Flutter"'),
  }),
  execute: async ({ interest }) => ({ sent: true, interest }),
});

const openTicket = tool({
  description:
    'Abre un ticket de soporte técnico por un problema de acceso o de plataforma.',
  inputSchema: z.object({
    issue: z.string(),
  }),
  execute: async ({ issue }) => ({
    ticketId: `TK-${Math.floor(Math.random() * 9000 + 1000)}`,
    issue,
  }),
});

const resendInvoice = tool({
  description: 'Reenvía o corrige una factura de una compra. Solo facturación.',
  inputSchema: z.object({
    reason: z.string(),
  }),
  execute: async ({ reason }) => ({
    invoiceId: `INV-${Math.floor(Math.random() * 9000 + 1000)}`,
    reason,
  }),
});

// ---------------------------------------------------------------------------
// LOS DEPARTAMENTOS
// ---------------------------------------------------------------------------

const DEPARTMENTS = {
  ventas: {
    description: 'Cursos disponibles, precios, descuentos, promociones.',
    instructions:
      'Eres del departamento de ventas de DevTalles. Envía el catálogo con tu ' +
      'herramienta y confirma en una frase. Responde en español.',
    tools: { sendCatalog },
    expectedTool: 'sendCatalog',
  },
  soporte: {
    description:
      'Problemas de acceso, videos que no cargan, errores de la plataforma.',
    instructions:
      'Eres del departamento de soporte técnico de DevTalles. Abre un ticket ' +
      'con tu herramienta y devuelve su número. Responde en español.',
    tools: { openTicket },
    expectedTool: 'openTicket',
  },
  facturacion: {
    description: 'Facturas, cobros duplicados, comprobantes de pago.',
    instructions:
      'Eres del departamento de facturación de DevTalles. Reenvía o corrige la ' +
      'factura con tu herramienta y devuelve su identificador. Responde en español.',
    tools: { resendInvoice },
    expectedTool: 'resendInvoice',
  },
} as const;

type Department = keyof typeof DEPARTMENTS;

// ---------------------------------------------------------------------------
// LAS LLAMADAS — cada una con su departamento correcto (ground truth)
// ---------------------------------------------------------------------------

const CALLS: { id: number; text: string; expected: Department }[] = [
  {
    id: 1,
    text: 'Quiero saber qué cursos tienen de Flutter y cuánto cuestan.',
    expected: 'ventas',
  },
  {
    id: 2,
    text: 'No puedo entrar a mi cuenta, dice contraseña incorrecta.',
    expected: 'soporte',
  },
  {
    id: 3,
    text: 'Necesito la factura de mi compra de agosto para mi contador.',
    expected: 'facturacion',
  },
  {
    id: 4,
    text: 'El video 14 del curso de NestJS no carga.',
    expected: 'soporte',
  },
  {
    id: 5,
    text: '¿Hacen descuento para un equipo de 10 personas?',
    expected: 'ventas',
  },
  {
    id: 6,
    text: 'Me cobraron dos veces el mismo curso.',
    expected: 'facturacion',
  },
];

// ---------------------------------------------------------------------------
// EL JUEZ PROGRAMÁTICO — la fuente de verdad del laboratorio
// ---------------------------------------------------------------------------

type Check = {
  callId: number;
  expected: Department;
  routedTo: string;
  toolsUsed: string[];
};

/**
 * Determinista. Una llamada está resuelta SOLO si el departamento que la
 * atendió ejecutó la herramienta esperada. Como las herramientas son
 * disjuntas, una transferencia equivocada nunca puede pasar esta prueba.
 */
function auditCalls(checks: Check[]) {
  let passed = 0;

  for (const check of checks) {
    const ok = check.toolsUsed.includes(
      DEPARTMENTS[check.expected].expectedTool
    );
    if (ok) passed++;

    const mark = ok ? '✓'.green : '✗'.red;
    console.log(
      `     ${mark} llamada #${check.callId} → ${check.routedTo} ` +
        `(esperado: ${check.expected}) · tools: [${check.toolsUsed.join(', ')}]`
    );
  }

  console.log(`     → ${passed}/${checks.length} llamadas resueltas`.blue);
  return `${passed}/${checks.length}`;
}

function toolNamesOf(steps: { toolCalls: { toolName: string }[] }[]) {
  return steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
}

// ---------------------------------------------------------------------------
// A) SIN ROUTER — una sola persona atiende todo
// ---------------------------------------------------------------------------

const GENERALIST_INSTRUCTIONS =
  'Eres el único operador de la centralita de DevTalles. Atiendes cualquier llamada.\n' +
  Object.values(DEPARTMENTS)
    .map((department) => `- ${department.instructions}`)
    .join('\n');
/*
 * Ejemplo: 
  Eres el único operador de la centralita de DevTalles. Atiendes cualquier llamada.
  - Cursos disponibles, precios, descuentos, promociones.
  - Problemas de acceso, videos que no cargan, errores de la plataforma.
  - Facturas, cobros duplicados, comprobantes de pago.
*/

const ALL_TOOLS = { sendCatalog, openTicket, resendInvoice };

async function withoutRouter() {
  console.log('\n═══ A) SIN ROUTER (un solo operador) ═══\n'.blue);
  const tracer = createTracer('sin-router');
  const checks: Check[] = [];

  for (const call of CALLS) {
    console.log(`\n ☎️ Llamada # ${call.id}: ${call.text}`.blue);

    // TODO: Tarea: instrucciones, all tools, stepCountIs 3
    const { text, steps } = await generateText({
      model,
      instructions: GENERALIST_INSTRUCTIONS,
      prompt: call.text,
      tools: ALL_TOOLS,
      stopWhen: stepCountIs(3),
      onStepEnd: tracer.onStepFinish,
    });

    console.log(`     Respuesta: ${text.trim()}`.green);

    checks.push({
      callId: call.id,
      expected: call.expected,
      routedTo: 'Operador único',
      toolsUsed: toolNamesOf(steps),
    });
  }

  const accuracy = auditCalls(checks);

  console.log(
    (
      '\n  ⚠️  Puede acertar. Pero cada llamada cargó las instrucciones de los ' +
      `3 departamentos (${GENERALIST_INSTRUCTIONS.length} caracteres) y las 3 tools.\n` +
      '      Con 30 departamentos, ese coste fijo se multiplica por 10.'
    ).yellow
  );

  return { ...tracer.summary(), accuracy };
}

// ---------------------------------------------------------------------------
// B) CON ROUTER — clasificar una vez, transferir, fin
// ---------------------------------------------------------------------------

/**
 * El router: prompt mínimo, salida estructurada, cero herramientas.
 */
async function classify<T extends string>(
  callText: string,
  categories: Record<T, string>,
  tracer: ReturnType<typeof createTracer>
) {
  const names = Object.keys(categories) as [T, ...T[]];

  // TODO: Implementar un agente que clasifique la llamada en un departamento.
  const output = { department: 'XXX', reason: 'XXX' };

  return output;
}

async function withRouter() {
  console.log('\n═══ B) CON ROUTER ═══\n'.blue);
  const tracer = createTracer('con-router');
  const checks: Check[] = [];

  const categories: Record<Department, string> = Object.fromEntries(
    Object.entries(DEPARTMENTS).map(([name, d]) => [name, d.description])
  ) as Record<Department, string>;

  for (const call of CALLS) {
    console.log(`\n ☎️ Llamada #${call.id}: ${call.text}`.blue);

    // 1. Clasificar (una sola vez)
    // TODO: Clasificar la llamada
    const decision = await classify(call.text, categories, tracer);
    console.log(
      `     Centralita → ${decision.department} · ${decision.reason}`.purple
    );

    // 2. Transferir: el departamento solo ve SU instrucción y SU herramienta.
    //    La centralita ya no participa.
    //TODO: Transferir la llamada al departamento correspondiente.

    const response = 'XXX';

    // Agregar la respuesta a la auditoría.
    checks.push({
      callId: call.id,
      expected: call.expected,
      routedTo: decision.department,
      toolsUsed: ['XXX'],
    });
  }

  console.log('\n Auditoría:'.blue);
  const accuracy = auditCalls(checks);

  const longest = Math.max(
    ...Object.values(DEPARTMENTS).map((d) => d.instructions.length)
  );
  console.log(
    (
      `\n  Cada llamada cargó como mucho ${longest} caracteres y 1 tool ` +
      `(vs ${GENERALIST_INSTRUCTIONS.length} y 3 del operador único).\n` +
      '  Con 30 departamentos, el coste por llamada NO cambia.'
    ).yellow
  );

  return { ...tracer.summary(), accuracy };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

export async function routingMain() {
  const a = await withoutRouter();
  // const b = await withRouter();

  console.log('\n═══ COMPARATIVA ═══\n'.blue);
  console.table({
    'Sin router (operador único)': a,
    // 'Con router': b,
  });

  console.log(
    '\n  El router cuesta una llamada extra, pero es diminuta.\n' +
      '  Lo que compra es que cada departamento cargue solo su contexto y\n' +
      '  su herramienta: el coste crece con el departamento, no con cuántos hay.\n\n' +
      '  La centralita clasifica y transfiere UNA vez; no retiene el control.\n' +
      '  Si hace falta coordinar varios departamentos o juntar sus respuestas,\n' +
      '  eso ya es otro patrón: el orquestador multi-agente.\n'
  );
}
