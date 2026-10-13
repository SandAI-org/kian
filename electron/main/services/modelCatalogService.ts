import type { ModelsStore, ModelsStoreEntry, Provider } from "@earendil-works/pi-ai";
import { promises as fs } from "node:fs";
import path from "node:path";
import { GLOBAL_CONFIG_DIR } from "./workspacePaths";

const CATALOG_PATH = path.join(GLOBAL_CONFIG_DIR, "models-store.json");
type Catalog = Record<string, ModelsStoreEntry>;
let catalog: Promise<Catalog> | undefined;
let writeQueue = Promise.resolve();

const readCatalog = (): Promise<Catalog> => {
  catalog ??= fs.readFile(CATALOG_PATH, "utf8").then(
    (content) => JSON.parse(content) as Catalog,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return {};
      throw error;
    },
  );
  return catalog;
};

const writeEntry = (
  providerId: string,
  entry: ModelsStoreEntry | undefined,
  signal?: AbortSignal,
): Promise<void> => {
  const write = writeQueue.then(async () => {
    signal?.throwIfAborted();
    const next = { ...await readCatalog() };
    if (entry) next[providerId] = structuredClone(entry);
    else delete next[providerId];
    await fs.mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
    await fs.writeFile(`${CATALOG_PATH}.tmp`, JSON.stringify(next), { signal });
    await fs.rename(`${CATALOG_PATH}.tmp`, CATALOG_PATH);
    catalog = Promise.resolve(next);
  });
  writeQueue = write.catch(() => {});
  return write;
};

export const modelCatalogStore: ModelsStore = {
  async read(providerId, options) {
    await writeQueue;
    options?.signal?.throwIfAborted();
    return structuredClone((await readCatalog())[providerId]);
  },
  write: (providerId, entry, options) => writeEntry(providerId, entry, options?.signal),
  delete: (providerId, options) => writeEntry(providerId, undefined, options?.signal),
};

export const refreshPublicProviderModels = async (
  provider: Provider,
  signal: AbortSignal,
): Promise<void> => {
  if (!provider.refreshModels) throw new Error(`Provider has no model catalog: ${provider.id}`);
  // Pi's high-level refresh skips unconfigured providers; the public catalog needs no credential.
  await provider.refreshModels({
    stored: await modelCatalogStore.read(provider.id, { signal }),
    allowNetwork: true,
    force: true,
    signal,
    baseUrl: provider.baseUrl,
    async publish(publication) {
      signal.throwIfAborted();
      if (publication.persist === null) {
        await modelCatalogStore.delete(provider.id, { signal });
      } else if (publication.persist !== undefined) {
        await modelCatalogStore.write(provider.id, publication.persist, { signal });
      }
      if (signal.aborted) return false;
      publication.update?.();
      return true;
    },
  });
};
