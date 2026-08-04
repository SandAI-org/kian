import { setBedrockProviderModule } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { lazyApi } from "@earendil-works/pi-ai/api/lazy";

/**
 * pi-ai loads its Bedrock implementation through a variable import specifier
 * that bundlers cannot follow, so Rollup never emits the chunk and packaged
 * builds crash with "Cannot find module .../bedrock-converse-stream.js" on the
 * first Bedrock request. Register a bundler-visible lazy import instead; the
 * AWS SDK still only loads when a Bedrock model is actually used.
 */
export function registerBedrockStreamApi(): void {
  setBedrockProviderModule(
    lazyApi(() => import("@earendil-works/pi-ai/api/bedrock-converse-stream"))
  );
}
