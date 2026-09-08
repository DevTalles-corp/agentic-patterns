/**
 * PATRÓN: Orquestador y trabajadores - Orchestrator-Workers
 * ----------------------------------------------------------
 * La misma centralita de DevTalles del laboratorio anterior, pero ahora
 * entra UNA llamada que necesita a tres departamentos a la vez.
 *
 *   A) Router (patrón anterior) → transfiere una vez y se retira → techo: 1 de 3
 *   B) Orquestador               → UN agente cuyas herramientas son los workers
 *
 * Diferencia clave con el router: el router llama al modelo una vez y suelta.
 * El orquestador es UN SOLO bucle agéntico: el mismo modelo, en la misma
 * conversación, decide a quién delegar, ve lo que vuelve y escribe la
 * respuesta final. Mantiene el control porque no sale de la conversación
 * hasta que él decide que terminó.
 *
 * Garantía estructural: el router transfiere a UN departamento con UNA
 * tool, así que resuelve como mucho 1 de 3 partes. No es probable:
 * es aritmético.
 */

import { generateText, tool, stepCountIs, Output } from 'ai';
import { z } from 'zod';

import { createTracer, model } from '../../helpers/index.js';
import { trace } from 'node:console';

// ---------------------------------------------------------------------------
// LOS DEPARTAMENTOS — iguales que en el lab 08, con tools disjuntas
// ---------------------------------------------------------------------------
// Cada tool devuelve un identificador que solo existe si se ejecutó.
// Ese identificador es la prueba: si aparece en la respuesta final,
// el departamento trabajó y el resultado llegó al cliente.

const randomId = () => Math.floor(Math.random() * 9000 + 1000);

const sendCatalog = tool({
  description: 'Envía el catálogo de cursos y precios al cliente. Solo ventas.',
  inputSchema: z.object({
    interest: z.string().describe('Tema de interés, ej: "Flutter"'),
  }),
  execute: async ({ interest }) => {
    const catalogId = `CAT-${randomId()}`;
    console.log(`       🔧 sendCatalog(${interest}) → ${catalogId}`.yellow);
    return { catalogId, interest };
  },
});

const openTicket = tool({
  description:
    'Abre un ticket de soporte técnico por un problema de acceso o de plataforma.',
  inputSchema: z.object({ issue: z.string() }),
  execute: async ({ issue }) => {
    const ticketId = `TK-${randomId()}`;
    console.log(`       🔧 openTicket(${issue}) → ${ticketId}`.yellow);
    return { ticketId, issue };
  },
});

const resendInvoice = tool({
  description: 'Reenvía o corrige una factura de una compra. Solo facturación.',
  inputSchema: z.object({ reason: z.string() }),
  execute: async ({ reason }) => {
    const invoiceId = `INV-${randomId()}`;
    console.log(`       🔧 resendInvoice(${reason}) → ${invoiceId}`.yellow);
    return { invoiceId, reason };
  },
});

const DEPARTMENTS = {
  ventas: {
    description: 'Cursos disponibles, precios, descuentos, promociones.',
    instructions:
      'Eres del departamento de ventas de DevTalles. Envía el catálogo con tu ' +
      'herramienta y confirma en una frase citando el identificador. Responde en español.',
    tools: { sendCatalog },
  },
  soporte: {
    description:
      'Problemas de acceso, videos que no cargan, errores de la plataforma.',
    instructions:
      'Eres del departamento de soporte técnico de DevTalles. Abre un ticket ' +
      'con tu herramienta y devuelve su número. Responde en español.',
    tools: { openTicket },
  },
  facturacion: {
    description: 'Facturas, cobros duplicados, comprobantes de pago.',
    instructions:
      'Eres del departamento de facturación de DevTalles. Reenvía o corrige la ' +
      'factura con tu herramienta y devuelve su identificador. Responde en español.',
    tools: { resendInvoice },
  },
} as const;

type Department = keyof typeof DEPARTMENTS;
const DEPARTMENT_NAMES = Object.keys(DEPARTMENTS) as [
  Department,
  ...Department[]
];

const DEPARTMENT_LIST = Object.entries(DEPARTMENTS)
  .map(([name, d]) => `- ${name}: ${d.description}`)
  .join('\n');
// ejemplo de DEPARTMENT_LIST:
// - ventas: Cursos disponibles, precios, descuentos, promociones.
// - soporte: Problemas de acceso, videos que no cargan, errores de la plataforma.
// - facturación: Facturas, cobros duplicados, comprobantes de pago.

// ---------------------------------------------------------------------------
// LA LLAMADA — necesita a los TRES departamentos
// ---------------------------------------------------------------------------

const COMPOUND_CALL =
  'Me cobraron dos veces el curso de NestJS, necesito la factura corregida. ' +
  'Además no puedo entrar a mi cuenta, dice contraseña incorrecta. ' +
  'Y ya que estoy: ¿tienen descuento si cambio al curso de Flutter?';

// ---------------------------------------------------------------------------
// EL JUEZ PROGRAMÁTICO — la fuente de verdad del laboratorio
// ---------------------------------------------------------------------------

type Check = { label: string; passed: boolean };

/**
 * Determinista: busca en la respuesta final los tres identificadores.
 * Solo existen como resultado de las tools, así que verlos en el texto
 * prueba que el departamento trabajó Y que su resultado llegó al cliente.
 */
function auditAnswer(text: string): Check[] {
  return [
    { label: 'Facturación: factura INV-####', passed: /INV-\d{4}/.test(text) },
    { label: 'Soporte: ticket TK-####', passed: /TK-\d{4}/.test(text) },
    { label: 'Ventas: catálogo CAT-####', passed: /CAT-\d{4}/.test(text) },
  ];
}

function printAudit(checks: Check[]) {
  const passed = checks.filter((c) => c.passed).length;
  for (const check of checks) {
    console.log(`     ${check.passed ? '✓'.green : '✗'.red} ${check.label}`);
  }
  console.log(`     → ${passed}/${checks.length} partes resueltas`.blue);
  return `${passed}/${checks.length}`;
}

// ---------------------------------------------------------------------------
// EL WORKER — un departamento atendiendo una tarea (especialista)
// ---------------------------------------------------------------------------

async function runWorker(
  department: Department,
  task: string,
  tracer: ReturnType<typeof createTracer>
) {
  const config = DEPARTMENTS[department];

  const { text } = await generateText({
    model,
    instructions: config.instructions,
    prompt: task,
    stopWhen: stepCountIs(3),
    tools: config.tools,
    onStepEnd: tracer.onStepFinish,
  });

  return text.trim();
}

// ---------------------------------------------------------------------------
// A) ROUTER — el patrón anterior, frente a una llamada que no le cabe
// ---------------------------------------------------------------------------

async function withRouter() {
  console.log('\n═══ A) ROUTER — transfiere una vez y se retira ═══\n'.blue);
  const tracer = createTracer('router');

  console.log(` ☎️ Llamada: ${COMPOUND_CALL}`.blue);

  // 1. Clasificar (una sola vez)
  const { output: decision } = await generateText({
    model,
    output: Output.object({
      schema: z.object({
        department: z.enum(DEPARTMENT_NAMES),
        reason: z
          .string()
          .describe('Una frase del por qué va a ese departamento'),
      }),
    }),
    instructions:
      'Eres un centralista. Transfiere la llamada a un único departamento: \n' +
      DEPARTMENT_LIST,
    prompt: COMPOUND_CALL,
    onStepEnd: tracer.onStepFinish,
  });

  console.log(
    `\n     Centralita → ${decision.department} · ${decision.reason}`.purple
  );

  // 2. Transferir. La centralita ya no participa.
  const answer = await runWorker(decision.department, COMPOUND_CALL, tracer);

  const accuracy = printAudit(auditAnswer(answer));

  console.log(
    (
      '\n  ⚠️  El router transfirió a UN departamento con UNA tool.\n' +
      '      Las otras dos partes de la llamada se perdieron por construcción:\n' +
      '      nadie las vio, y el router ya no está para darse cuenta.'
    ).yellow
  );

  return { ...tracer.summary(), accuracy };
}

// ---------------------------------------------------------------------------
// B) ORQUESTADOR — un solo agente cuyas herramientas son los workers
// ---------------------------------------------------------------------------

/**
 * Cada herramienta del orquestador ES un departamento completo: por dentro
 * ejecuta el worker con su propia tool y sus propias instrucciones.
 */
function delegateTo(
  department: Department,
  tracer: ReturnType<typeof createTracer>
) {
  const config = DEPARTMENTS[department];

  return tool({
    description: `Delega una tarea al departamento de ${department}: ${config.description}`,
    inputSchema: z.object({
      task: z
        .string()
        .describe('Instrucción concreta para el departamento. En una frase. '),
    }),
    execute: async ({ task }) => {
      console.log(`\n   -> Orchestrator delega a ${department}: ${task}`.blue);
      const result = await runWorker(department, task, tracer);
      console.log(`     ${department}: ${result}`.green);

      return { department, result };
    },
  });
}

async function withOrchestrator() {
  console.log('\n═══ B) ORQUESTADOR — mantiene el control ═══\n'.blue);
  const tracer = createTracer('orquestador');

  console.log(` ☎️ Llamada: ${COMPOUND_CALL}`.blue);

  const { text } = await generateText({
    model,
    instructions:
      'Eres el supervisor de la centralita de DevTalles. No atiendes al ' +
      'cliente directamente: delega cada parte de la llamada al departamento ' +
      'correspondiente con tus herramientas. Puedes delegar a varios. ' +
      'Cuando todo esté resuelto, redacta UNA sola respuesta al cliente ' +
      'integrando los resultados y conservando los identificadores exactos ' +
      '(facturas, tickets, catálogos). Responde en español, máximo 120 palabras.',
    prompt: COMPOUND_CALL,
    tools: {
      delegateToVentas: delegateTo('ventas', tracer),
      delegateToSoporte: delegateTo('soporte', tracer),
      delegateToFacturacion: delegateTo('facturacion', tracer),
    },
    stopWhen: stepCountIs(8),
    onStepEnd: tracer.onStepFinish,
  });

  console.log('\n Respuesta final al cliente:'.blue);
  console.log(`     ${text.trim()}`.green);

  console.log('\n Auditoría:'.blue);
  const accuracy = printAudit(auditAnswer(text));

  return { ...tracer.summary(), accuracy };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

export async function orchestratorWorkersMain() {
  const a = await withRouter();
  const b = await withOrchestrator();

  console.log('\n═══ COMPARATIVA ═══\n'.blue);
  console.table({
    Router: a,
    Orquestador: b,
  });

  console.log(
    '\n  El router llama al modelo una vez y suelta. El orquestador es un\n' +
      '  bucle que no termina hasta que el propio modelo decide que terminó:\n' +
      '  reparte, ve lo que vuelve, vuelve a repartir y junta las piezas.\n\n' +
      '  Eso lo hace el más caro de los patrones multi-agente. Compra\n' +
      '  resolver tareas que ningún especialista puede resolver solo.\n' +
      '  Si la tarea cabe en un especialista, un router es suficiente.\n'
  );
}
