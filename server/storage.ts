import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DemoState, WorkspaceState } from "../shared/types.js";

const legacyStateFile = "runtime-state.json";
const workspaceStateFile = "workspace-state.json";

export class JsonStateStore {
  constructor(private readonly dataDir: string) {}

  async read(): Promise<DemoState | null> {
    return this.readNamed<DemoState>(legacyStateFile);
  }

  async readWorkspace(): Promise<WorkspaceState | null> {
    return this.readNamed<WorkspaceState>(workspaceStateFile);
  }

  async write(state: DemoState): Promise<void> {
    await this.writeFile(legacyStateFile, JSON.stringify(state, null, 2));
  }

  async writeWorkspace(state: WorkspaceState): Promise<void> {
    await this.writeFile(workspaceStateFile, JSON.stringify(state, null, 2));
  }

  async writeJson(name: string, value: unknown): Promise<string> {
    return this.writeFile(name, JSON.stringify(value, null, 2));
  }

  async writeText(name: string, value: string): Promise<string> {
    return this.writeFile(name, value);
  }

  private async readNamed<T>(name: string): Promise<T | null> {
    try {
      const raw = await readFile(path.join(this.dataDir, name), "utf8");
      return JSON.parse(raw) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async writeFile(name: string, value: string): Promise<string> {
    const filePath = path.join(this.dataDir, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, value);
    return filePath;
  }
}
