import { config } from "../../package.json";

export const autoFetchPref = `${config.prefsPrefix}.autoFetchEnabled`;
// Keep using the existing token key and Zotero.Prefs calling convention.
export const tokenPref = `${config.prefsPrefix}.token`;
