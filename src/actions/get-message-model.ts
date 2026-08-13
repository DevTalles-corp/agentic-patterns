/**
 * Una simple función de verificación
 * así sabemos si todo esta listo para aprender patrones!
 */

import { APICallError, generateText } from 'ai';
import { createTracer, model } from '../helpers/index.js';

// Función básica para verificar si el modelo está funcionando
export async function getMessageFromModel() {
  const { text, usage } = await generateText({
    model,
    prompt: 'Responde solamente con: "OK, todo listo!"',
  });

  console.log(`Respuesta del modelo:`, text.green);
}

// Función con traza, para ver el proceso
export async function getMessageFromModelWithTrace() {
  const tracer = createTracer('get-message-model');
  const { text, usage } = await generateText({
    model,
    prompt: 'Responde solamente con: "OK, todo listo!"',
    onStepFinish: tracer.onStepFinish,
  });

  console.log(`Respuesta del modelo:`, text.green);
  console.table(tracer.summary());
  return tracer.summary();
}

// Función con manejo de errores, para ver el proceso
// NO es necesaria, pero la dejo por si acaso quieren hacer un test de su API key.
export async function getMessageFromModelFailSafe() {
  try {
    const { text, usage } = await generateText({
      model,
      prompt: 'Responde solamente con: "OK, todo listo!"',
    });

    console.log(`\n  Respuesta del modelo:`, text.trim().green);
    console.log(`  Tokens consumidos: ${usage?.totalTokens ?? '?'}`.blue);
    console.log(
      `\n  ✅ Todo funcionando. Puedes empezar con los patrones.\n`.green,
    );
  } catch (error) {
    console.log(`\n  ❌ La llamada al modelo falló.\n`.red);

    // El status HTTP llega en APICallError; los errores de red no lo traen.
    const status = APICallError.isInstance(error)
      ? error.statusCode
      : undefined;

    // fetch envuelve los errores de red: el código real está en cause.
    const networkCode = (error as any)?.cause?.code ?? (error as any)?.code;

    switch (true) {
      case status === 401 || status === 403:
        console.log('  Tu API key no es válida o no tiene permisos.'.yellow);
        console.log('  → ¿Renombraste .env.template a .env?');
        console.log('  → ¿Copiaste la key completa, sin espacios ni comillas?');
        console.log(
          '  → ¿El nombre de la variable coincide con el que espera el proveedor?\n',
          '   → GROQ_API_KEY='.blue,
        );
        break;

      case status === 429:
        console.log('  Te quedaste sin cuota (rate limit).'.yellow);
        console.log('  → Espera un minuto y vuelve a intentar.');
        console.log(
          '  → O cambia a un modelo más pequeño en helpers/selected-model.ts',
        );
        break;

      case status === 404:
        console.log('  El modelo solicitado no existe.'.yellow);
        console.log('  → Revisa el identificador en helpers/selected-model.ts');
        console.log('  → Algunos modelos se retiran o cambian de nombre.');
        break;

      case status !== undefined && status >= 500:
        console.log('  El proveedor tiene un problema en su servidor.'.yellow);
        console.log('  → No es culpa tuya. Reintenta en unos minutos.');
        break;

      case networkCode === 'ECONNREFUSED':
        console.log('  No hay nadie escuchando en esa dirección.'.yellow);
        console.log(
          '  → Si usas Ollama: ¿está corriendo? Prueba `ollama serve`',
        );
        console.log('  → Revisa la baseURL en helpers/selected-model.ts');
        break;

      case networkCode === 'ENOTFOUND':
        console.log('  No se pudo resolver el dominio.'.yellow);
        console.log('  → Revisa tu conexión a internet.');
        console.log('  → Revisa que la baseURL esté bien escrita.');
        break;

      default:
        console.log('  Error no identificado. Detalle completo:'.yellow);
        console.error(error);
    }

    console.log('');
  }
}
