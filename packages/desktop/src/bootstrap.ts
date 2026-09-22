// This entry is compiled independently with splitting:false. Keep SDK imports out of this graph.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  initializeDesktopProductProfile,
  installDesktopProfileRelaunch,
} from "./main/desktopProductProfile.js";

const profile = initializeDesktopProductProfile();
const { app } = await import("electron");
installDesktopProfileRelaunch(app, profile);

// Indirection is deliberate: esbuild must not pull main or its shared chunks into bootstrap.
const mainEntry = pathToFileURL(join(import.meta.dirname, "main", "index.js")).href;
await import(mainEntry);
