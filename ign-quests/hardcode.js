const fs = require("fs");
const LZString = require("lz-string");

// Cambia únicamente este valor
const GAME_SLUG = "elden-ring";

const BASE_URL = `https://www.ign.com/games/${GAME_SLUG}/checklists`;
const OUTPUT_FILE = `./game-search/${GAME_SLUG}-checklists.json`;

// Evita lanzar demasiadas peticiones simultáneas contra IGN
const CONCURRENCY = 3;
const REQUEST_DELAY_MS = 300;

// ======================================================
// UTILIDADES
// ======================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createAbsoluteIgnUrl(relativeUrl) {
  if (!relativeUrl) {
    return null;
  }

  try {
    return new URL(relativeUrl, "https://www.ign.com").href;
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${url}`);
  }

  return response.text();
}

function extractMainJson(html) {
  const scripts = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ];

  if (scripts.length === 0) {
    throw new Error("No se encontró ningún JSON embebido.");
  }

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1]);

      const apolloState =
        parsed?.props?.apolloState ??
        parsed?.props?.pageProps?.apolloState ??
        parsed?.apolloState;

      if (apolloState) {
        return parsed;
      }
    } catch {
      // Ignorar scripts no válidos
    }
  }

  throw new Error(
    "Ningún JSON embebido contiene apolloState."
  );
}

function decodeApolloState(pageData) {
  const compressed =
    pageData?.props?.apolloState ??
    pageData?.props?.pageProps?.apolloState ??
    pageData?.apolloState;

  if (!compressed) {
    throw new Error("No se encontró apolloState.");
  }

  const decompressed =
    LZString.decompressFromUTF16(compressed);

  if (!decompressed) {
    throw new Error(
      "No se pudo descomprimir apolloState."
    );
  }

  try {
    return JSON.parse(decompressed);
  } catch (error) {
    throw new Error(
      `apolloState no contiene JSON válido: ${error.message}`
    );
  }
}

async function getApolloFromUrl(url) {
  const html = await fetchHtml(url);
  const pageData = extractMainJson(html);
  const apollo = decodeApolloState(pageData);

  return {
    pageData,
    apollo,
  };
}

function resolveApolloRef(apollo, reference) {
  if (!reference?.__ref) {
    return null;
  }

  return apollo[reference.__ref] ?? null;
}

// ======================================================
// DESCUBRIR TODAS LAS CHECKLISTS
// ======================================================

function findAllChecklists(apollo) {
  const checklists = [];

  for (const [apolloKey, value] of Object.entries(apollo)) {
    if (
      !value ||
      typeof value !== "object" ||
      value.__typename !== "Checklist" ||
      value.id == null ||
      typeof value.slug !== "string" ||
      value.slug.length === 0
    ) {
      continue;
    }

    const category =
      resolveApolloRef(apollo, value.category);

    checklists.push({
      apolloKey,
      raw: value,
      category,
    });
  }

  // Eliminar posibles duplicados por ID
  const unique = new Map();

  for (const checklist of checklists) {
    unique.set(
      Number(checklist.raw.id),
      checklist
    );
  }

  return [...unique.values()];
}

// ======================================================
// BUSCAR ENTIDADES EN APOLLO
// ======================================================

function findEntityByTypeAndId(
  apollo,
  typename,
  id
) {
  const expectedId = Number(id);
  const directKey = `${typename}:${expectedId}`;

  // Primero probar la clave normal de Apollo
  if (apollo[directKey]) {
    return {
      apolloKey: directKey,
      value: apollo[directKey],
    };
  }

  // Fallback por si IGN cambia el formato de las claves
  for (const [apolloKey, value] of Object.entries(apollo)) {
    if (
      value &&
      typeof value === "object" &&
      value.__typename === typename &&
      Number(value.id) === expectedId
    ) {
      return {
        apolloKey,
        value,
      };
    }
  }

  return null;
}

// ======================================================
// NORMALIZAR TAREA
// ======================================================

function normalizeTask(taskEntity, groupEntity) {
  const task = taskEntity.value;
  const group = groupEntity?.value ?? null;

  const guidePages = Array.isArray(task.guidePages)
    ? task.guidePages.map((page) => ({
        title: page.title ?? null,
        wikiUrl: page.wikiUrl ?? null,
        url: createAbsoluteIgnUrl(page.wikiUrl),
        hasCheckbox: page.hasCheckbox ?? null,
      }))
    : [];

  const videos = Array.isArray(task.videos)
    ? task.videos
    : [];

  return {
    apolloKey: taskEntity.apolloKey,

    id: task.id ?? null,

    name: task.name ?? null,

    group: group
      ? {
          apolloKey: groupEntity.apolloKey,
          id: group.id ?? null,
          name: group.name ?? null,
        }
      : null,

    guidePages,

    map: task.map?.mapName
      ? {
          name: task.map.mapName,
          relativeUrl: task.mapUrl ?? null,
          url: createAbsoluteIgnUrl(task.mapUrl),
        }
      : null,

    videos,
  };
}

// ======================================================
// PROCESAR UNA CHECKLIST
// ======================================================

async function processChecklist(checklistEntity) {
  const checklist = checklistEntity.raw;

  const checklistUrl =
    `${BASE_URL}/${checklist.slug}`;

  console.log(
    `Procesando: ${checklist.name} (${checklist.taskCount} tareas)`
  );

  const { apollo } =
    await getApolloFromUrl(checklistUrl);

  const tasks = [];
  const missingTasks = [];
  const missingGroups = [];

  const taskJoins = Array.isArray(checklist.taskJoins)
    ? checklist.taskJoins
    : [];

  for (const join of taskJoins) {
    const taskId = Number(join.checklistTaskId);

    const taskEntity = findEntityByTypeAndId(
      apollo,
      "ChecklistTask",
      taskId
    );

    if (!taskEntity) {
      missingTasks.push(taskId);
      continue;
    }

    let groupEntity = null;

    if (join.checklistGroupId != null) {
      const groupId =
        Number(join.checklistGroupId);

      groupEntity = findEntityByTypeAndId(
        apollo,
        "ChecklistGroup",
        groupId
      );

      if (!groupEntity) {
        missingGroups.push(groupId);
      }
    }

    tasks.push(
      normalizeTask(taskEntity, groupEntity)
    );
  }

  const uniqueMissingGroups = [
    ...new Set(missingGroups),
  ];

  return {
    apolloKey: checklistEntity.apolloKey,

    id: checklist.id ?? null,

    name: checklist.name ?? null,

    slug: checklist.slug ?? null,

    url: checklistUrl,

    imageUrl: checklist.imageUrl ?? null,

    declaredTaskCount: checklist.taskCount ?? null,

    taskJoinsCount: taskJoins.length,

    resolvedTaskCount: tasks.length,

    category: checklistEntity.category
      ? {
          id:
            checklistEntity.category.id ??
            null,

          name:
            checklistEntity.category.name ??
            null,

          slug:
            checklistEntity.category.slug ??
            null,
        }
      : null,

    complete:
      tasks.length === taskJoins.length &&
      missingTasks.length === 0,

    missingTaskIds: missingTasks,

    missingGroupIds: uniqueMissingGroups,

    tasks,
  };
}

// ======================================================
// CONCURRENCIA LIMITADA
// ======================================================

async function mapWithConcurrency(
  items,
  limit,
  worker
) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      const item = items[currentIndex];

      try {
        results[currentIndex] = {
          status: "fulfilled",
          value: await worker(
            item,
            currentIndex
          ),
        };
      } catch (error) {
        results[currentIndex] = {
          status: "rejected",
          reason: error.message,
          item,
        };
      }

      await sleep(REQUEST_DELAY_MS);
    }
  }

  const workers = Array.from(
    {
      length: Math.min(limit, items.length),
    },
    () => runWorker()
  );

  await Promise.all(workers);

  return results;
}

// ======================================================
// MAIN
// ======================================================

async function main() {
  console.log("Juego:", GAME_SLUG);
  console.log("Página:", BASE_URL);
  console.log("");

  // 1. Cargar página general
  const { apollo: mainApollo } =
    await getApolloFromUrl(BASE_URL);

  // 2. Encontrar todas las checklists
  const checklistEntities =
    findAllChecklists(mainApollo);

  console.log(
    `Checklists encontradas: ${checklistEntities.length}`
  );

  if (checklistEntities.length === 0) {
    throw new Error(
      "No se encontraron entidades Checklist."
    );
  }

  for (const entity of checklistEntities) {
    console.log(
      `- ${entity.raw.name} | ` +
      `${entity.raw.slug} | ` +
      `${entity.raw.taskCount} tareas`
    );
  }

  console.log("\nProcesando checklists...\n");

  // 3. Procesarlas con concurrencia limitada
  const processingResults =
    await mapWithConcurrency(
      checklistEntities,
      CONCURRENCY,
      processChecklist
    );

  const checklists = [];
  const errors = [];

  for (let i = 0; i < processingResults.length; i++) {
    const result = processingResults[i];
    const source = checklistEntities[i].raw;

    if (result.status === "fulfilled") {
      checklists.push(result.value);

      console.log(
        `OK: ${result.value.name} ` +
        `(${result.value.resolvedTaskCount}/` +
        `${result.value.taskJoinsCount})`
      );
    } else {
      errors.push({
        id: source.id ?? null,
        name: source.name ?? null,
        slug: source.slug ?? null,
        error: result.reason,
      });

      console.error(
        `ERROR: ${source.name}: ${result.reason}`
      );
    }
  }

  // 4. Calcular totales
  const totalDeclaredTasks =
    checklists.reduce(
      (total, checklist) =>
        total +
        (Number(checklist.declaredTaskCount) || 0),
      0
    );

  const totalTaskJoins =
    checklists.reduce(
      (total, checklist) =>
        total + checklist.taskJoinsCount,
      0
    );

  const totalResolvedTasks =
    checklists.reduce(
      (total, checklist) =>
        total + checklist.resolvedTaskCount,
      0
    );

  const incompleteChecklists =
    checklists.filter(
      (checklist) => !checklist.complete
    );

  const output = {
    gameSlug: GAME_SLUG,

    source: BASE_URL,

    generatedAt: new Date().toISOString(),

    summary: {
      discoveredChecklists:
        checklistEntities.length,

      processedChecklists:
        checklists.length,

      failedChecklists:
        errors.length,

      incompleteChecklists:
        incompleteChecklists.length,

      totalDeclaredTasks,

      totalTaskJoins,

      totalResolvedTasks,
    },

    errors,

    checklists,
  };

  // 5. Guardar JSON
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(output, null, 2),
    "utf8"
  );

  console.log("\n================================");
  console.log("RESUMEN");
  console.log("================================");

  console.log(
    "Checklists descubiertas:",
    output.summary.discoveredChecklists
  );

  console.log(
    "Checklists procesadas:",
    output.summary.processedChecklists
  );

  console.log(
    "Checklists con error:",
    output.summary.failedChecklists
  );

  console.log(
    "Checklists incompletas:",
    output.summary.incompleteChecklists
  );

  console.log(
    "Tareas declaradas:",
    output.summary.totalDeclaredTasks
  );

  console.log(
    "taskJoins:",
    output.summary.totalTaskJoins
  );

  console.log(
    "Tareas resueltas:",
    output.summary.totalResolvedTasks
  );

  console.log(
    "Archivo:",
    OUTPUT_FILE
  );

  if (
    errors.length === 0 &&
    incompleteChecklists.length === 0 &&
    totalResolvedTasks === totalTaskJoins
  ) {
    console.log(
      "\nOK: todas las checklists y tareas fueron resueltas."
    );
  } else {
    console.log(
      "\nWARNING: revisa errors, missingTaskIds " +
      "y missingGroupIds en el JSON."
    );
  }
}

main().catch((error) => {
  console.error("\nERROR:", error.message);
  process.exit(1);
});