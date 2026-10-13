import { ApiOutlined } from "@ant-design/icons";
import type { KnownProvider } from "@earendil-works/pi-ai";
import antLing from "@renderer/assets/providers/ant-ling.ico";
import radius from "@renderer/assets/providers/radius.svg";
import typesafe from "@renderer/assets/providers/typesafe.png";
import anthropic from "@lobehub/icons-static-svg/icons/anthropic.svg";
import azure from "@lobehub/icons-static-svg/icons/azure.svg";
import baseten from "@lobehub/icons-static-svg/icons/baseten.svg";
import bedrock from "@lobehub/icons-static-svg/icons/bedrock.svg";
import cerebras from "@lobehub/icons-static-svg/icons/cerebras.svg";
import cloudflare from "@lobehub/icons-static-svg/icons/cloudflare.svg";
import copilot from "@lobehub/icons-static-svg/icons/copilot.svg";
import deepseek from "@lobehub/icons-static-svg/icons/deepseek.svg";
import fal from "@lobehub/icons-static-svg/icons/fal.svg";
import fireworks from "@lobehub/icons-static-svg/icons/fireworks.svg";
import google from "@lobehub/icons-static-svg/icons/google.svg";
import groq from "@lobehub/icons-static-svg/icons/groq.svg";
import huggingface from "@lobehub/icons-static-svg/icons/huggingface.svg";
import kimi from "@lobehub/icons-static-svg/icons/kimi.svg";
import meta from "@lobehub/icons-static-svg/icons/meta.svg";
import minimax from "@lobehub/icons-static-svg/icons/minimax.svg";
import mistral from "@lobehub/icons-static-svg/icons/mistral.svg";
import moonshot from "@lobehub/icons-static-svg/icons/moonshot.svg";
import nvidia from "@lobehub/icons-static-svg/icons/nvidia.svg";
import openai from "@lobehub/icons-static-svg/icons/openai.svg";
import opencode from "@lobehub/icons-static-svg/icons/opencode.svg";
import openrouter from "@lobehub/icons-static-svg/icons/openrouter.svg";
import qwen from "@lobehub/icons-static-svg/icons/qwen.svg";
import together from "@lobehub/icons-static-svg/icons/together.svg";
import vercel from "@lobehub/icons-static-svg/icons/vercel.svg";
import vertexai from "@lobehub/icons-static-svg/icons/vertexai.svg";
import xai from "@lobehub/icons-static-svg/icons/xai.svg";
import xiaomi from "@renderer/assets/providers/xiaomi.svg";
import zai from "@lobehub/icons-static-svg/icons/zai.svg";

const providerIcons: Record<string, string> = {
  "ant-ling": antLing,
  radius,
  typesafe,
  "amazon-bedrock": bedrock,
  "anthropic": anthropic,
  "azure": azure,
  "baseten": baseten,
  "cerebras": cerebras,
  "cloudflare-ai-gateway": cloudflare,
  "cloudflare-workers-ai": cloudflare,
  "deepseek": deepseek,
  "fireworks": fireworks,
  "github-copilot": copilot,
  "google": google,
  "google-vertex": vertexai,
  "groq": groq,
  "huggingface": huggingface,
  "kimi-coding": kimi,
  "meta": meta,
  "minimax": minimax,
  "minimax-cn": minimax,
  "mistral": mistral,
  "moonshotai": moonshot,
  "moonshotai-cn": moonshot,
  "nvidia": nvidia,
  "openai": openai,
  "openai-codex": openai,
  "opencode": opencode,
  "opencode-go": opencode,
  "openrouter": openrouter,
  "qwen-token-plan": qwen,
  "qwen-token-plan-cn": qwen,
  "qwen-token-plan-individual": qwen,
  "together": together,
  "vercel-ai-gateway": vercel,
  "xai": xai,
  "xiaomi": xiaomi,
  "xiaomi-token-plan-ams": xiaomi,
  "xiaomi-token-plan-cn": xiaomi,
  "xiaomi-token-plan-sgp": xiaomi,
  "zai": zai,
  "zai-coding-cn": zai,
  "fal": fal,
} satisfies Record<KnownProvider | "fal", string>;

export const ProviderIcon = ({ provider }: { provider: string }) => {
  const icon = providerIcons[provider];
  if (!icon) {
    return <ApiOutlined className="provider-icon" aria-hidden="true" />;
  }
  return (
    <img
      src={icon}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`provider-icon${
        provider === "ant-ling" || provider === "typesafe"
          ? ""
          : " provider-icon--monochrome"
      }`}
    />
  );
};
