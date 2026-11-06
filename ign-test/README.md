# IGN Missions Service

Servicio de GRYD encargado de localizar automáticamente la wiki de un videojuego en IGN y extraer sus misiones principales.

El objetivo es poder obtener las misiones utilizando únicamente el nombre del juego:

```js
const missions = await getGameMissions("Cyberpunk 2077");
```

El servicio se encarga internamente de:

1. Buscar el juego en IGN.
2. Localizar su wiki.
3. Encontrar automáticamente su Walkthrough.
4. Detectar cómo estructura IGN las misiones.
5. Extraer las misiones principales.
6. Devolver un array con `{ name, url }`.

---

## Ubicación

El archivo debe estar ubicado en:

```text
backend/
└── src/
    └── services/
        ├── fous.client.js
        ├── game-cache.service.js
        ├── igdb.client.js
        ├── ign.js
        ├── session.service.js
        └── supabase.client.js
```

Si todavía tienes `ign.js` dentro de `ign-test`, puedes moverlo desde la raíz del proyecto con:

```bash
mv ign-test/ign.js backend/src/services/ign.js
```

---

## Dependencias

El servicio utiliza `cheerio` para analizar el HTML de IGN.

Instalar desde la raíz del proyecto:

```bash
npm install cheerio
```

No es necesario instalar `fetch` si se utiliza una versión moderna de Node.js que ya lo incluye de forma nativa.

---

## Importar `getGameMissions`

Desde un archivo dentro de:

```text
backend/src/routes/
```

por ejemplo:

```text
backend/src/routes/catalog.routes.js
```

se importa así:

```js
const { getGameMissions } = require("../services/ign");
```

---

## Obtener las misiones de un juego

`getGameMissions()` recibe únicamente el nombre del videojuego:

```js
const missions = await getGameMissions(gameName);
```

Debe utilizarse dentro de una función `async`.

### Ejemplo

```js
async function test() {

    const gameName = "Cyberpunk 2077";

    const missions = await getGameMissions(gameName);

    console.log(missions);
}

test();
```

---

## Resultado

La función devuelve un array de objetos:

```js
[
    {
        name: "Automatic Love",
        url: "/wikis/cyberpunk-2077/Automatic_Love_Walkthrough#automatic-love"
    },
    {
        name: "The Heist",
        url: "/wikis/cyberpunk-2077/The_Heist_Walkthrough#the-heist"
    }
]
```

Cada misión tiene esta estructura:

```js
{
    name: "Nombre de la misión",
    url: "URL de la guía en IGN"
}
```

---

# Funcionamiento interno

Desde fuera solamente se utiliza:

```js
getGameMissions(gameName);
```

Internamente el flujo es:

```text
Nombre del juego
      ↓
findIgnWiki()
      ↓
Wiki del juego en IGN
      ↓
findWalkthrough()
      ↓
Página Walkthrough
      ↓
getMissions()
      ↓
Misiones principales
      ↓
[
    { name, url },
    { name, url }
]
```

---

## 1. Localizar la wiki del juego

El servicio busca automáticamente el juego en IGN.

Por ejemplo:

```text
Cyberpunk 2077
```

se resuelve como:

```text
/wikis/cyberpunk-2077
```

También soporta casos donde el nombre del juego y el slug utilizado por IGN son diferentes.

Por ejemplo:

```text
The Witcher 3
```

se resuelve como:

```text
/wikis/the-witcher-3-wild-hunt
```

Y:

```text
Grand Theft Auto V
```

se resuelve como:

```text
/wikis/gta-5
```

Para casos como GTA V se realiza una normalización del nombre para poder relacionar:

```text
Grand Theft Auto V
```

con:

```text
GTA 5
```

---

## 2. Localizar el Walkthrough

Después de encontrar la wiki, el servicio busca automáticamente el enlace correspondiente al Walkthrough.

Esto es necesario porque IGN no utiliza siempre exactamente la misma URL.

Por ejemplo, Cyberpunk 2077 utiliza:

```text
/wikis/cyberpunk-2077/Walkthrough_-_Main_Jobs
```

mientras que otros juegos utilizan:

```text
/wikis/the-witcher-3-wild-hunt/Walkthrough
```

o:

```text
/wikis/gta-5/Walkthrough
```

Por este motivo la URL del Walkthrough no se construye manualmente.

---

# Métodos de extracción de misiones

El servicio dispone de dos estrategias.

## Método 1: datos estructurados de IGN

Es el método preferido.

Cuando IGN proporciona:

```js
checklistTasks
```

el servicio utiliza esos datos en lugar de depender directamente de las tablas HTML.

A partir de ellos intenta detectar automáticamente categorías relacionadas con la historia principal.

Actualmente reconoce categorías que contengan:

```text
main
```

o:

```text
story
```

junto con:

```text
quest
```

o:

```text
mission
```

Esto permite detectar automáticamente categorías como:

```text
Main Quests
Main Missions
Story Quests
The Wild Hunt Main Quests
```

Después se filtran únicamente las tareas pertenecientes a esa categoría.

---

## Método 2: fallback HTML

Algunas páginas de IGN no proporcionan `checklistTasks`.

Cuando:

```js
checklistTasks.length === 0
```

el servicio utiliza un fallback basado en las tablas HTML del Walkthrough.

Busca enlaces dentro de:

```js
$("table a")
```

y construye las misiones mediante:

```js
{
    name,
    url
}
```

También se descartan enlaces internos con fragmentos `#` para reducir elementos auxiliares como:

```text
Gold Completion Guide
```

que pueden aparecer dentro de las tablas de algunas guías.

---

# Juegos probados

Durante el desarrollo se ha probado el extractor con diferentes estructuras de IGN.

| Juego | Método utilizado | Resultado |
|---|---|---:|
| The Witcher 3 | JSON / checklistTasks | 57 |
| Cyberpunk 2077 | JSON / checklistTasks | 36 |
| Red Dead Redemption 2 | JSON / checklistTasks | 97 |
| Marvel's Spider-Man 2 | JSON / checklistTasks | 32 |
| God of War Ragnarök | JSON / checklistTasks | 17 |
| Assassin's Creed Valhalla | JSON / checklistTasks | 162 |
| Hogwarts Legacy | Fallback HTML | 45 |
| Grand Theft Auto V | Fallback HTML | 72 |

Los resultados pueden depender de cómo IGN mantenga o modifique sus páginas.

---

# Probar manualmente `ign.js`

Una vez ubicado en:

```text
backend/src/services/ign.js
```

puede probarse directamente desde la raíz del proyecto.

## Cyberpunk 2077

```bash
node -e 'const { getGameMissions } = require("./backend/src/services/ign"); getGameMissions("Cyberpunk 2077").then(console.log)'
```

## Grand Theft Auto V

```bash
node -e 'const { getGameMissions } = require("./backend/src/services/ign"); getGameMissions("Grand Theft Auto V").then(console.log)'
```

## The Witcher 3

```bash
node -e 'const { getGameMissions } = require("./backend/src/services/ign"); getGameMissions("The Witcher 3").then(console.log)'
```

## Red Dead Redemption 2

```bash
node -e 'const { getGameMissions } = require("./backend/src/services/ign"); getGameMissions("Red Dead Redemption 2").then(console.log)'
```

---

# Integración con GRYD

La idea es utilizar directamente el nombre del videojuego que GRYD ya obtiene de IGDB.

Por ejemplo:

```js
const gameName = game.name;

const missions = await getGameMissions(gameName);
```

El resto del backend no necesita conocer:

- el slug utilizado por IGN;
- la URL de la wiki;
- la URL del Walkthrough;
- el nombre que IGN utiliza para la categoría principal;
- si el juego utiliza `checklistTasks`;
- si es necesario utilizar el fallback HTML.

Toda esa lógica queda encapsulada dentro de:

```text
backend/src/services/ign.js
```

---

# Ejemplo desde una ruta del backend

Desde un archivo como:

```text
backend/src/routes/catalog.routes.js
```

se puede importar:

```js
const { getGameMissions } = require("../services/ign");
```

Y dentro de una función `async`:

```js
const missions = await getGameMissions(gameName);
```

Por ejemplo:

```js
async function testMissions() {

    const gameName = "Cyberpunk 2077";

    const missions = await getGameMissions(gameName);

    console.log(missions);
}
```

---

# Estructura del servicio

Las funciones internas principales son:

```text
normalizeGameName()
```

Normaliza determinados nombres para facilitar la búsqueda en IGN.

```text
findIgnWiki()
```

Busca el juego y obtiene la raíz de su wiki.

```text
findWalkthrough()
```

Localiza automáticamente la página del Walkthrough.

```text
getMissions()
```

Extrae las misiones mediante `checklistTasks` o mediante el fallback HTML.

```text
getGameMissions()
```

Función pública que conecta todo el proceso.

El resto de GRYD debería utilizar principalmente:

```js
getGameMissions(gameName);
```

---

# Exportación

`ign.js` exporta:

```js
module.exports = {
    getGameMissions
};
```

Por tanto se importa mediante:

```js
const { getGameMissions } = require("../services/ign");
```

---

# Consideraciones

El servicio depende de la estructura pública de las páginas de IGN.

Si IGN modifica:

- su buscador;
- `__NEXT_DATA__`;
- `checklistTasks`;
- la estructura de sus tablas;
- los nombres de sus categorías;

puede ser necesario actualizar el extractor.

Por ese motivo, toda la lógica relacionada con IGN se mantiene aislada dentro de:

```text
backend/src/services/ign.js
```

Esto evita acoplar el resto del backend de GRYD a la estructura interna de IGN.

---

# Estado actual

El extractor permite partir únicamente de:

```js
"Cyberpunk 2077"
```

y realizar automáticamente:

```text
Nombre del juego
      ↓
Wiki de IGN
      ↓
Walkthrough
      ↓
Categoría principal
      ↓
Misiones
      ↓
{name, url}
```

El siguiente paso de integración consiste en conectar `getGameMissions(gameName)` con una ruta del backend de GRYD y devolver las misiones al frontend.