const LZString = require("lz-string");

// Cambia únicamente este valor para probar otro juego
const GAME_SLUG = "elden-ring";

const URL = `https://www.ign.com/games/${GAME_SLUG}/checklists`;

function describeObject(obj, path = "root", depth = 0, maxDepth = 5) {
  if (depth > maxDepth || obj == null) {
    return;
  }

  if (Array.isArray(obj)) {
    console.log(`${path}: Array(${obj.length})`);

    if (obj.length > 0 && typeof obj[0] === "object") {
      describeObject(obj[0], `${path}[0]`, depth + 1, maxDepth);
    }

    return;
  }

  if (typeof obj !== "object") {
    return;
  }

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = `${path}.${key}`;

    if (Array.isArray(value)) {
      console.log(`${currentPath}: Array(${value.length})`);

      if (value.length > 0 && typeof value[0] === "object") {
        describeObject(
          value[0],
          `${currentPath}[0]`,
          depth + 1,
          maxDepth
        );
      }
    } else if (value && typeof value === "object") {
      console.log(`${currentPath}: object`);

      describeObject(
        value,
        currentPath,
        depth + 1,
        maxDepth
      );
    }
  }
}

function findChecklists(obj) {
  const results = [];
  const seen = new Set();

  function walk(value, path = "root") {
    if (!value || typeof value !== "object") {
      return;
    }

    if (
      value.__typename === "Checklist" ||
      (
        value.id != null &&
        typeof value.name === "string" &&
        typeof value.slug === "string" &&
        value.taskCount != null
      )
    ) {
      const key = `${value.id}:${value.slug}`;

      if (!seen.has(key)) {
        seen.add(key);

        results.push({
          path,
          id: value.id ?? null,
          name: value.name ?? null,
          slug: value.slug ?? null,
          taskCount: value.taskCount ?? null,
          typename: value.__typename ?? null,
        });
      }
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${path}[${i}]`);
      }
    } else {
      for (const [key, child] of Object.entries(value)) {
        walk(child, `${path}.${key}`);
      }
    }
  }

  walk(obj);

  return results;
}

async function main() {
  console.log("GAME:", GAME_SLUG);
  console.log("URL:", URL);

  const response = await fetch(URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`IGN respondió HTTP ${response.status}`);
  }

  console.log("HTTP:", response.status);

  const html = await response.text();

  console.log("HTML:", html.length, "bytes");

  const scripts = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ];

  console.log("JSON encontrados:", scripts.length);

  if (scripts.length === 0) {
    throw new Error("No se encontró JSON embebido.");
  }

  let validJson = null;

  for (const script of scripts) {
    try {
      const data = JSON.parse(script[1]);

      if (data?.props) {
        validJson = data;
        break;
      }
    } catch {
      // Ignorar
    }
  }

  if (!validJson) {
    throw new Error("No se encontró el JSON principal de IGN.");
  }

  console.log("\n=================================");
  console.log("ESTRUCTURA DE props.pageProps");
  console.log("=================================\n");

  const pageProps = validJson?.props?.pageProps;

  if (pageProps) {
    console.log("Claves:");

    console.log(
      Object.keys(pageProps)
    );

    console.log("\nEstructura:");

    describeObject(
      pageProps,
      "pageProps",
      0,
      4
    );
  } else {
    console.log("No existe props.pageProps");
  }

  // --------------------------------------------------
  // Buscar checklists directamente en el JSON inicial
  // --------------------------------------------------

  console.log("\n=================================");
  console.log("CHECKLISTS EN JSON INICIAL");
  console.log("=================================\n");

  const directChecklists =
    findChecklists(validJson);

  console.log(
    "Encontradas:",
    directChecklists.length
  );

  for (const checklist of directChecklists) {
    console.log("\n", checklist);
  }

  // --------------------------------------------------
  // Buscar Apollo State
  // --------------------------------------------------

  const apolloState =
    validJson?.props?.apolloState ??
    validJson?.props?.pageProps?.apolloState ??
    validJson?.apolloState;

  if (!apolloState) {
    console.log(
      "\nNo se encontró apolloState."
    );

    return;
  }

  console.log("\n=================================");
  console.log("APOLLO STATE");
  console.log("=================================\n");

  console.log(
    "Tamaño comprimido:",
    apolloState.length
  );

  const decompressed =
    LZString.decompressFromUTF16(apolloState);

  if (!decompressed) {
    throw new Error(
      "No se pudo descomprimir apolloState."
    );
  }

  console.log(
    "Tamaño descomprimido:",
    decompressed.length
  );

  let apollo;

  try {
    apollo = JSON.parse(decompressed);
  } catch (error) {
    throw new Error(
      `Apollo State no es JSON válido: ${error.message}`
    );
  }

  console.log(
    "Entidades Apollo:",
    Object.keys(apollo).length
  );

  // --------------------------------------------------
  // Buscar entidades Checklist en Apollo
  // --------------------------------------------------

  const checklistEntities = [];

  for (const [key, value] of Object.entries(apollo)) {
    if (
      value &&
      typeof value === "object" &&
      value.__typename === "Checklist"
    ) {
      checklistEntities.push({
        apolloKey: key,

        id: value.id ?? null,

        name: value.name ?? null,

        slug: value.slug ?? null,

        taskCount: value.taskCount ?? null,

        category:
          value.category?.name ??
          value.category ??
          null,

        keys: Object.keys(value),
      });
    }
  }

  console.log("\n=================================");
  console.log("ENTIDADES Checklist EN APOLLO");
  console.log("=================================\n");

  console.log(
    "Encontradas:",
    checklistEntities.length
  );

  for (const checklist of checklistEntities) {
    console.log(
      "\n" +
        JSON.stringify(
          checklist,
          null,
          2
        )
    );
  }

  // --------------------------------------------------
  // Buscar cualquier array relacionado con checklists
  // --------------------------------------------------

  console.log("\n=================================");
  console.log("POSIBLES COLECCIONES");
  console.log("=================================\n");

  function findRelevantArrays(obj, path = "root") {
    if (!obj || typeof obj !== "object") {
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      const currentPath = `${path}.${key}`;

      if (Array.isArray(value)) {
        const lower = key.toLowerCase();

        if (
          lower.includes("checklist") ||
          lower.includes("list")
        ) {
          console.log(
            `${currentPath}: Array(${value.length})`
          );

          if (value.length > 0) {
            console.log(
              "Primer elemento:"
            );

            console.log(
              JSON.stringify(
                value[0],
                null,
                2
              ).slice(0, 3000)
            );
          }
        }
      } else if (value && typeof value === "object") {
        findRelevantArrays(
          value,
          currentPath
        );
      }
    }
  }

  findRelevantArrays(pageProps);
}

main().catch((error) => {
  console.error(
    "\nERROR:",
    error.message
  );

  process.exit(1);
});