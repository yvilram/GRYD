import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";

// Inyecta las variables de entorno y secretos de Cloudflare en process.env
Object.assign(process.env, env);

import app from "./src/app.js";

app.listen(3000);

export default httpServerHandler({ port: 3000 });