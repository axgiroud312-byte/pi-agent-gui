import type { ApiClient } from "@zcode/shared";
import { PRODUCT_CAPABILITIES } from "@zcode/shared";
import { readApiJson } from "../providers/api/apiJson.js";
import { ZCODE_CLIENT_SCENES_URL } from "../providers/api/apiEndpoints.js";
import type { ClientScenesResponse, IClientScenesService } from "./clientScenes.js";

export function createClientScenesService(dependencies: {
  apiClient: ApiClient;
}): IClientScenesService {
  return {
    list: () =>
      PRODUCT_CAPABILITIES.vendorCatalog
        ? readApiJson<ClientScenesResponse>(dependencies.apiClient, ZCODE_CLIENT_SCENES_URL, {
            method: "GET",
          })
        : Promise.resolve({ code: 0, msg: "Vendor scenes disabled", data: [] }),
  };
}
