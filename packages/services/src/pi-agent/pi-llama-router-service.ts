import type { PiLlamaModel, PiLlamaProgress } from "./pi-llama-router-client.js";

export type PiLlamaRouterAction = { kind: "load" | "unload" | "download"; modelId: string };
export interface PiLlamaRouterModel extends PiLlamaModel { selectableInPi: boolean }
export interface PiLlamaRouterView {
  provider: "llama.cpp";
  piVersion: "0.87.0";
  serverUrl: string;
  modelsAutoload: boolean;
  models: PiLlamaRouterModel[];
}
export interface PiLlamaRouterProgressEvent {
  sessionId: string;
  modelId: string;
  action: "load" | "download";
  progress: PiLlamaProgress;
}

export function projectPiLlamaRouterModels(models: PiLlamaModel[], modelsAutoload: boolean): PiLlamaRouterModel[] {
  return models.map(model => ({ ...model, selectableInPi: model.status.value === "loaded" ||
    model.status.value === "sleeping" || modelsAutoload && model.status.value === "unloaded" &&
    model.status.failed !== true && model.source === "preset" }));
}
