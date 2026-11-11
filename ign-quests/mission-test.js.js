const fs = require("fs");
const path = require("path");
const LZString = require("lz-string");
const cheerio = require("cheerio");

// ======================================================
// CONFIGURACIÓN
// ======================================================

// Cambia únicamente el slug del juego
const GAME_SLUG = "the-witcher-3-wild-hunt";

const BASE_URL =
  `https://www.ign.com/games/${GAME_SLUG}/checklists`;

const OUTPUT_DIR = path.join(__dirname, "game-search");

const OUTPUT_FILE = path.join(
  OUTPUT_DIR,
  `${GAME_SLUG}-checklists-with-content.json`
);

const IGN_ORIGIN = "https://www.ign.com";

const CHECKLIST_CONCURRENCY = 2;
const CONTENT_CONCURRENCY = 3;

const REQUEST_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;
const MAX_CONTENT_LENGTH = 100000;

// ======================================================
// UTILIDADES
// ======================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function absoluteIgnUrl(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return new URL(value, IGN_ORIGIN).href;
  } catch {
    return null;
  }
}

function splitUrl(url) {
  const parsed = new URL(url);

  return {
    requestUrl:
      `${parsed.origin}${parsed.pathname}${parsed.search}`,

    fragment: parsed.hash
      ? decodeURIComponent(parsed.hash.slice(1))
      : null,
  };
}

async function mapWithConcurrency(items, limit, worker) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(
        items[currentIndex],
        currentIndex
      );

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
// DESCARGA HTTP
// ======================================================

async function fetchHtml(url, attempt = 1) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 Chrome/131 Safari/537.36",

        Accept:
          "text/html,application/xhtml+xml," +
          "application/xml;q=0.9,*/*;q=0.8",

        "Accept-Language": "en-US,en;q=0.9",
      },

      redirect: "follow",
      signal: controller.signal,
    });

    if (
      (response.status === 429 ||
        response.status >= 500) &&
      attempt < MAX_RETRIES
    ) {
      const retryDelay =
        REQUEST_DELAY_MS * attempt * 3;

      console.warn(
        `Reintentando ${url} ` +
        `(HTTP ${response.status}, intento ${attempt + 1})`
      );

      await sleep(retryDelay);

      return fetchHtml(url, attempt + 1);
    }

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} en ${url}`
      );
    }

    return await response.text();
  } catch (error) {
    if (
      attempt < MAX_RETRIES &&
      error.name === "AbortError"
    ) {
      console.warn(
        `Timeout en ${url}, reintentando...`
      );

      await sleep(REQUEST_DELAY_MS * attempt * 3);

      return fetchHtml(url, attempt + 1);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// ======================================================
// JSON Y APOLLO DE IGN
// ======================================================

function extractPageData(html) {
  const scripts = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ];

  if (scripts.length === 0) {
    throw new Error(
      "No se encontró JSON embebido en la página."
    );
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
      // Ignorar scripts que no sean JSON válido
    }
  }

  throw new Error(
    "No se encontró un JSON con apolloState."
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
  const pageData = extractPageData(html);
  const apollo = decodeApolloState(pageData);

  return {
    html,
    pageData,
    apollo,
  };
}

function resolveApolloReference(apollo, reference) {
  if (!reference?.__ref) {
    return null;
  }

  return apollo[reference.__ref] ?? null;
}

function findApolloEntity(apollo, typename, id) {
  const normalizedId = Number(id);
  const directKey = `${typename}:${normalizedId}`;

  if (apollo[directKey]) {
    return {
      apolloKey: directKey,
      value: apollo[directKey],
    };
  }

  for (const [apolloKey, value] of Object.entries(apollo)) {
    if (
      value &&
      typeof value === "object" &&
      value.__typename === typename &&
      Number(value.id) === normalizedId
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
// DESCUBRIR CHECKLISTS
// ======================================================

function findAllChecklists(apollo) {
  const uniqueChecklists = new Map();

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
      resolveApolloReference(apollo, value.category);

    uniqueChecklists.set(Number(value.id), {
      apolloKey,
      checklist: value,
      category,
    });
  }

  return [...uniqueChecklists.values()];
}

// ======================================================
// NORMALIZAR CHECKLIST TASK
// ======================================================

function normalizeTask(taskEntity, groupEntity) {
  const task = taskEntity.value;
  const group = groupEntity?.value ?? null;

  const guidePages = Array.isArray(task.guidePages)
    ? task.guidePages.map((page) => ({
        title: page.title ?? null,

        wikiUrl: page.wikiUrl ?? null,

        url: absoluteIgnUrl(page.wikiUrl),

        hasCheckbox:
          page.hasCheckbox ?? null,
      }))
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
          url: absoluteIgnUrl(task.mapUrl),
        }
      : null,

    videos: Array.isArray(task.videos)
      ? task.videos
      : [],

    selectedGuidePage: null,
    content: null,
    contentError: null,
  };
}

// ======================================================
// PROCESAR CHECKLIST ESPECÍFICA
// ======================================================

async function processChecklist(checklistEntity) {
  const checklist = checklistEntity.checklist;

  const checklistUrl =
    `${BASE_URL}/${checklist.slug}`;

  console.log(
    `Descargando checklist: ${checklist.name}`
  );

  const { apollo } =
    await getApolloFromUrl(checklistUrl);

  const joins = Array.isArray(checklist.taskJoins)
    ? checklist.taskJoins
    : [];

  const tasks = [];
  const missingTaskIds = [];
  const missingGroupIds = [];

  for (const join of joins) {
    const taskId = Number(join.checklistTaskId);

    const taskEntity = findApolloEntity(
      apollo,
      "ChecklistTask",
      taskId
    );

    if (!taskEntity) {
      missingTaskIds.push(taskId);
      continue;
    }

    let groupEntity = null;

    if (join.checklistGroupId != null) {
      const groupId =
        Number(join.checklistGroupId);

      groupEntity = findApolloEntity(
        apollo,
        "ChecklistGroup",
        groupId
      );

      if (!groupEntity) {
        missingGroupIds.push(groupId);
      }
    }

    tasks.push(
      normalizeTask(taskEntity, groupEntity)
    );
  }

  return {
    apolloKey: checklistEntity.apolloKey,

    id: checklist.id ?? null,
    name: checklist.name ?? null,
    slug: checklist.slug ?? null,
    url: checklistUrl,
    imageUrl: checklist.imageUrl ?? null,

    category: checklistEntity.category
      ? {
          id:
            checklistEntity.category.id ?? null,

          name:
            checklistEntity.category.name ?? null,

          slug:
            checklistEntity.category.slug ?? null,
        }
      : null,

    declaredTaskCount:
      checklist.taskCount ?? null,

    taskJoinsCount: joins.length,

    resolvedTaskCount: tasks.length,

    complete:
      joins.length === tasks.length &&
      missingTaskIds.length === 0,

    missingTaskIds,

    missingGroupIds: [
      ...new Set(missingGroupIds),
    ],

    tasks,
  };
}

// ======================================================
// SELECCIONAR LA GUÍA DE UNA MISIÓN
// ======================================================

function chooseGuidePage(task) {
  const pages = Array.isArray(task.guidePages)
    ? task.guidePages.filter((page) => page.url)
    : [];

  if (pages.length === 0) {
    return null;
  }

  const taskName =
    task.name?.toLowerCase().trim() ?? "";

  const exactMatch = pages.find((page) => {
    const title =
      page.title?.toLowerCase().trim() ?? "";

    return taskName && title === taskName;
  });

  if (exactMatch) {
    return exactMatch;
  }

  const nameMatch = pages.find((page) => {
    const title =
      page.title?.toLowerCase() ?? "";

    return (
      taskName &&
      (
        title.includes(taskName) ||
        taskName.includes(title)
      )
    );
  });

  if (nameMatch) {
    return nameMatch;
  }

  const specificGuide = pages.find((page) => {
    const title =
      page.title?.toLowerCase() ?? "";

    return (
      !title.includes("checklist") &&
      !title.includes("completion") &&
      !title.includes("100%")
    );
  });

  return specificGuide ?? pages[0];
}

// ======================================================
// EXTRAER CONTENIDO DE LA WIKI
// ======================================================

function removeUnwantedElements($, root) {
  root
    .find(
      [
        "script",
        "style",
        "noscript",
        "iframe",
        "svg",
        "form",
        "button",
        "nav",
        "aside",
        "footer",
        ".advertisement",
        ".ad",
        ".ad-container",
        ".newsletter",
        ".social-share",
        ".related-content",
        ".table-of-contents",
        ".toc",
      ].join(",")
    )
    .remove();
}

function findFragmentElement($, fragment) {
  if (!fragment) {
    return null;
  }

  let result = null;

  $("[id]").each((_, element) => {
    if (result) {
      return;
    }

    const id = $(element).attr("id");

    if (!id) {
      return;
    }

    let decodedId = id;

    try {
      decodedId = decodeURIComponent(id);
    } catch {
      // Mantener id original
    }

    if (
      id === fragment ||
      decodedId === fragment
    ) {
      result = element;
    }
  });

  return result;
}

function getHeadingLevel($, element) {
  const tagName = $(element)
    .prop("tagName")
    ?.toLowerCase();

  const match = tagName?.match(/^h([1-6])$/);

  return match ? Number(match[1]) : null;
}

function findSectionHeading($, element) {
  if (getHeadingLevel($, element)) {
    return element;
  }

  const closestHeading = $(element).closest(
    "h1, h2, h3, h4, h5, h6"
  );

  if (closestHeading.length > 0) {
    return closestHeading.get(0);
  }

  const previousHeading = $(element)
    .prevAll("h1, h2, h3, h4, h5, h6")
    .first();

  if (previousHeading.length > 0) {
    return previousHeading.get(0);
  }

  return element;
}

function extractFragmentSection($, fragmentElement) {
  const startElement =
    findSectionHeading($, fragmentElement);

  const start = $(startElement);

  const headingLevel =
    getHeadingLevel($, startElement);

  if (!headingLevel) {
    const container = start.closest(
      [
        "section",
        "article",
        "main",
        ".article-content",
        ".wiki-page-content",
        ".content",
      ].join(",")
    );

    if (container.length > 0) {
      return container.first().clone();
    }

    return start.parent().clone();
  }

  const wrapper = $("<div></div>");

  wrapper.append(start.clone());

  let sibling = start.next();

  while (sibling.length > 0) {
    const siblingElement = sibling.get(0);

    const siblingHeadingLevel =
      getHeadingLevel($, siblingElement);

    if (
      siblingHeadingLevel &&
      siblingHeadingLevel <= headingLevel
    ) {
      break;
    }

    wrapper.append(sibling.clone());

    sibling = sibling.next();
  }

  return wrapper;
}

function extractSections($, root) {
  const sections = [];
  let currentSection = null;

  root
    .find("h1, h2, h3, h4, h5, h6, p, li")
    .each((_, element) => {
      const tagName = $(element)
        .prop("tagName")
        ?.toLowerCase();

      const text = cleanText($(element).text());

      if (!text) {
        return;
      }

      if (/^h[1-6]$/.test(tagName)) {
        currentSection = {
          level: Number(tagName.slice(1)),
          title: text,
          paragraphs: [],
        };

        sections.push(currentSection);

        return;
      }

      if (
        tagName === "li" &&
        $(element).children("ul, ol").length > 0
      ) {
        return;
      }

      if (!currentSection) {
        currentSection = {
          level: null,
          title: null,
          paragraphs: [],
        };

        sections.push(currentSection);
      }

      if (
        !currentSection.paragraphs.includes(text)
      ) {
        currentSection.paragraphs.push(text);
      }
    });

  return sections.filter(
    (section) =>
      section.title ||
      section.paragraphs.length > 0
  );
}

function extractLinks($, root, pageUrl) {
  const links = [];
  const seen = new Set();

  root.find("a[href]").each((_, element) => {
    const href = $(element).attr("href");

    let url = null;

    try {
      url = new URL(href, pageUrl).href;
    } catch {
      return;
    }

    if (seen.has(url)) {
      return;
    }

    seen.add(url);

    links.push({
      text:
        cleanText($(element).text()) || null,
      url,
    });
  });

  return links;
}

function extractImages($, root, pageUrl) {
  const images = [];
  const seen = new Set();

  root.find("img").each((_, element) => {
    const image = $(element);

    const src =
      image.attr("src") ??
      image.attr("data-src") ??
      image.attr("data-original");

    if (!src) {
      return;
    }

    let url = null;

    try {
      url = new URL(src, pageUrl).href;
    } catch {
      return;
    }

    if (seen.has(url)) {
      return;
    }

    seen.add(url);

    images.push({
      url,
      alt:
        cleanText(image.attr("alt")) || null,
      title:
        cleanText(image.attr("title")) || null,
    });
  });

  return images;
}

function extractMissionContent(html, originalUrl) {
  const $ = cheerio.load(html);

  const { fragment } = splitUrl(originalUrl);

  const pageTitle =
    cleanText($("h1").first().text()) ||
    cleanText($("title").first().text()) ||
    null;

  const fragmentElement =
    findFragmentElement($, fragment);

  let root;
  let extractionMethod;

  if (fragmentElement) {
    root = extractFragmentSection(
      $,
      fragmentElement
    );

    extractionMethod = "fragment";
  } else {
    root = $(
      [
        "article",
        "main",
        ".article-content",
        ".wiki-page-content",
        ".content-main",
        "#content",
      ].join(",")
    ).first();

    if (root.length === 0) {
      root = $("body");
    }

    root = root.clone();

    extractionMethod = "article-fallback";
  }

  removeUnwantedElements($, root);

  const text = cleanText(root.text()).slice(
    0,
    MAX_CONTENT_LENGTH
  );

  return {
    pageTitle,
    fragment,
    fragmentFound: Boolean(fragmentElement),
    extractionMethod,
    text,
    sections: extractSections($, root),
    links: extractLinks($, root, originalUrl),
    images: extractImages($, root, originalUrl),
  };
}

// ======================================================
// DESCARGA DEL CONTENIDO DE MISIONES
// ======================================================

const pageCache = new Map();

async function enrichTaskWithContent(task) {
  const selectedGuidePage =
    chooseGuidePage(task);

  if (!selectedGuidePage) {
    return {
      ...task,
      selectedGuidePage: null,
      content: null,
      contentError:
        "La tarea no contiene ninguna guidePage válida.",
    };
  }

  const sourceUrl = selectedGuidePage.url;

  if (!sourceUrl) {
    return {
      ...task,
      selectedGuidePage,
      content: null,
      contentError:
        "No se pudo construir la URL de la guía.",
    };
  }

  const { requestUrl } = splitUrl(sourceUrl);

  try {
    let htmlPromise = pageCache.get(requestUrl);

    if (!htmlPromise) {
      htmlPromise = fetchHtml(requestUrl);
      pageCache.set(requestUrl, htmlPromise);
    }

    const html = await htmlPromise;

    const content = extractMissionContent(
      html,
      sourceUrl
    );

    return {
      ...task,

      selectedGuidePage: {
        title:
          selectedGuidePage.title ?? null,
        url: sourceUrl,
      },

      content,
      contentError: null,
    };
  } catch (error) {
    pageCache.delete(requestUrl);

    return {
      ...task,

      selectedGuidePage: {
        title:
          selectedGuidePage.title ?? null,
        url: sourceUrl,
      },

      content: null,
      contentError: error.message,
    };
  }
}

// ======================================================
// ENRIQUECER UNA CHECKLIST
// ======================================================

async function enrichChecklist(checklist) {
  const tasks = Array.isArray(checklist.tasks)
    ? checklist.tasks
    : [];

  console.log(
    `\nContenido: ${checklist.name} ` +
    `(${tasks.length} tareas)`
  );

  const enrichedTasks =
    await mapWithConcurrency(
      tasks,
      CONTENT_CONCURRENCY,
      async (task, index) => {
        const result =
          await enrichTaskWithContent(task);

        const position =
          `[${index + 1}/${tasks.length}]`;

        if (result.content) {
          console.log(
            `${position} OK: ${task.name}`
          );
        } else {
          console.warn(
            `${position} SIN CONTENIDO: ` +
            `${task.name}: ${result.contentError}`
          );
        }

        return result;
      }
    );

  return {
    ...checklist,
    tasks: enrichedTasks,
  };
}

// ======================================================
// MAIN
// ======================================================

async function main() {
  fs.mkdirSync(OUTPUT_DIR, {
    recursive: true,
  });

  console.log("Juego:", GAME_SLUG);
  console.log("Fuente:", BASE_URL);
  console.log("Salida:", OUTPUT_FILE);

  // 1. Descargar página general
  const { apollo: mainApollo } =
    await getApolloFromUrl(BASE_URL);

  // 2. Descubrir todas las checklists
  const checklistEntities =
    findAllChecklists(mainApollo);

  if (checklistEntities.length === 0) {
    throw new Error(
      `No se encontraron checklists para ${GAME_SLUG}.`
    );
  }

  console.log(
    `\nChecklists encontradas: ` +
    `${checklistEntities.length}`
  );

  for (const entity of checklistEntities) {
    console.log(
      `- ${entity.checklist.name} | ` +
      `${entity.checklist.slug} | ` +
      `${entity.checklist.taskCount} tareas`
    );
  }

  // 3. Resolver todas las ChecklistTask
  console.log(
    "\nResolviendo tareas de las checklists..."
  );

  const checklistResults =
    await mapWithConcurrency(
      checklistEntities,
      CHECKLIST_CONCURRENCY,
      async (entity) => {
        try {
          const value =
            await processChecklist(entity);

          return {
            status: "fulfilled",
            value,
          };
        } catch (error) {
          return {
            status: "rejected",

            error: error.message,

            checklist: {
              id: entity.checklist.id ?? null,
              name:
                entity.checklist.name ?? null,
              slug:
                entity.checklist.slug ?? null,
            },
          };
        }
      }
    );

  const resolvedChecklists = [];
  const checklistErrors = [];

  for (const result of checklistResults) {
    if (result.status === "fulfilled") {
      resolvedChecklists.push(result.value);

      console.log(
        `OK: ${result.value.name} ` +
        `(${result.value.resolvedTaskCount}/` +
        `${result.value.taskJoinsCount})`
      );
    } else {
      checklistErrors.push({
        ...result.checklist,
        error: result.error,
      });

      console.error(
        `ERROR: ${result.checklist.name}: ` +
        result.error
      );
    }
  }

  // 4. Obtener contenido de cada misión
  console.log(
    "\nDescargando contenido de las misiones..."
  );

  const enrichedChecklists = [];

  for (const checklist of resolvedChecklists) {
    const enriched =
      await enrichChecklist(checklist);

    enrichedChecklists.push(enriched);
  }

  // 5. Resumen
  const allTasks = enrichedChecklists.flatMap(
    (checklist) => checklist.tasks
  );

  const tasksWithContent = allTasks.filter(
    (task) => task.content !== null
  );

  const tasksWithoutGuide = allTasks.filter(
    (task) =>
      !Array.isArray(task.guidePages) ||
      task.guidePages.length === 0
  );

  const contentErrors = allTasks
    .filter((task) => task.contentError)
    .map((task) => ({
      checklistTaskId: task.id,
      name: task.name,
      error: task.contentError,
    }));

  const incompleteChecklists =
    enrichedChecklists.filter(
      (checklist) => !checklist.complete
    );

  const output = {
    gameSlug: GAME_SLUG,

    source: BASE_URL,

    generatedAt:
      new Date().toISOString(),

    summary: {
      discoveredChecklists:
        checklistEntities.length,

      processedChecklists:
        enrichedChecklists.length,

      failedChecklists:
        checklistErrors.length,

      incompleteChecklists:
        incompleteChecklists.length,

      totalTasks:
        allTasks.length,

      tasksWithContent:
        tasksWithContent.length,

      tasksWithoutContent:
        allTasks.length -
        tasksWithContent.length,

      tasksWithoutGuide:
        tasksWithoutGuide.length,

      contentErrors:
        contentErrors.length,

      downloadedUniquePages:
        pageCache.size,
    },

    checklistErrors,

    contentErrors,

    checklists: enrichedChecklists,
  };

  // 6. Guardar JSON directamente
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
    "Tareas totales:",
    output.summary.totalTasks
  );

  console.log(
    "Tareas con contenido:",
    output.summary.tasksWithContent
  );

  console.log(
    "Tareas sin contenido:",
    output.summary.tasksWithoutContent
  );

  console.log(
    "Tareas sin guía:",
    output.summary.tasksWithoutGuide
  );

  console.log(
    "Páginas únicas descargadas:",
    output.summary.downloadedUniquePages
  );

  console.log(
    "\nArchivo generado:",
    OUTPUT_FILE
  );
}

main().catch((error) => {
  console.error("\nERROR:", error.message);
  process.exit(1);
});