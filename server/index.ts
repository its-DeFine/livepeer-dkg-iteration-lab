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
    response.json(await director.getWorkspace());
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects", async (request, response, next) => {
  try {
    response.status(201).json(await director.createProject(request.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/select", async (request, response, next) => {
  try {
    response.json(await director.selectProject(request.params.projectId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/attempts", async (request, response, next) => {
  try {
    response.json(await director.runAttempt({
      projectId: request.params.projectId,
      useDkgMemory: Boolean(request.body?.useDkgMemory)
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/projects/:projectId/dkg/backfill", async (request, response, next) => {
  try {
    response.json(await director.backfillProject(request.params.projectId));
  } catch (error) {
    next(error);
  }
});

app.get("/api/receipt", async (request, response, next) => {
  try {
    const workspace = await director.getWorkspace();
    const projectId = typeof request.query.projectId === "string"
      ? request.query.projectId
      : workspace.activeProjectId;
    const project = workspace.projects.find((candidate) => candidate.projectId === projectId);
    if (!project) throw new Error("Project not found.");
    response.json(project.receipt);
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
  response.status(500).json({ error: sanitizeError(error) });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Livepeer DKG Iteration Lab listening on port ${port}`);
});

function sanitizeError(error: Error): string {
  const message = error.message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
  if (/dkg|knowledge asset|assertion|shared.?memory|triple-count|merkle|promot|context graph/i.test(message)) {
    return "The artifact was saved, but its DKG snapshot could not be shared. The completed media output remains available in this project.";
  }
  if (/Livepeer|media job|capability|provider|runner/i.test(message)) {
    return "The remote media provider did not complete this job. Nothing ran locally; please retry once.";
  }
  return message.slice(0, 600);
}
