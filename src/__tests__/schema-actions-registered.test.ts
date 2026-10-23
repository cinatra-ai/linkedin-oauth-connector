// The schema form calls the connector's actions by id: the host posts each
// call to /api/extensions/{installId}/actions/{actionId} and looks the id up
// among the actions this package's server entry registered. This test pins
// that the manifest asks the host for the schema form (uiSurface
// "schema-config") and that every action id its configSchema names (the root
// hydrateAction and each field's actionId, probeActionId or optionsAction, on
// the base fields and on every tab) is an action that src/register.ts
// registers, and that a named id which is not registered is reported.
import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { register } from "../register";
import { makeFakeHostConfig, makeHostCtx } from "./fake-host-config";

type Field = Record<string, unknown>;
type Schema = { hydrateAction?: unknown; fields?: Field[]; tabs?: Array<{ fields?: Field[] }> };

const cin = (pkg as unknown as { cinatra: { uiSurface?: unknown; configSchema?: Schema } }).cinatra;

function namedActionIds(schema: Schema | undefined): string[] {
  if (!schema) return [];
  const ids: string[] = [];
  if (typeof schema.hydrateAction === "string") ids.push(schema.hydrateAction);
  const fields = [...(schema.fields ?? []), ...(schema.tabs ?? []).flatMap((t) => t.fields ?? [])];
  for (const f of fields) {
    for (const key of ["actionId", "probeActionId", "optionsAction"]) {
      if (typeof f[key] === "string") ids.push(f[key] as string);
    }
  }
  return [...new Set(ids)].sort();
}

/** The ids the schema names that src/register.ts does not register. */
function unregisteredIds(schema: Schema | undefined): string[] {
  const { actions } = makeHostCtx(register, { store: makeFakeHostConfig().svc });
  return namedActionIds(schema).filter((id) => typeof actions.get(id)?.handler !== "function");
}

describe("schema form actions resolve to registered actions", () => {
  it('the manifest declares uiSurface "schema-config" with a configSchema', () => {
    expect(cin.uiSurface).toBe("schema-config");
    expect(typeof cin.configSchema).toBe("object");
  });

  it("every action id the configSchema names is registered by src/register.ts", () => {
    const named = namedActionIds(cin.configSchema);
    expect(named).toEqual([
      "clearConnection",
      "connectionStatus",
      "currentConfig",
      "helpContentReady",
      "saveConnection",
    ]);
    expect(unregisteredIds(cin.configSchema)).toEqual([]);
  });

  it("a named id that src/register.ts does not register is reported", () => {
    const schema = cin.configSchema as Schema;
    const mutated: Schema = {
      ...schema,
      fields: [...(schema.fields ?? []), { kind: "named-action", label: "Ghost", actionId: "noSuchAction" }],
    };
    expect(unregisteredIds(mutated)).toEqual(["noSuchAction"]);
  });
});
