/**
 * PATRÓN: Uso de herramientas - Tool use
 * ---------------------------
 * El catálogo de cursos NO está en el entrenamiento
 * del modelo. Sin herramientas, el modelo inventa precios y cursos con
 * total confianza o en su defecto, no hace nada.
 * Con herramientas, consulta el dato real.
 */

import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { createTracer, model } from '../../helpers/index.js';

// ---------------------------------------------------------------------------
//  LA "BASE DE DATOS" — datos que el modelo no puede conocer
// ---------------------------------------------------------------------------

type Course = {
  id: string;
  title: string;
  hours: number;
  priceUSD: number;
  level: 'basic' | 'intermediate' | 'advanced';
  students: number;
};

const COURSE_CATALOG: Course[] = [
  {
    id: 'ts-01',
    title: 'TypeScript desde cero',
    hours: 22,
    priceUSD: 19.99,
    level: 'basic',
    students: 48_120,
  },
  {
    id: 'nest-02',
    title: 'NestJS: API REST modular',
    hours: 31,
    priceUSD: 24.99,
    level: 'intermediate',
    students: 22_450,
  },
  {
    id: 'flu-03',
    title: 'Flutter: apps multiplataforma',
    hours: 46,
    priceUSD: 29.99,
    level: 'intermediate',
    students: 61_300,
  },
  {
    id: 'agt-04',
    title: 'Agentes de IA con TypeScript',
    hours: 18,
    priceUSD: 34.99,
    level: 'advanced',
    students: 1_890,
  },
  {
    id: 'dkr-05',
    title: 'Docker para desarrolladores',
    hours: 14,
    priceUSD: 17.99,
    level: 'basic',
    students: 35_770,
  },
];

const QUESTION =
  '¿Cuánto costarían juntos el curso de TypeScript y el de Docker ' +
  'con un 20% de descuento? Dame también las horas totales.';

async function withoutTools() {
  const tracer = createTracer('sin-herramientas');

  const { text } = await generateText({
    model,
    prompt: QUESTION,
    onStepEnd: tracer.onStepFinish,
  });

  console.log('\n Respuesta: ', text.green);
  console.log('\n ⚠️ Verificar los números contra el catalogo de cursos');

  return tracer.summary();
}

//! ======== Implementar el Patrón TOOL USE

// Tool #1 find courses
const findCourses = tool({
  description:
    'Buscar cursos en el catálogo de DevTalles, por texto, ' +
    'por título o por nivel. Utilízala siempre antes de responder ' +
    'cualquier pregunta sobre cursos, precios, cantidad de alumnos. ',
  inputSchema: z.object({
    text: z
      .string()
      .optional()
      .describe('Texto a buscar en el título del curso.'),
    level: z.enum(['basic', 'intermediate', 'advanced']).optional(),
  }),
  execute: async ({ text, level }) => {
    const filteredCourses = COURSE_CATALOG.filter((course) => {
      const matchesText =
        !text || course.title.toLowerCase().includes(text.toLowerCase());
      const matchesLevel = !level || course.level === level;
      return matchesText && matchesLevel;
    });

    return {
      found: filteredCourses.length,
      courses: filteredCourses,
    };
  },
});

async function withTools() {
  const tracer = createTracer('con-herramientas');

  const { text } = await generateText({
    model,
    prompt: QUESTION,
    tools: {
      findCourses,
    },
    // Circuit Breaker
    stopWhen: stepCountIs(6),
    instructions:
      'Eres un asistente del catálogo de cursos de detalles. ' +
      ' No inventes precios, duraciones ni nombres de cursos. ' +
      ' Consúltalos siempre con las herramientas disponibles. ',
    onStepEnd: tracer.onStepFinish,
  });

  console.log('\n Respuesta: ', text.green);
  console.log('\n ⚠️ Verificar los números contra el catalogo de cursos');

  return tracer.summary();
}

export async function toolUseMain() {
  const resultA = await withoutTools();
  const resultB = await withTools();

  console.log('\n==== Comparativa ====');
  console.table({
    'Sin herramientas': resultA,
    'Con herramientas': resultB,
  });
}
