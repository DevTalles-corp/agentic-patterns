# Patrones de Diseño Agéntico

## Aprendiendo sobre patrones de diseño para agentes

Este es el repositorio del proyecto para aprender sobre patrones de diseño para agentes.

### Tecnologías

- TypeScript
- Node.js
- [AI SDK](https://www.npmjs.com/package/ai)
- [Zod](https://www.npmjs.com/package/zod)

### Levantar proyecto

1. Clonar el `.env.template` y renombrarlo a `.env`
2. Llenar las variables de entorno
3. Instalar las dependencias `npm install`
4. Ejecutar el proyecto `npm run dev`
5. Cambiar el `main.ts` para ejecutar el patrón que se desee

## Actualizar dependencias (Opcional)

Para actualizar todas las dependencias a las últimas versiones permitidas por package.json, ejecuta:

```bash
npm update
```

Si quieres actualizar una dependencia específica a la última versión (mayor, menor, o patch), usa:

```bash
npm install nombre-del-paquete@latest
```

Para revisar si hay actualizaciones disponibles y ver sugerencias:

```bash
npm outdated
```

**Nota:** Si quieres actualizar todas las dependencias a la última versión disponible (rompiendo potencialmente cambios mayores), puedes usar herramientas como [`npm-check-updates`](https://www.npmjs.com/package/npm-check-updates):

```bash
npx npm-check-updates -u
npm install
```

Esto modificará tu `package.json` con las versiones más recientes.
