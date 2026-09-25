export type SaveFolderMode = "source" | "last" | "custom";
export type SaveFolderSettings = { mode: SaveFolderMode; customFolder: string | null; lastFolder: string | null };

export function parseSaveFolderMode(value: string | null): SaveFolderMode {
  return value === "last" || value === "custom" ? value : "source";
}

export function parentFolder(path: string): string | null {
  const index = path.startsWith("/") ? path.lastIndexOf("/") : Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index < 0) return null;
  if (index === 0 || (index === 2 && path[1] === ":")) return path.slice(0, index + 1);
  return path.slice(0, index);
}

export function saveDefaultPath(name: string, folder?: string): string {
  if (!folder) return name;
  const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  const trimmed = folder.replace(separator === "/" ? /\/+$/ : /\\+$/, "");
  return `${trimmed}${separator}${name}`;
}

export async function resolveSaveFolder(
  settings: SaveFolderSettings,
  sourcePath: string | null,
  isAvailable: (path: string) => Promise<boolean>
): Promise<string | undefined> {
  const sourceFolder = sourcePath ? parentFolder(sourcePath) : null;
  const candidates = settings.mode === "last"
    ? [settings.lastFolder, settings.customFolder, sourceFolder]
    : settings.mode === "custom" ? [settings.customFolder, sourceFolder] : [sourceFolder];
  for (const folder of new Set(candidates)) {
    if (!folder) continue;
    try {
      if (await isAvailable(folder)) return folder;
    } catch {
      // Disconnected volumes and unavailable paths must not prevent the dialog opening.
    }
  }
  return undefined;
}
