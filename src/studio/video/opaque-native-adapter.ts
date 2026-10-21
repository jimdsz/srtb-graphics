// Build-only replacement: the native release graph never resolves or emits the
// optional software encoder. Reaching this guard is a build/policy error.
export async function enforceOpaqueCbr():Promise<never>{
  throw Error('Le réencodage logiciel ne fait pas partie de cette édition native.');
}
