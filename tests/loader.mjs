export async function resolve(specifier, context, nextResolve) {
  if (specifier === "motrix:plugin-api") {
    return {
      format: "module",
      shortCircuit: true,
      url: new URL("./mock-api.mjs", import.meta.url).href
    };
  }
  return nextResolve(specifier, context);
}
