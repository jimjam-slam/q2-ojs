// d3-require ships no type declarations.
declare module "d3-require" {
  export type Require = ((...names: string[]) => Promise<unknown>) & {
    resolve(name: string, base?: string): Promise<string>;
    alias(aliases: Record<string, string>): Require;
  };
  export const require: Require;
  export function requireFrom(resolver: (name: string, base?: string) => Promise<string>): Require;
}
