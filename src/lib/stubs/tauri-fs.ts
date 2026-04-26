// Stub for web builds
export function readDir(): never {
  throw new Error('@tauri-apps/plugin-fs is not available in web mode');
}
export function readTextFile(): never {
  throw new Error('@tauri-apps/plugin-fs is not available in web mode');
}
export function writeFile(): never {
  throw new Error('@tauri-apps/plugin-fs is not available in web mode');
}
