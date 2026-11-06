# GRYD

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/N8X82A3MND)

GRYD es una aplicación para descubrir videojuegos y organizar una biblioteca personal.

## Tecnologías

- **Frontend:** HTML, SCSS/CSS y JavaScript sin framework.
- **Backend:** Express ejecutado en Cloudflare Workers.
- **Autenticación y datos:** Supabase.
- **Catálogo de videojuegos:** IGDB.

## Estructura

```text
GRYD/
├── frontend/                 # Archivos públicos que carga el navegador
│   ├── index.html
│   ├── assets/
│   ├── legal/
│   ├── styles/
│   │   ├── css/               # CSS servido por el sitio
│   │   └── scss/              # Fuentes SCSS
│   └── js/
│       ├── config.js
│       └── features/
│           ├── auth/
│           ├── games/
│           ├── library/
│           └── legal/
├── functions/                # Pages Functions que reenvían solicitudes /api/...
├── backend/
│   ├── worker.mjs             # Entrada de Cloudflare Workers
│   └── src/
│       ├── app.js             # Configura Express y registra las rutas
│       ├── constants/         # Campos compartidos para consultas a IGDB
│       ├── routes/            # auth.routes.js, catalog.routes.js, library.routes.js
│       └── services/          # Sesión, cliente de Supabase y cliente de IGDB
├── docs/                      # Documentación del proyecto y la base de datos
├── scripts/
├── package.json
└── wrangler.jsonc
```

El frontend se sirve desde `frontend/`; sus Pages Functions reenvían las solicitudes `/api/...` al Worker para que las cookies de sesión sean del mismo sitio que la aplicación. El backend registra los endpoints `/api/...` y mantiene las credenciales de IGDB y Supabase fuera del navegador.

## Desarrollo local

Requisitos: Node.js y npm, además de credenciales para Supabase e IGDB.

1. Instala dependencias:

   ```bash
   npm install
   ```

   Genera el CSS con `npm run build:css`; `npm run dev` también lo compila antes de iniciar los servidores locales.

2. Crea `.dev.vars` en la raíz (Wrangler la usa localmente) con las variables necesarias:

   ```text
   SUPABASE_URL=
   SUPABASE_PUBLISHABLE_KEY=
   SUPABASE_SECRET_KEY=
   IGDB_CLIENT_ID=
   IGDB_ACCESS_TOKEN=
   FOUS_API_KEY=
   ```

   `SUPABASE_SECRET_KEY` se usa únicamente en el backend para operaciones administrativas y la caché compartida de juegos. No la expongas al frontend ni subas `.dev.vars` u otros archivos con credenciales al repositorio.

   Antes de iniciar la aplicación, ejecuta en el SQL Editor de Supabase
   [supabase/create_games.sql](./supabase/create_games.sql) para crear las
   tablas de caché y migrar las horas existentes de `game_playtime_cache`.

3. Inicia el frontend y el Worker:

   ```bash
   npm run dev
   ```

   `serve` imprimirá la dirección del frontend (normalmente `http://localhost:3000`) y Wrangler escuchará en `http://localhost:8787`.

4. Para comprobar qué procesos están usando esos puertos y liberarlos al detener el entorno:

   ```bash
   sudo ss -lptn '( sport = :3000 or sport = :8787 )'
   fuser -k 3000/tcp 8787/tcp
   ```

   `fuser` forma parte del paquete `psmisc`. Si no está instalado en Ubuntu o Debian, puedes instalarlo con `sudo apt install psmisc`. El comando para liberar los puertos termina los procesos que los estén usando.

## Producción

Requisitos: una cuenta de Cloudflare, acceso al proyecto de Supabase y credenciales de IGDB. Los comandos de Wrangler se ejecutan desde la raíz del repositorio.

1. Instala dependencias y autentícate en Cloudflare:

   ```bash
   npm install
   npx wrangler login
   ```

2. Configura los secretos del Worker. Wrangler solicitará cada valor de forma interactiva; no los incluyas en comandos, archivos del frontend ni en el repositorio:

   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
   npx wrangler secret put SUPABASE_SECRET_KEY
   npx wrangler secret put IGDB_CLIENT_ID
   npx wrangler secret put IGDB_ACCESS_TOKEN
   npx wrangler secret put FOUS_API_KEY
   ```

   `SUPABASE_SECRET_KEY` es necesaria para la eliminación administrativa de cuentas. El token de IGDB debe mantenerse vigente; si caduca o se renueva, actualízalo con el último comando.

3. Despliega el backend como Cloudflare Worker:

   ```bash
   npx wrangler deploy
   ```

   Wrangler mostrará la URL desplegada del Worker. Comprueba que coincide con la URL de producción configurada en `API_URL` dentro de [frontend/js/config.js](./frontend/js/config.js). Si usas otra URL, actualiza esa configuración y añade el origen exacto de la web a `allowedOrigins` en [backend/src/app.js](./backend/src/app.js) antes de desplegar de nuevo.

4. Compila el CSS y publica el frontend en Cloudflare Pages. Si el proyecto Pages `gryd` aún no existe, ejecuta también el comando para crearlo:

   ```bash
   npx wrangler pages project create gryd --production-branch main
   ```

   Después, compila y despliega el frontend:

   ```bash
   npm run build:css
   npx wrangler pages deploy frontend --project-name=gryd
   ```

   El proyecto `gryd` usa normalmente `https://gryd.pages.dev`, que ya está permitido por el backend. Si eliges otro nombre o dominio, actualiza `allowedOrigins` en el backend para permitir el origen de producción.

5. En la configuración de autenticación de Supabase, añade el dominio de Pages a los sitios permitidos (Site URL y Redirect URLs, cuando corresponda). Después, prueba el registro e inicio de sesión, la biblioteca, la carga de avatares y la eliminación de cuenta en la URL de producción.

   Para futuras publicaciones del frontend, vuelve a ejecutar `npm run build:css` y el comando `wrangler pages deploy`. Los secretos del Worker se gestionan por separado y no se suben con el código.

## Configuración de despliegue

El Worker se configura en [wrangler.jsonc](./wrangler.jsonc) y utiliza `backend/worker.mjs` como entrada. Para ver los comandos de publicación y configuración de secretos, sigue la sección [Producción](#producción).

## Documentación

- [Esquema de Supabase](./docs/SCHEMA.md)
- [Roadmap](./docs/ROADMAP.md)


## APIs

Games -> [IGDB, RAWG]
Films -> [TMDB, OMDb, Trakt, Wikidata, TVmaze]
TV Shows -> [TMDB, TVmaze, Trakt, OMDb, Wikidata]
Anime -> [AniList, Jikan, Kitsu, Shikimori, MyAnimeList]
Books -> [ Google Books, Open Library, Gutendex, Internet Archive, Wikidata SPARQL]
