/**
 * PATRÓN: ReAct (Reasoning + Acting) — con API real
 * --------------------------------------------------
 *
 * Clima en Ottawa, la capital de Canadá
 *
 * Bucle que intercala razonamiento y acción:
 *   pensar → actuar → OBSERVAR → corregir la acción → actuar de nuevo
 *
 * Aquí la primera acción del agente devuelve un resultado VÁLIDO pero
 * EQUIVOCADO. No falla, no da error: responde con seguridad sobre otra
 * ciudad. El agente tiene que darse cuenta al observar el resultado y
 * reformular la llamada.
 *
 * Y no es un truco inventado: existen al menos ocho ciudades llamadas
 * "Ottawa" en el mundo (Ontario, Illinois, Kansas, Ohio, Virginia
 * Occidental, Costa de Marfil, Sudáfrica e Indonesia). Pedir el clima
 * de "Ottawa" a secas es genuinamente ambiguo.
 *
 * LO IMPORTANTE: el dato correcto NO está al alcance de la primera
 * acción. geocodeCity no acepta país: no hay forma de "pedirlo bien" a
 * la primera. Solo se llega a Ontario ejecutando una acción DISTINTA,
 * y solo se sabe que hace falta si se OBSERVA el aviso del resultado.
 * Reintentar idéntico sería el anti-patrón.
 *
 *   A) Sin ReAct → una pasada: se cree el primer resultado
 *   B) Con ReAct → observa la discrepancia y reformula
 *
 * El clima sale de Open-Meteo, una API pública real y sin API key.
 */

import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

import { createTracer, model } from '../../helpers/index.js';

// ---------------------------------------------------------------------------
// EL GEOCODIFICADOR — el eslabón ambiguo
// ---------------------------------------------------------------------------

type GeoMatch = {
  city: string;
  region: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  population: number;
};

/**
 * Datos reales de la API de geocodificación de Open-Meteo.
 * Se simulan localmente para que el laboratorio sea DETERMINISTA:
 * todos los alumnos deben obtener exactamente el mismo fallo.
 */
const GEO_DATABASE: GeoMatch[] = [
  {
    city: 'Ottawa',
    region: 'Illinois',
    country: 'Estados Unidos',
    countryCode: 'US',
    latitude: 41.35,
    longitude: -88.84,
    population: 18_342,
  },
  {
    city: 'Ottawa',
    region: 'Kansas',
    country: 'Estados Unidos',
    countryCode: 'US',
    latitude: 38.61,
    longitude: -95.26,
    population: 12_387,
  },
  {
    city: 'Ottawa',
    region: 'Ontario',
    country: 'Canadá',
    countryCode: 'CA',
    latitude: 45.41,
    longitude: -75.7,
    population: 1_017_449,
  },
  {
    city: 'Ottawa',
    region: 'Ohio',
    country: 'Estados Unidos',
    countryCode: 'US',
    latitude: 41.02,
    longitude: -84.04,
    population: 4_398,
  },
];

// ---------------------------------------------------------------------------
// HERRAMIENTA 1 — geocodificar
// ---------------------------------------------------------------------------

const geocodeCity = tool({
  description:
    'Convierte el nombre de una ciudad en coordenadas geográficas. ' +
    'Devuelve una única coincidencia.',
  inputSchema: z.object({
    city: z.string().describe('Nombre de la ciudad. ej: "Ottawa"'),
  }),
  execute: async ({ city }) => {
    console.log('Tool geocodeCity llamada - args:'.red, { city });
    const matches = GEO_DATABASE.filter(
      (m) => m.city.toLowerCase() === city.toLowerCase()
    );

    if (matches.length === 0) {
      return { error: `No se encontró ninguna ciudad llamada "${city}"` };
    }

    // ══════════════════════════════════════════════════════════════════
    //  EL INTERRUPTOR
    //
    //  Esta herramienta NO acepta país. No se puede desambiguar desde
    //  aquí, por muy claro que el usuario haya dicho "la capital de
    //  Canadá": devuelve siempre la primera coincidencia del índice,
    //  que aquí NO es la más poblada.
    //
    //  Ese es el punto: el dato correcto NO está al alcance de la
    //  primera acción. Solo se llega a él ejecutando una acción
    //  DISTINTA (listCityMatches), y para eso hay que haber leído el
    //  aviso. Reintentar esta misma llamada no cambiaría nada.
    // ══════════════════════════════════════════════════════════════════
    const first = matches[0];

    return {
      resolved: first,
      warning:
        `Hay ${matches.length} ciudades llamadas "${city}" en el índice. ` +
        'Se devolvió la primera, que puede no ser la que buscas. ' +
        'Usa listCityMatches para ver todas y elegir.',
      alternativesAvailable: matches.length - 1,
    };
  },
});

// ---------------------------------------------------------------------------
// HERRAMIENTA 2 — la salida del laberinto
// ---------------------------------------------------------------------------
// Solo tiene sentido llamarla DESPUÉS de haber observado el aviso.
// Es la acción correctiva: distinta, no una repetición.

const listCityMatches = tool({
  description:
    'Lista TODAS las ciudades que comparten un mismo nombre, con su ' +
    'región, país y coordenadas. Úsala cuando geocodeCity avise de ' +
    'varias coincidencias y necesites elegir la correcta.',
  inputSchema: z.object({
    city: z.string().describe('Nombre de la ciudad. ej: "Ottawa"'),
  }),
  execute: async ({ city }) => {
    console.log('Tool listCityMatches llamada - args:'.red, { city });
    const matches = GEO_DATABASE.filter(
      (m) => m.city.toLowerCase() === city.toLowerCase()
    );

    if (matches.length === 0) {
      return { error: `No se encontró ninguna ciudad llamada "${city}"` };
    }

    return { count: matches.length, matches };
  },
});

// ---------------------------------------------------------------------------
// HERRAMIENTA 3 — el clima, contra la API real
// ---------------------------------------------------------------------------

/** Códigos WMO, traducidos a algo legible. */
const WEATHER_CODES: Record<number, string> = {
  0: 'despejado',
  1: 'mayormente despejado',
  2: 'parcialmente nublado',
  3: 'nublado',
  45: 'niebla',
  48: 'niebla con escarcha',
  51: 'llovizna ligera',
  53: 'llovizna moderada',
  55: 'llovizna intensa',
  61: 'lluvia ligera',
  63: 'lluvia moderada',
  65: 'lluvia intensa',
  71: 'nevada ligera',
  73: 'nevada moderada',
  75: 'nevada intensa',
  80: 'chubascos',
  95: 'tormenta',
};

const getWeather = tool({
  description:
    'Consulta el clima actual para unas coordenadas geográficas. ' +
    'Requiere latitud y longitud, que se obtienen de geocodeCity.',
  inputSchema: z.object({
    latitude: z.number().describe('Latitud. ej: 45.41'),
    longitude: z.number().describe('Longitud. ej: -75.70'),
  }),
  execute: async ({ latitude, longitude }) => {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${latitude}&longitude=${longitude}` +
      '&current=temperature_2m,wind_speed_10m,weather_code' +
      '&timezone=auto';

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return { error: `La API respondió ${response.status}` };
      }

      const data = await response.json();
      const current = data.current;

      return {
        temperatureC: current.temperature_2m,
        windSpeedKmh: current.wind_speed_10m,
        conditions: WEATHER_CODES[current.weather_code] ?? 'desconocido',
        timezone: data.timezone,
        observedAt: current.time,
      };
    } catch (error) {
      return { error: `No se pudo consultar la API: ${String(error)}` };
    }
  },
});

const TOOLS = { geocodeCity, listCityMatches, getWeather };

// ---------------------------------------------------------------------------
// EL PROBLEMA
// ---------------------------------------------------------------------------

const QUESTION =
  '¿Qué clima hace ahora mismo en Ottawa, Canadá? ' + // de Canadá
  'Dime la temperatura y las condiciones.';

// ---------------------------------------------------------------------------
// A) SIN ReAct — se cree el primer resultado
// ---------------------------------------------------------------------------
// Sin ciclo de observación, el agente encadena geocode → weather y
// responde. El resultado es coherente, está bien redactado, y habla de
// una ciudad de Illinois con 18.000 habitantes.

async function withoutReAct() {
  console.log('\n═══ A) SIN ReAct — una sola pasada ═══\n'.blue);
  const tracer = createTracer('sin-react');

  const { text } = await generateText({
    model,
    prompt: QUESTION,
    tools: TOOLS,
    stopWhen: stepCountIs(4), // circuit breaker: geocode → weather = 2 acciones.
    instructions:
      'Eres un asistente meteorológico. Usa las herramientas para ' +
      'obtener el dato y responde de inmediato con lo que devuelvan. ' +
      'No cuestiones los resultados. Responde en español.',
    onStepEnd: tracer.onStepFinish,
  });

  console.log('\n Respuesta:\n'.blue, text.green);

  console.log(
    (
      '\n  ⚠️  La respuesta es fluida y probablemente falsa. Fíjate en el' +
      '\n      campo "warning" del primer resultado: la herramienta AVISÓ' +
      '\n      de la ambigüedad y nadie lo leyó.'
    ).yellow
  );

  return tracer.summary();
}

// ---------------------------------------------------------------------------
// B) CON ReAct — observar, detectar la discrepancia, reformular
// ---------------------------------------------------------------------------

async function withReAct() {
  console.log('\n═══ B) CON ReAct — bucle adaptativo ═══\n'.blue);
  const tracer = createTracer('con-react');

  const { text } = await generateText({
    model,
    prompt: QUESTION,
    tools: TOOLS,
    // Circuit breaker: geocode → listCityMatches → weather = 3 acciones.
    stopWhen: stepCountIs(8),
    // TODO: llena las instrucciones
    instructions:
      'Eres un asistente meteorológico. Trabaja en ciclos: ejecuta una ' +
      'acción, OBSERVA el resultado y comprueba que responde a lo que se ' +
      'pidió antes de continuar.\n' +
      'VERIFICACIÓN OBLIGATORIA: tras geocodificar, comprueba que la ' +
      'región y el país coinciden con lo que pidió el usuario, y LEE el ' +
      'campo "warning" del resultado. Si avisa de varias coincidencias, ' +
      'NO des por buena la que te dieron: usa listCityMatches y elige la ' +
      'correcta por país. Repetir la misma llamada no sirve de nada.\n' +
      //! Esta es la instrucción que considero importante para obtener el resultado correcto.
      'No recomiendes otra ciudad, usa la que es más probable que sea la correcta.' +
      'Si hay ambigüedad, no hace falta que recomiendes más cosas, simplemente que encontraste otras ciudades, pero siempre regresa el clima de la ciudad que es más probable que sea. ' +
      'Solo consulta el clima cuando las coordenadas sean las correctas.\n' +
      'En la respuesta final, menciona brevemente si hubo que desambiguar.\n' +
      'Tu último mensaje debe ser la respuesta al usuario, no un ' +
      'razonamiento suelto. Responde en español.',
    onStepEnd: tracer.onStepFinish,
  });

  console.log('\n Respuesta:\n'.blue, text.green);

  console.log(
    (
      '\n  ✅ Mira la traza: la acción correctiva es OTRA herramienta,' +
      '\n     no la misma repetida. El dato correcto no estaba al alcance' +
      '\n     del primer intento: había que ir a buscarlo.'
    ).yellow
  );

  return tracer.summary();
}

// ---------------------------------------------------------------------------
// EJECUCIÓN DEL PROGRAMA
// ---------------------------------------------------------------------------

export async function reActWeatherMain() {
  const a = await withoutReAct();
  const b = await withReAct();

  console.log('\n═══ COMPARATIVA ═══\n'.blue);
  console.table({
    'Sin ReAct': a,
    'Con ReAct': b,
  });

  console.log(
    '\n  Ninguna herramienta falló. Ninguna devolvió un error. La primera\n' +
      '  respuesta era técnicamente correcta: hay una Ottawa en Illinois.\n\n' +
      '  Lo que falta sin ReAct no es capacidad de recuperarse de errores,\n' +
      '  es el paso de OBSERVAR: comparar lo que volvió con lo que se pidió.\n\n' +
      '  Y observar solo sirve si puedes cambiar la siguiente acción. Por eso\n' +
      '  el bucle importa: sin él, la observación no tiene dónde aterrizar.\n'
  );
}
