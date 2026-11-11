const LZString = require("lz-string");

const URL =
  "https://www.ign.com/games/red-dead-redemption-2/checklists/100-percent-completion";

function tryParseJSON(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function decodeApolloState(compressed) {
  const methods = [
    {
      name: "decompress",
      decode: () => LZString.decompress(compressed),
    },
    {
      name: "decompressFromUTF16",
      decode: () => LZString.decompressFromUTF16(compressed),
    },
    {
      name: "decompressFromBase64",
      decode: () => LZString.decompressFromBase64(compressed),
    },
    {
      name: "decompressFromEncodedURIComponent",
      decode: () =>
        LZString.decompressFromEncodedURIComponent(compressed),
    },
  ];

  for (const method of methods) {
    try {
      const decoded = method.decode();

      if (!decoded) {
        continue;
      }

      const parsed = tryParseJSON(decoded);

      if (parsed) {
        return {
          method: method.name,
          decoded,
          parsed,
        };
      }

      console.log(
        `${method.name}: produjo texto (${decoded.length} caracteres), pero no JSON`
      );
    } catch (error) {
      console.log(`${method.name}: ERROR - ${error.message}`);
    }
  }

  return null;
}

async function main() {
  const response = await fetch(URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();

  const scripts = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ];

  console.log("HTTP:", response.status);
  console.log("JSON encontrados:", scripts.length);

  for (const script of scripts) {
    let data;

    try {
      data = JSON.parse(script[1]);
    } catch {
      continue;
    }

    const apolloState =
      data?.props?.apolloState ??
      data?.props?.pageProps?.apolloState ??
      data?.apolloState;

    if (!apolloState) {
      console.log("No se encontró apolloState en este JSON.");
      continue;
    }

    console.log("\napolloState encontrado.");
    console.log("Tamaño comprimido:", apolloState.length);

    const result = decodeApolloState(apolloState);

    if (!result) {
      console.log(
        "\nNo se pudo convertir apolloState a JSON mediante LZ-String."
      );
      continue;
    }

    console.log("\n=== APOLLO STATE DECODIFICADO ===");
    console.log("Método:", result.method);
    console.log("Tamaño:", result.decoded.length);

    const entities = [];

    function findChecklistEntities(obj, path = "root") {
      if (!obj || typeof obj !== "object") {
        return;
      }

      if (
        obj.__typename === "ChecklistTask" ||
        obj.__typename === "ChecklistGroup"
      ) {
        entities.push({
          path,
          data: obj,
        });
      }

      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          findChecklistEntities(obj[i], `${path}[${i}]`);
        }
      } else {
        for (const [key, value] of Object.entries(obj)) {
          findChecklistEntities(value, `${path}.${key}`);
        }
      }
    }

    findChecklistEntities(result.parsed);

    console.log(
      "\nChecklistTask / ChecklistGroup encontrados:",
      entities.length
    );

    for (const entity of entities.slice(0, 20)) {
      console.log("\nPATH:", entity.path);
      console.log(JSON.stringify(entity.data, null, 2));
    }
  }
}

main().catch((error) => {
  console.error("\nERROR:", error);
  process.exit(1);
});