import { defineConfig } from "zotero-plugin-scaffold";
import { resolve } from "node:path";
import pkg from "./package.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  updateURL: "https://github.com/HiYvri/pdf-fetcher/releases/latest/download/update.json",
  xpiDownloadLink: "https://github.com/HiYvri/pdf-fetcher/releases/latest/download/pdf-fetcher.xpi",
  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}"
    },
    fluent: {
      dts: false
    },
    prefs: {
      prefix: pkg.config.prefsPrefix
    },
    esbuildOptions: [
      {
        entryPoints: [resolve("src/index.ts")],
        define: {
          __env__: `"${process.env.NODE_ENV || "development"}"`
        },
        bundle: true,
        target: "firefox115",
        outfile: resolve(`.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`)
      }
    ]
  },
  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}?.data?.initialized === true`
  },
  logLevel: "TRACE"
});
