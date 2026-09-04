import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDirector } from "./director.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT ?? 8080);
const dataDir = process.env.APP_DATA_DIR ?? path.join(process.cwd(), "data");
const director = createDirector(dataDir);

app.use(express.json({ limit: "1mb" }));

app.get("/api/config", (_request, response) => {
  response.json(director.getConfig());
});

app.get("/api/state", async (_request, response, next) => {
  try {
    response.json(await director.getState());
  } catch (error) {
    next(error);
  }
});

app.post("/api/reset", async (_request, response, next) => {
  try {
    response.json(await director.reset());
  } catch (error) {
    next(error);
  }
});

app.post("/api/attempts", async (request, response, next) => {
  try {
    response.json(await director.runAttempt(request.body));
  } catch (error) {
    next(error);
  }
});

app.get("/api/receipt", async (_request, response, next) => {
  try {
    const state = await director.getState();
    response.json(state.receipt);
  } catch (error) {
    next(error);
  }
});

if (process.env.NODE_ENV === "production") {
  const clientDir = path.resolve(__dirname, "../client");
  app.use(express.static(clientDir));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(clientDir, "index.html"));
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({
    error: sanitizeError(error)
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Livepeer DKG Iteration Lab listening on port ${port}`);
});

function sanitizeError(error: Error): string {
  return error.message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}
