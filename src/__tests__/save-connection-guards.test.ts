// Two guards on saveConnection, the action the schema form's Connect calls.
//
// Hydration proof: the host renders the form from currentConfig's values, and
// on any hydration failure (the read throws, times out, or is not found) it
// renders the blank form instead. The Community Management Switch then shows
// its default (off) and its hidden input posts "false" on Connect. The Client
// ID text field is the proof: the host fills it from currentConfig, so
// saveConnection changes organizationPosting only when the posted Client ID is
// non-empty and equals the stored one, or when the stored row has no Client ID
// and its organizationPosting is not true (nothing a blank form can lose). A
// stored true without a stored Client ID has no proof. Without the proof a save whose posted flag differs from the stored flag
// refuses, and a save whose posted flag equals it proceeds with the flag
// unchanged, so nothing is dropped silently.
//
// Complete credentials: Connect reports success to the person, so a save whose
// merged row would lack the Client ID or the Client secret refuses with a
// fixed text. A blank field still keeps the stored value.
import { describe, expect, it } from "vitest";
import { register } from "../register";
import { makeFakeHostConfig, makeHostCtx } from "./fake-host-config";

function makeCtx(initial: Record<string, unknown> | null) {
  const fake = makeFakeHostConfig();
  if (initial !== null) fake.setRaw("linkedin", JSON.stringify(initial));
  const { call } = makeHostCtx(register, { store: fake.svc });
  return {
    call,
    fake,
    get raw() {
      return fake.rawOf("linkedin");
    },
    get row() {
      return (fake.rowOf("linkedin") ?? null) as Record<string, unknown> | null;
    },
  };
}

// The inputs Connect posts from a form the host drew from `values`: the Client
// ID carries its hydrated value (or ""), the secret is blank, and the Switch
// posts "true" or "false".
function formInputs(values: Record<string, unknown>, typed: Record<string, string> = {}): Record<string, string> {
  return {
    clientId: typeof values.clientId === "string" ? values.clientId : "",
    clientSecret: "",
    organizationPosting: values.organizationPosting === true ? "true" : "false",
    ...typed,
  };
}

const STORED_ON = { clientId: "cm-id", clientSecret: "cm-secret", organizationPosting: true, accounts: [] };
const STORED_OFF = { clientId: "cm-id", clientSecret: "cm-secret", organizationPosting: false, accounts: [] };
const NOT_READ = {
  code: "LINKEDIN_CONFIG_NOT_READ",
  message:
    "This page could not confirm the stored Client ID, so it cannot change the Community Management setting. Nothing was changed. Reload the page; to change the Client ID, save it first, then change the setting.",
};

describe("saveConnection changes organizationPosting only with the Client ID proof", () => {
  it("the stored Client ID with the Switch off changes the flag to false", async () => {
    const h = makeCtx(STORED_ON);
    const hydrated = (await h.call("currentConfig")) as Record<string, unknown>;
    await h.call("saveConnection", formInputs(hydrated, { organizationPosting: "false" }));
    expect(h.row?.organizationPosting).toBe(false);
  });

  it("the stored Client ID with the Switch on changes the flag to true", async () => {
    const h = makeCtx(STORED_OFF);
    const hydrated = (await h.call("currentConfig")) as Record<string, unknown>;
    await h.call("saveConnection", formInputs(hydrated, { organizationPosting: "true" }));
    expect(h.row?.organizationPosting).toBe(true);
  });

  it("without the proof, the Switch off over a stored true refuses with a fixed text and writes nothing", async () => {
    const h = makeCtx(STORED_ON);
    const before = h.raw;
    // The host's hydration failed, so the form was drawn from {}.
    await expect(h.call("saveConnection", formInputs({}))).rejects.toMatchObject(NOT_READ);
    expect(h.raw).toBe(before);
  });

  it("without the proof, the Switch off over a stored false saves the credentials", async () => {
    const h = makeCtx(STORED_OFF);
    await expect(
      h.call("saveConnection", formInputs({}, { clientId: "new-id", clientSecret: "new-secret" })),
    ).resolves.toEqual({ banner: "saved" });
    expect(h.row).toEqual({ ...STORED_OFF, clientId: "new-id", clientSecret: "new-secret" });
  });

  it("without the proof, the Switch on over a stored true saves the credentials", async () => {
    const h = makeCtx(STORED_ON);
    await expect(
      h.call("saveConnection", formInputs({}, { clientId: "new-id", clientSecret: "new-secret", organizationPosting: "true" })),
    ).resolves.toEqual({ banner: "saved" });
    expect(h.row).toEqual({ ...STORED_ON, clientId: "new-id", clientSecret: "new-secret" });
  });

  it("an empty posted Client ID with the Switch on refuses with a fixed text and writes nothing", async () => {
    const h = makeCtx(STORED_OFF);
    const before = h.raw;
    await expect(h.call("saveConnection", formInputs({}, { organizationPosting: "true" }))).rejects.toMatchObject(NOT_READ);
    expect(h.raw).toBe(before);
  });

  it("a different non-empty Client ID with the Switch on refuses with a fixed text and writes nothing", async () => {
    const h = makeCtx(STORED_OFF);
    const before = h.raw;
    await expect(
      h.call("saveConnection", formInputs({}, { clientId: "new-id", organizationPosting: "true" })),
    ).rejects.toMatchObject(NOT_READ);
    expect(h.raw).toBe(before);
  });

  it("a different non-empty Client ID with the Switch off over a stored true refuses with a fixed text and writes nothing", async () => {
    const h = makeCtx(STORED_ON);
    const before = h.raw;
    await expect(
      h.call("saveConnection", formInputs({}, { clientId: "new-id", clientSecret: "new-secret", organizationPosting: "false" })),
    ).rejects.toMatchObject(NOT_READ);
    expect(h.raw).toBe(before);
  });

  it("with no Client ID and no stored true, a save changes the flag", async () => {
    const on = makeCtx({ accounts: [] });
    await on.call("saveConnection", formInputs({}, { clientId: "a", clientSecret: "s", organizationPosting: "true" }));
    expect(on.row?.organizationPosting).toBe(true);
  });

  it("with no Client ID over a stored true, a blank-hydrated form refuses with a fixed text and writes nothing", async () => {
    // A row an older version of this connector saved: the secret and the flag,
    // no Client ID. The hydration failed, so the Switch posts "false".
    const off = makeCtx({ clientSecret: "s", organizationPosting: true });
    const before = off.raw;
    await expect(
      off.call("saveConnection", formInputs({}, { clientId: "a", organizationPosting: "false" })),
    ).rejects.toMatchObject(NOT_READ);
    expect(off.raw).toBe(before);
    expect(off.row).toEqual({ clientSecret: "s", organizationPosting: true });
  });

  it("a retry into a row with no Client ID and a stored true refuses a differing flag and writes nothing", async () => {
    const h = makeCtx(STORED_OFF);
    const legacy = { clientSecret: "s", organizationPosting: true };
    // The first attempt reads the complete row, where the posted Client ID is
    // the proof. Another process writes the legacy row before the first
    // persist, so the host runs the change again on that row, which has no proof.
    h.fake.beforePersist((n) => {
      if (n === 1) h.fake.otherProcessWrites("linkedin", legacy);
    });
    await expect(
      h.call("saveConnection", formInputs({ clientId: "cm-id" }, { organizationPosting: "false" })),
    ).rejects.toMatchObject(NOT_READ);
    expect(h.fake.state.updaterCalls).toBe(2);
    expect(h.row).toEqual(legacy);
  });

  it("the proof is read on the row the atomic update runs on", async () => {
    const h = makeCtx(STORED_OFF);
    // Another process changes the Client ID before the first persist, so the
    // host runs the change again on that row, where the posted ID is no proof.
    h.fake.beforePersist((n) => {
      if (n === 1) h.fake.otherProcessWrites("linkedin", { ...STORED_OFF, clientId: "other-id" });
    });
    await expect(
      h.call("saveConnection", formInputs({ clientId: "cm-id" }, { organizationPosting: "true" })),
    ).rejects.toMatchObject(NOT_READ);
    expect(h.row).toEqual({ ...STORED_OFF, clientId: "other-id" });
  });
});

// The whole class: every stored-row shape (a Client ID stored or not, by the
// flag false, absent or true: six shapes) x posted flag x posted Client ID.
// The posted Client ID is the stored one ("equal"; "" for a row without one),
// another one ("different", "new-id") or blank. The secret is posted blank, as
// a hydrated form posts it. Each cell names its outcome: a refusal code (the
// stored text stays the same), or the keys the written row changes.
const NO_ID_FALSE = { clientSecret: "s", organizationPosting: false };
const NO_ID_ABSENT = { clientSecret: "s" };
const NO_ID_TRUE = { clientSecret: "s", organizationPosting: true };
const ID_FALSE = { clientId: "cm-id", clientSecret: "cm-secret", organizationPosting: false };
const ID_ABSENT = { clientId: "cm-id", clientSecret: "cm-secret" };
const ID_TRUE = { clientId: "cm-id", clientSecret: "cm-secret", organizationPosting: true };

type Shape = "noIdFalse" | "noIdAbsent" | "noIdTrue" | "idFalse" | "idAbsent" | "idTrue";
type PostedFlag = "true" | "false" | "absent";
type PostedId = "equal" | "different" | "blank";
type Outcome = { refuse: "LINKEDIN_CONFIG_NOT_READ" | "LINKEDIN_CONFIG_INCOMPLETE" } | { write: Record<string, unknown> };

const SHAPES: Record<Shape, Record<string, unknown>> = {
  noIdFalse: NO_ID_FALSE,
  noIdAbsent: NO_ID_ABSENT,
  noIdTrue: NO_ID_TRUE,
  idFalse: ID_FALSE,
  idAbsent: ID_ABSENT,
  idTrue: ID_TRUE,
};
const NOT_READ_CODE = { refuse: "LINKEDIN_CONFIG_NOT_READ" } as const;
const INCOMPLETE_CODE = { refuse: "LINKEDIN_CONFIG_INCOMPLETE" } as const;

const CELLS: Array<[Shape, PostedFlag, PostedId, Outcome]> = [
  // No Client ID, stored false: nothing to lose, so the flag follows the form.
  ["noIdFalse", "true", "equal", INCOMPLETE_CODE],
  ["noIdFalse", "true", "different", { write: { clientId: "new-id", organizationPosting: true } }],
  ["noIdFalse", "true", "blank", INCOMPLETE_CODE],
  ["noIdFalse", "false", "equal", INCOMPLETE_CODE],
  ["noIdFalse", "false", "different", { write: { clientId: "new-id", organizationPosting: false } }],
  ["noIdFalse", "false", "blank", INCOMPLETE_CODE],
  ["noIdFalse", "absent", "equal", INCOMPLETE_CODE],
  ["noIdFalse", "absent", "different", { write: { clientId: "new-id" } }],
  ["noIdFalse", "absent", "blank", INCOMPLETE_CODE],
  // No Client ID, no stored flag: nothing to lose either.
  ["noIdAbsent", "true", "equal", INCOMPLETE_CODE],
  ["noIdAbsent", "true", "different", { write: { clientId: "new-id", organizationPosting: true } }],
  ["noIdAbsent", "true", "blank", INCOMPLETE_CODE],
  ["noIdAbsent", "false", "equal", INCOMPLETE_CODE],
  ["noIdAbsent", "false", "different", { write: { clientId: "new-id", organizationPosting: false } }],
  ["noIdAbsent", "false", "blank", INCOMPLETE_CODE],
  ["noIdAbsent", "absent", "equal", INCOMPLETE_CODE],
  ["noIdAbsent", "absent", "different", { write: { clientId: "new-id" } }],
  ["noIdAbsent", "absent", "blank", INCOMPLETE_CODE],
  // No Client ID, stored true: no proof; a differing flag refuses first.
  ["noIdTrue", "true", "equal", INCOMPLETE_CODE],
  ["noIdTrue", "true", "different", { write: { clientId: "new-id" } }],
  ["noIdTrue", "true", "blank", INCOMPLETE_CODE],
  ["noIdTrue", "false", "equal", NOT_READ_CODE],
  ["noIdTrue", "false", "different", NOT_READ_CODE],
  ["noIdTrue", "false", "blank", NOT_READ_CODE],
  ["noIdTrue", "absent", "equal", INCOMPLETE_CODE],
  ["noIdTrue", "absent", "different", { write: { clientId: "new-id" } }],
  ["noIdTrue", "absent", "blank", INCOMPLETE_CODE],
  // Client ID stored, stored false: only the equal ID is the proof.
  ["idFalse", "true", "equal", { write: { organizationPosting: true } }],
  ["idFalse", "true", "different", NOT_READ_CODE],
  ["idFalse", "true", "blank", NOT_READ_CODE],
  ["idFalse", "false", "equal", { write: {} }],
  ["idFalse", "false", "different", { write: { clientId: "new-id" } }],
  ["idFalse", "false", "blank", { write: {} }],
  ["idFalse", "absent", "equal", { write: {} }],
  ["idFalse", "absent", "different", { write: { clientId: "new-id" } }],
  ["idFalse", "absent", "blank", { write: {} }],
  // Client ID stored, no stored flag: only the equal ID is the proof; the
  // missing flag reads as false, and only the proof writes the key.
  ["idAbsent", "true", "equal", { write: { organizationPosting: true } }],
  ["idAbsent", "true", "different", NOT_READ_CODE],
  ["idAbsent", "true", "blank", NOT_READ_CODE],
  ["idAbsent", "false", "equal", { write: { organizationPosting: false } }],
  ["idAbsent", "false", "different", { write: { clientId: "new-id" } }],
  ["idAbsent", "false", "blank", { write: {} }],
  ["idAbsent", "absent", "equal", { write: {} }],
  ["idAbsent", "absent", "different", { write: { clientId: "new-id" } }],
  ["idAbsent", "absent", "blank", { write: {} }],
  // Client ID stored, stored true: only the equal ID is the proof.
  ["idTrue", "true", "equal", { write: {} }],
  ["idTrue", "true", "different", { write: { clientId: "new-id" } }],
  ["idTrue", "true", "blank", { write: {} }],
  ["idTrue", "false", "equal", { write: { organizationPosting: false } }],
  ["idTrue", "false", "different", NOT_READ_CODE],
  ["idTrue", "false", "blank", NOT_READ_CODE],
  ["idTrue", "absent", "equal", { write: {} }],
  ["idTrue", "absent", "different", { write: { clientId: "new-id" } }],
  ["idTrue", "absent", "blank", { write: {} }],
];

function cellInput(shape: Shape, flag: PostedFlag, postedId: PostedId): Record<string, string> {
  const stored = SHAPES[shape];
  const clientId =
    postedId === "equal" ? (typeof stored.clientId === "string" ? stored.clientId : "") : postedId === "different" ? "new-id" : "";
  return { clientId, clientSecret: "", ...(flag === "absent" ? {} : { organizationPosting: flag }) };
}

async function expectCell(
  h: ReturnType<typeof makeCtx>,
  shape: Shape,
  input: Record<string, string>,
  outcome: Outcome,
): Promise<void> {
  const stored = SHAPES[shape];
  if ("refuse" in outcome) {
    await expect(h.call("saveConnection", input)).rejects.toMatchObject({ code: outcome.refuse });
    // Nothing was written: the stored text is still the cell's row, byte for byte.
    expect(h.raw).toBe(JSON.stringify(stored));
    expect(h.row).toEqual(stored);
  } else {
    await expect(h.call("saveConnection", input)).resolves.toEqual({ banner: "saved" });
    expect(h.row).toEqual({ ...stored, ...outcome.write });
  }
}

describe("saveConnection over every stored-row shape, posted flag and posted Client ID", () => {
  it("the table covers every cell once", () => {
    const keys = new Set(CELLS.map(([s, f, i]) => `${s}/${f}/${i}`));
    expect(keys.size).toBe(6 * 3 * 3);
    expect(CELLS.length).toBe(6 * 3 * 3);
  });

  it.each(CELLS)("stored %s, posted flag %s, posted Client ID %s", async (shape, flag, postedId, outcome) => {
    const h = makeCtx(SHAPES[shape]);
    await expectCell(h, shape, cellInput(shape, flag, postedId), outcome);
    expect(h.fake.state.updaterCalls).toBe(1);
  });

  it.each(CELLS)(
    "a retry into stored %s, posted flag %s, posted Client ID %s, has the same outcome",
    async (shape, flag, postedId, outcome) => {
      const input = cellInput(shape, flag, postedId);
      // The first attempt reads a complete row on which this input writes: its
      // Client ID is the posted one (else "first-id") and its flag equals the
      // posted one. Another process writes the cell's row before the first
      // persist, so the host runs the change again on the cell's row.
      const first = {
        clientId: input.clientId || "first-id",
        clientSecret: "first-secret",
        organizationPosting: input.organizationPosting === "true",
      };
      const h = makeCtx(first);
      h.fake.beforePersist((n) => {
        if (n === 1) h.fake.otherProcessWrites("linkedin", SHAPES[shape]);
      });
      await expectCell(h, shape, input, outcome);
      expect(h.fake.state.updaterCalls).toBe(2);
    },
  );
});

describe("saveConnection refuses a save that leaves the credentials incomplete", () => {
  const TEXT = "Save both the Client ID and the Client secret. Nothing was changed.";

  it("a blank first-time submit refuses with the fixed text and writes nothing", async () => {
    const h = makeCtx(null);
    const hydrated = (await h.call("currentConfig")) as Record<string, unknown>;
    await expect(h.call("saveConnection", formInputs(hydrated))).rejects.toThrow(TEXT);
    expect(h.raw).toBeUndefined();
  });

  it("one credential only refuses, the Client ID alone or the Client secret alone", async () => {
    const idOnly = makeCtx({ accounts: [] });
    const before = idOnly.raw;
    await expect(idOnly.call("saveConnection", { clientId: "typed-id", clientSecret: "" })).rejects.toMatchObject({
      code: "LINKEDIN_CONFIG_INCOMPLETE",
      message: TEXT,
    });
    expect(idOnly.raw).toBe(before);

    const secretOnly = makeCtx({ clientId: "", accounts: [] });
    await expect(secretOnly.call("saveConnection", { clientId: "", clientSecret: "typed-secret" })).rejects.toThrow(TEXT);
    expect(secretOnly.row).toEqual({ clientId: "", accounts: [] });
  });

  it("the refusal text carries no stored or typed value", async () => {
    const h = makeCtx({ clientSecret: "stored-secret-value" });
    const err = await h.call("saveConnection", { clientId: "", clientSecret: "" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(TEXT);
    expect((err as Error).message).not.toContain("stored-secret-value");
  });

  it("blank fields with both credentials stored keep them and save", async () => {
    const h = makeCtx(STORED_ON);
    await expect(h.call("saveConnection", { clientId: "  ", clientSecret: "" })).resolves.toEqual({ banner: "saved" });
    expect(h.row).toEqual(STORED_ON);
  });
});
