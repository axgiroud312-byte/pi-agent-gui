import type { ZCodeConfigOption } from "@zcode/shared";
import type { ModelSelectGroup } from "../../ModelConfigSelect.js";
import { encodeCustomModelValue } from "../../lib/zcodeCustomModelValue.js";

/** Display and admission facts copied from the fixed Pi RPC workspace catalog. */
export interface PiModelCandidate {
  providerId: string;
  modelId: string;
  name: string;
  thoughtLevels: readonly string[];
}

export function extractPiModelCatalog(options: readonly ZCodeConfigOption[]): PiModelCandidate[] {
  const modelOption = options.find(option => option.id === "model" &&
    option.category === "pi-model" && option.type === "select");
  if (!modelOption) return [];
  const seen = new Set<string>();
  return (modelOption.options ?? []).flatMap(option => {
    const providerId = option.modelProviderId?.trim();
    if (!providerId || !option.value.startsWith(`${providerId}/`)) return [];
    const modelId = option.value.slice(providerId.length + 1);
    if (!modelId || seen.has(option.value)) return [];
    seen.add(option.value);
    return [{ providerId, modelId, name: option.name || modelId,
      thoughtLevels: option.modelThoughtLevels?.length ? option.modelThoughtLevels : ["off"] }];
  });
}

export function findPiModel(catalog: readonly PiModelCandidate[], providerId: string,
  modelId: string): PiModelCandidate | undefined {
  return catalog.find(model => model.providerId === providerId && model.modelId === modelId);
}

export function buildPiModelSelectGroups(catalog: readonly PiModelCandidate[]): ModelSelectGroup[] {
  const groups = new Map<string, ModelSelectGroup>();
  for (const model of catalog) {
    let group = groups.get(model.providerId);
    if (!group) {
      group = { key: `pi-provider:${model.providerId}`, label: model.providerId, items: [] };
      groups.set(model.providerId, group);
    }
    group.items.push({ key: `pi-model:${model.providerId}:${model.modelId}`,
      value: encodeCustomModelValue(model.providerId, model.modelId), name: model.name });
  }
  return [...groups.values()];
}
