import type { OutputFormatChoice } from "./appTypes";
import { parseOutputFormatChoice } from "./outputFormat";

const OUTPUT_FORMAT_STORAGE_KEY = "aspect-crop.output-format";

export function loadOutputFormatChoice(): OutputFormatChoice {
  return parseOutputFormatChoice(localStorage.getItem(OUTPUT_FORMAT_STORAGE_KEY)) ?? "same";
}

export function persistOutputFormatChoice(choice: OutputFormatChoice): void {
  localStorage.setItem(OUTPUT_FORMAT_STORAGE_KEY, choice);
}
