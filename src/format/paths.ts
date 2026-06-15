import { join } from "node:path";
export const gprojDir = (root: string) => join(root, ".gproj");
export const filePath = (root: string, rel: string) => join(gprojDir(root), rel);
export const phasePath = (root: string, id: number) => filePath(root, `phases/${String(id).padStart(2, "0")}.md`);
export const execPromptPath = (root: string, id: number) => filePath(root, `packages/${String(id).padStart(2, "0")}-exec-prompt.md`);
export const runPath = (root: string, id: string) => filePath(root, `runs/${id}.json`);
export const reviewPath = (root: string, id: string) => filePath(root, `reviews/${id}.md`);
